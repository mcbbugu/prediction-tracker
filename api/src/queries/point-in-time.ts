// 严格时点（#8）：只用 T 那天之前已经存在于库里的信息，给下游评测用。
// 判定以 claim_events 里写入判定的时间为准；没有判定事件、拿不准什么时候判的，一律当作 T 时还没判。
// 证据只用 T 之前抓取的；没有抓取时间的不用。一致性对照只用 T 之前录入、两句话都说在 T 之前的。
import { sql } from "../core/db";

const JUDGED = new Set(["已兑现", "部分兑现", "未兑现", "证据不足"]);
// Events that write a claim's status. The latest one is when the current status became known.
export const JUDGE_ACTIONS = [
  "imported",
  "proposed",
  "verdict",
  "verdict_auto_applied",
  "verdict_accepted",
  "seed_autochecked",
  "disagreement_resolved",
  "challenge_accepted",
];

type Evidence = { url?: string; fetched_at?: string | null };

// The claim as it stood on asOf: a status judged on or after asOf goes back to 待定, later evidence is dropped.
export function claimAt<T extends { id: string; status: string; evidence: Evidence[] | null }>(claim: T, judgedAt: Map<string, string>, asOf: string): T {
  const at = judgedAt.get(claim.id);
  const known = JUDGED.has(claim.status) && at != null && at.slice(0, 10) < asOf;
  const evidence = (Array.isArray(claim.evidence) ? claim.evidence : []).filter((item) => item.fetched_at && item.fetched_at.slice(0, 10) < asOf);
  return { ...claim, status: known ? claim.status : "待定", evidence: known ? evidence : [] };
}

export type PairRow = {
  id: string;
  domain: string;
  topic: string;
  proposed_label: string;
  label: string | null;
  a_date: string | null;
  date: string | null;
  created_at: string;
  reviewed_at: string | null;
};

// A comparison counts only if it was recorded before asOf and both statements were made before asOf.
// A human label given on or after asOf is not used; the machine label from creation stands in.
export function pairsAt(rows: PairRow[], asOf: string) {
  return rows
    .filter((row) => row.created_at.slice(0, 10) < asOf && row.date != null && row.date < asOf && (row.a_date == null || row.a_date < asOf))
    .map((row) => ({ ...row, label: row.label && row.reviewed_at && row.reviewed_at.slice(0, 10) < asOf ? row.label : null }));
}

export async function judgedAtMap(personId?: string) {
  const rows = await sql<{ claim_id: string; at: string }[]>`
    SELECT claim_id, to_char(max(created_at), 'YYYY-MM-DD') AS at
    FROM claim_events
    WHERE action IN ${sql(JUDGE_ACTIONS)} ${personId ? sql`AND person_id = ${personId}` : sql``}
    GROUP BY claim_id
  `;
  return new Map(rows.map((row) => [row.claim_id, row.at]));
}
