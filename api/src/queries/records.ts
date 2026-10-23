import { sql } from "../core/db";
import { orgKey } from "../interests/orgs";

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
  quote_kind: string;
  // 改期合并: claims restating one commitment share a thread (null = stands alone).
  thread_id: string | null;
  // 更正通道: counter-evidence waiting for review → shown as 有争议.
  disputed: boolean;
  recheck_note: string | null;
  curation: string;
  disagreed: boolean;
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
  // 证据不足 claims in this domain: void, not scored, reported next to the score.
  voided: number;
};

const claimSelect = sql`
  c.id, c.person_id, p.name AS person_name, c.category, c.claim_type,
  c.quote_en, c.quote_zh, c.source_url,
  to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
  to_char(c.deadline, 'YYYY-MM-DD') AS deadline,
  c.actual_result, c.status, c.publication, c.rationale, c.evidence,
  c.provenance, (c.reviewed_at IS NOT NULL) AS reviewed, c.quote_kind, c.thread_id, p.curation,
  (c.disagreement IS NOT NULL) AS disagreed,
  EXISTS (SELECT 1 FROM challenges ch WHERE ch.target_kind = 'claim' AND ch.target_id = c.id AND ch.state = 'pending') AS disputed,
  (SELECT e.note FROM claim_events e WHERE e.claim_id = c.id AND e.action = 'challenge_rechecked' ORDER BY e.id DESC LIMIT 1) AS recheck_note
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
      domain, value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence, formula_version, voided
    FROM score_snapshots
    WHERE person_id = ${personId}
    ORDER BY domain, computed_at DESC
  `;
  return rows.filter((row) => row.confidence !== "已移除");
}

// Same rows as latestScores, one round trip. Filter after DISTINCT ON: a domain whose newest
// snapshot is 已移除 is omitted, not replaced by an older snapshot.
export async function latestScoresFor(personIds: string[]) {
  const grouped = new Map<string, ScoreRow[]>();
  if (personIds.length === 0) return grouped;
  const rows = await sql<(ScoreRow & { person_id: string })[]>`
    SELECT person_id, domain, value::float8 AS value, low::float8 AS low, high::float8 AS high,
           n, confidence, formula_version, voided
    FROM (
      SELECT DISTINCT ON (person_id, domain)
        person_id, domain, value, low, high, n, confidence, formula_version, voided
      FROM score_snapshots
      WHERE person_id IN ${sql(personIds)}
      ORDER BY person_id, domain, computed_at DESC
    ) latest
    WHERE confidence <> '已移除'
    ORDER BY person_id, domain
  `;
  for (const row of rows) {
    const score: ScoreRow = {
      domain: row.domain,
      value: row.value,
      low: row.low,
      high: row.high,
      n: row.n,
      confidence: row.confidence,
      formula_version: row.formula_version,
      voided: row.voided,
    };
    const list = grouped.get(row.person_id);
    if (list) list.push(score);
    else grouped.set(row.person_id, [score]);
  }
  return grouped;
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
    SELECT id::int AS id, kind, counterparty, counterparty_zh, role, started, ended, coalesce(end_kind, 'unknown') AS end_kind,
           source_url, quote, (reviewed_at IS NOT NULL) AS reviewed
    FROM interests
    WHERE person_id = ${personId} AND publication = 'published' AND superseded_at IS NULL
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

const EXPOSURE_DIMENSIONS = new Set(["region", "facility", "supplier", "customer", "partner", "investment"]);
const METRIC_KINDS = new Set(["revenue_share", "production_share", "amount_usd", "stake_pct"]);

export type AtlasRelation = {
  id: number;
  kind: "role" | "holding" | "deal";
  role: string;
  stake_pct: number | null;
  amount_usd: number | null;
  started: string | null;
  ended: string | null;
  end_kind: "ongoing" | "ended" | "planned" | "unknown";
  source_url: string;
  quote: string;
  reviewed: boolean;
};

export type AtlasExposure = {
  id: number;
  dimension: "region" | "facility" | "supplier" | "customer" | "partner" | "investment";
  target: string;
  target_zh: string;
  country: string | null;
  metric: { kind: "revenue_share" | "production_share" | "amount_usd" | "stake_pct"; value: number; year: number | null } | null;
  started: string | null;
  ended: string | null;
  source_url: string;
  quote: string;
  reviewed: boolean;
  // 'sec_xbrl' = read from a filing's XBRL; 'crawl' = the frozen 2026-10 web crawl, shown as unverified.
  basis: "sec_xbrl" | "crawl";
};

// Latest annual revenue from filings (SPEC 推算规则).
// period_start/period_end/form say what the number covers: only a ~12-month period is used for 推算.
export type AtlasFinancials = {
  revenue_usd: number;
  year: number;
  source_url: string;
  form: string;
  period_start: string;
  period_end: string;
};

export type AtlasOrg = {
  org_key: string;
  name: string;
  name_zh: string;
  relations: AtlasRelation[];
  exposures: AtlasExposure[];
  financials: AtlasFinancials | null;
};

export type AtlasLink = {
  claim_id: string;
  target_kind: "relation" | "exposure";
  target_id: number;
  level: "direct" | "indirect";
  reason: string;
};

// SPEC 利益关系的三层数据, as the person page and /interests detail page read it.
export async function personInterestAtlas(personId: string) {
  const rows = await sql<
    {
      id: number;
      kind: "role" | "holding" | "deal";
      counterparty: string;
      counterparty_zh: string;
      org_key: string | null;
      role: string;
      stake_pct: number | null;
      amount_usd: number | null;
      started: string | null;
      ended: string | null;
      source_url: string;
      quote: string;
      reviewed: boolean;
      end_kind: string;
    }[]
  >`
    SELECT id::int AS id, kind, counterparty, counterparty_zh, org_key, role,
           stake_pct::float8 AS stake_pct, amount_usd::float8 AS amount_usd,
           started, ended, coalesce(end_kind, 'unknown') AS end_kind, source_url, quote, (reviewed_at IS NOT NULL) AS reviewed
    FROM interests
    WHERE person_id = ${personId} AND publication = 'published' AND superseded_at IS NULL
    ORDER BY CASE kind WHEN 'role' THEN 0 WHEN 'holding' THEN 1 ELSE 2 END, counterparty, started NULLS LAST
  `;

  const orgs = new Map<string, AtlasOrg>();
  for (const row of rows) {
    const key = row.org_key || orgKey(row.counterparty);
    const org = orgs.get(key) ?? { org_key: key, name: row.counterparty, name_zh: row.counterparty_zh, relations: [], exposures: [], financials: null };
    if (row.counterparty.length > org.name.length) org.name = row.counterparty;
    if (row.counterparty_zh && !org.name_zh) org.name_zh = row.counterparty_zh;
    org.relations.push({
      id: row.id,
      kind: row.kind,
      role: row.role,
      stake_pct: row.stake_pct,
      amount_usd: row.amount_usd,
      started: row.started,
      ended: row.ended,
      end_kind: (["ongoing", "ended", "planned"].includes(row.end_kind) ? row.end_kind : "unknown") as AtlasRelation["end_kind"],
      source_url: row.source_url,
      quote: row.quote,
      reviewed: row.reviewed,
    });
    orgs.set(key, org);
  }

  const keys = [...orgs.keys()];
  if (keys.length) {
    const exposures = await sql<
      {
        id: number;
        org_key: string;
        dimension: string;
        target: string;
        target_zh: string;
        country: string | null;
        metric_kind: string | null;
        metric_value: number | null;
        metric_year: number | null;
        started: string | null;
        ended: string | null;
        source_url: string;
        quote: string;
        reviewed: boolean;
        basis: string;
      }[]
    >`
      SELECT id::int AS id, org_key, dimension, target, target_zh, country,
             metric_kind, metric_value::float8 AS metric_value, metric_year,
             started, ended, source_url, quote, (reviewed_at IS NOT NULL) AS reviewed, basis
      FROM org_exposures
      WHERE org_key IN ${sql(keys)} AND publication = 'published'
      ORDER BY dimension, target
    `;
    for (const item of exposures) {
      const org = orgs.get(item.org_key);
      if (!org || !EXPOSURE_DIMENSIONS.has(item.dimension)) continue;
      const kind = item.metric_kind && METRIC_KINDS.has(item.metric_kind) ? item.metric_kind : null;
      org.exposures.push({
        id: item.id,
        dimension: item.dimension as AtlasExposure["dimension"],
        target: item.target,
        target_zh: item.target_zh,
        country: item.country,
        metric: kind && item.metric_value != null ? { kind: kind as NonNullable<AtlasExposure["metric"]>["kind"], value: item.metric_value, year: item.metric_year } : null,
        started: item.started,
        ended: item.ended,
        source_url: item.source_url,
        quote: item.quote,
        reviewed: item.reviewed,
        basis: item.basis === "sec_xbrl" ? "sec_xbrl" : "crawl",
      });
    }
    // A filed number replaces crawled rows of the same dimension (the crawl lost units and mixed up categories).
    for (const org of orgs.values()) {
      const filed = new Set(org.exposures.filter((e) => e.basis === "sec_xbrl").map((e) => e.dimension));
      if (filed.size) org.exposures = org.exposures.filter((e) => e.basis === "sec_xbrl" || !filed.has(e.dimension));
    }

    // Latest filing; a full-year one wins over a newer partial period only when they end on the same date.
    const financials = await sql<
      { org_key: string; revenue_usd: number; fiscal_year: number; source_url: string; form: string; period_start: string; period_end: string }[]
    >`
      SELECT DISTINCT ON (org_key) org_key, revenue_usd::float8 AS revenue_usd, fiscal_year, source_url, form,
             to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end
      FROM org_financials
      WHERE org_key IN ${sql(keys)}
      ORDER BY org_key, period_end DESC, (period_end - period_start) DESC
    `;
    for (const row of financials) {
      const org = orgs.get(row.org_key);
      if (org)
        org.financials = {
          revenue_usd: row.revenue_usd,
          year: row.fiscal_year,
          source_url: row.source_url,
          form: row.form,
          period_start: row.period_start,
          period_end: row.period_end,
        };
    }
  }

  const relationLinks = await sql<{ claim_id: string; target_id: number; level: string; reason: string }[]>`
    SELECT ci.claim_id, ci.interest_id::int AS target_id, ci.level, ci.reason
    FROM claim_interests ci
    JOIN interests i ON i.id = ci.interest_id
    JOIN claims c ON c.id = ci.claim_id
    WHERE i.person_id = ${personId} AND i.publication = 'published' AND c.publication = 'published'
  `;
  const exposureLinks = keys.length
    ? await sql<{ claim_id: string; target_id: number; level: string; reason: string }[]>`
        SELECT ce.claim_id, ce.exposure_id::int AS target_id, ce.level, ce.reason
        FROM claim_exposures ce
        JOIN org_exposures e ON e.id = ce.exposure_id
        JOIN claims c ON c.id = ce.claim_id
        WHERE e.org_key IN ${sql(keys)} AND e.publication = 'published' AND c.publication = 'published' AND c.person_id = ${personId}
      `
    : [];

  const claim_links: AtlasLink[] = [
    ...relationLinks.map((link) => ({
      claim_id: link.claim_id,
      target_kind: "relation" as const,
      target_id: link.target_id,
      level: link.level === "indirect" ? ("indirect" as const) : ("direct" as const),
      reason: link.reason,
    })),
    ...exposureLinks.map((link) => ({
      claim_id: link.claim_id,
      target_kind: "exposure" as const,
      target_id: link.target_id,
      level: link.level === "direct" ? ("direct" as const) : ("indirect" as const),
      reason: link.reason,
    })),
  ];

  return {
    status: rows.length > 0 ? ("collected" as const) : ("not_collected" as const),
    orgs: [...orgs.values()],
    claim_links,
  };
}
