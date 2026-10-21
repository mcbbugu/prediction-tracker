import { sql } from "./db";

export type Evidence = { url: string };

export type ClaimRow = {
  id: string;
  person_id: string;
  person_name: string;
  category: string;
  claim_type: string;
  quote_en: string;
  quote_zh: string;
  source_url: string;
  published_date: string;
  deadline: string;
  actual_result: string;
  status: string;
  publication: string;
  rationale: string;
  evidence: Evidence[];
  provenance: string;
  reviewed: boolean;
};

export type ScoreRow = {
  domain: string;
  value: number | null;
  // 80% interval, 0–100; null below 3 judged claims.
  low: number | null;
  high: number | null;
  n: number;
  confidence: string;
  formula_version: string;
};

const claimSelect = sql`
  c.id, c.person_id, p.name AS person_name, c.category, c.claim_type,
  c.quote_en, c.quote_zh, c.source_url,
  to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
  to_char(c.deadline, 'YYYY-MM-DD') AS deadline,
  c.actual_result, c.status, c.publication, c.rationale, c.evidence,
  c.provenance, (c.reviewed_at IS NOT NULL) AS reviewed
`;

export async function publishedClaims(personId?: string) {
  if (personId) {
    return sql<ClaimRow[]>`
      SELECT ${claimSelect}
      FROM claims c
      JOIN people p ON p.id = c.person_id
      WHERE c.publication = 'published' AND c.person_id = ${personId}
      ORDER BY c.published_date, c.id
    `;
  }
  return sql<ClaimRow[]>`
    SELECT ${claimSelect}
    FROM claims c
    JOIN people p ON p.id = c.person_id
    WHERE c.publication = 'published'
    ORDER BY c.deadline, c.id
  `;
}

export async function oneClaim(personId: string, claimId: string) {
  const rows = await sql<ClaimRow[]>`
    SELECT ${claimSelect}
    FROM claims c
    JOIN people p ON p.id = c.person_id
    WHERE c.person_id = ${personId} AND c.id = ${claimId} AND c.publication = 'published'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function latestScores(personId: string) {
  const rows = await sql<ScoreRow[]>`
    SELECT DISTINCT ON (domain)
      domain, value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence, formula_version
    FROM score_snapshots
    WHERE person_id = ${personId}
    ORDER BY domain, computed_at DESC
  `;
  return rows.filter((row) => row.confidence !== "已移除");
}

// SPEC 利益关系 (P12): relations with dates and archived sources, plus which published claims touch them.
export type InterestRow = {
  id: number;
  kind: "role" | "holding" | "deal";
  counterparty: string;
  counterparty_zh: string;
  role: string;
  started: string | null;
  ended: string | null;
  source_url: string;
  quote: string;
  reviewed: boolean;
};

// Neutral wording (SPEC: 写「说话时任特斯拉 CEO」，不写「有利益冲突」).
export function interestNote(item: Pick<InterestRow, "kind" | "counterparty" | "counterparty_zh" | "role">) {
  const org = item.counterparty_zh || item.counterparty;
  if (item.kind === "role") return `说话时任${org} ${item.role}`.trim();
  if (item.kind === "holding") return `说话时持有${org}权益${item.role ? `（${item.role}）` : ""}`;
  return `说话时与${org}有商业往来${item.role ? `（${item.role}）` : ""}`;
}

export async function personInterests(personId: string) {
  const relations = await sql<InterestRow[]>`
    SELECT id::int AS id, kind, counterparty, counterparty_zh, role, started, ended, source_url, quote,
           (reviewed_at IS NOT NULL) AS reviewed
    FROM interests
    WHERE person_id = ${personId} AND publication = 'published'
    ORDER BY CASE kind WHEN 'role' THEN 0 WHEN 'holding' THEN 1 ELSE 2 END, counterparty, started NULLS LAST
  `;
  const links = await sql<{ claim_id: string; interest_id: number }[]>`
    SELECT ci.claim_id, ci.interest_id::int AS interest_id
    FROM claim_interests ci JOIN interests i ON i.id = ci.interest_id
    WHERE i.person_id = ${personId} AND i.publication = 'published'
  `;
  const byId = new Map(relations.map((item) => [item.id, item]));
  const order = { role: 0, holding: 1, deal: 2 };
  // One note per claim and organisation, preferring the role over holdings and deals.
  const perClaim = new Map<string, Map<string, InterestRow>>();
  for (const link of links) {
    const item = byId.get(link.interest_id);
    if (!item) continue;
    const orgs = perClaim.get(link.claim_id) ?? new Map<string, InterestRow>();
    const current = orgs.get(item.counterparty);
    if (!current || order[item.kind] < order[current.kind]) orgs.set(item.counterparty, item);
    perClaim.set(link.claim_id, orgs);
  }
  const claim_notes: Record<string, string> = {};
  for (const [claimId, orgs] of perClaim) claim_notes[claimId] = [...orgs.values()].map(interestNote).join("；");
  return { collected: relations.length > 0, relations, claim_notes };
}
