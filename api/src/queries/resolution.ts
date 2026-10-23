import { sql } from "../core/db";

export async function resolutionStats() {
  const propositions = await sql<{ resolver: string; n: number }[]>`
    SELECT resolver, count(*)::int AS n
    FROM propositions
    WHERE superseded_by IS NULL
    GROUP BY resolver
    ORDER BY resolver
  `;
  const verdicts = await sql<{ resolved_by: string; n: number }[]>`
    SELECT coalesce(resolved_by, '未记录') AS resolved_by, count(*)::int AS n
    FROM claims
    WHERE publication = 'published' AND status IN ('已兑现', '部分兑现', '未兑现', '证据不足')
    GROUP BY 1
    ORDER BY 1
  `;
  const propositionTotal = propositions.reduce((sum, row) => sum + row.n, 0);
  const deterministic = propositions.filter((row) => row.resolver !== "model").reduce((sum, row) => sum + row.n, 0);
  return { propositions, proposition_total: propositionTotal, deterministic, model: propositionTotal - deterministic, verdicts };
}

export async function liveProposition(claimId: string) {
  const rows = await sql<{
    id: number;
    subject: string;
    metric: string;
    comparator: string | null;
    threshold: number | null;
    unit: string;
    deadline: string | null;
    resolver: string;
    spec_version: string;
  }[]>`
    SELECT id::int AS id, subject, metric, comparator, threshold::float8 AS threshold, unit,
           to_char(deadline, 'YYYY-MM-DD') AS deadline, resolver, spec_version
    FROM propositions
    WHERE claim_id = ${claimId} AND superseded_by IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}
