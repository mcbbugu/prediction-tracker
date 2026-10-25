// 分数变化原因（025）：每次快照相对上一次，哪些已判定主张进来、出去或改了判定。
// 原来在前端 src/lib/score-changes.ts 里拿全量主张算；现在在这里算，分页下发。
import { sql } from "../core/db";
import { decodeCursor, encodeCursor } from "./claim-list";
import { latestScores } from "./records";

export type Snapshot = {
  domain: string;
  value: number | null;
  low: number | null;
  high: number | null;
  n: number;
  confidence: string;
  formula_version: string;
  computed_at: string;
  basis: { id: string; status: string }[] | null;
};

type ClaimRef = { id: string; quote_zh: string; status: string };

export type ChangeLine =
  | { kind: "added"; status: string; claim: ClaimRef | null }
  | { kind: "removed"; status: string; claim: ClaimRef | null }
  | { kind: "changed"; from: string; to: string; claim: ClaimRef | null }
  | { kind: "count"; from: number; to: number }
  | { kind: "formula"; version: string };

const sameScore = (a: Snapshot, b: Snapshot) =>
  a.n === b.n && (a.value ?? null) === (b.value ?? null) && (a.low ?? null) === (b.low ?? null) && (a.high ?? null) === (b.high ?? null);

const brief = (snap: Snapshot) => ({ value: snap.value, low: snap.low, high: snap.high, n: snap.n, formula_version: snap.formula_version });

// Snapshots that changed nothing a reader can see (pure bookkeeping, renamed domains) are dropped. Newest first.
export function explainChanges(snapshots: Snapshot[], claims: Map<string, ClaimRef>, liveDomains: Set<string>) {
  const ref = (id: string) => claims.get(id) ?? null;
  const ordered = [...snapshots].sort((a, b) => a.computed_at.localeCompare(b.computed_at));
  const last = new Map<string, Snapshot>();
  const changes: { domain: string; at: string; before: ReturnType<typeof brief> | null; after: ReturnType<typeof brief>; lines: ChangeLine[] }[] = [];
  for (const snap of ordered) {
    if (snap.confidence === "已移除" || !liveDomains.has(snap.domain)) continue;
    const prev = last.get(snap.domain) ?? null;
    last.set(snap.domain, snap);
    const lines: ChangeLine[] = [];
    if (prev?.basis && snap.basis) {
      const before = new Map(prev.basis.map((item) => [item.id, item.status]));
      const after = new Map(snap.basis.map((item) => [item.id, item.status]));
      for (const [id, status] of after) {
        if (!before.has(id)) lines.push({ kind: "added", status, claim: ref(id) });
        else if (before.get(id) !== status) lines.push({ kind: "changed", from: before.get(id)!, to: status, claim: ref(id) });
      }
      for (const [id, status] of before) if (!after.has(id)) lines.push({ kind: "removed", status, claim: ref(id) });
    } else if (!prev && snap.basis) {
      for (const item of snap.basis) lines.push({ kind: "added", status: item.status, claim: ref(item.id) });
    } else if ((prev?.n ?? 0) !== snap.n) {
      lines.push({ kind: "count", from: prev?.n ?? 0, to: snap.n });
    }
    if (prev && prev.formula_version !== snap.formula_version) lines.push({ kind: "formula", version: snap.formula_version });
    if (lines.length === 0 && (!prev || sameScore(prev, snap))) continue;
    // Nothing judged before or after: a rule or bookkeeping change a reader cannot see.
    if (snap.n === 0 && (prev?.n ?? 0) === 0) continue;
    changes.push({ domain: snap.domain, at: snap.computed_at, before: prev ? brief(prev) : null, after: brief(snap), lines });
  }
  return changes.reverse();
}

const changeKey = (change: { at: string; domain: string }) => `${change.at.replace(/\d/g, (d) => String(9 - Number(d)))}|${change.domain}`;

export async function personScoreChanges(personId: string, input: { domain?: string; cursor?: string; limit: number }) {
  const [snapshots, claims, live] = await Promise.all([
    sql<Snapshot[]>`
      SELECT domain, value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence, formula_version,
             to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS computed_at, basis
      FROM score_snapshots
      WHERE person_id = ${personId} AND slice = 'all'
      ORDER BY computed_at
    `,
    sql<ClaimRef[]>`SELECT id, quote_zh, status FROM claims WHERE person_id = ${personId} AND publication = 'published'`,
    latestScores(personId),
  ]);
  const all = explainChanges(snapshots, new Map(claims.map((claim) => [claim.id, claim])), new Set(live.map((row) => row.domain)));
  // Page in key order (newest first, ties by domain) so the cursor never skips or repeats.
  const scoped = (input.domain ? all.filter((change) => change.domain === input.domain) : all).sort((a, b) => (changeKey(a) < changeKey(b) ? -1 : 1));
  const after = decodeCursor(input.cursor);
  const rest = after == null ? scoped : scoped.filter((change) => changeKey(change) > after);
  const taken = rest.slice(0, input.limit);
  const domains: Record<string, number> = {};
  for (const change of all) domains[change.domain] = (domains[change.domain] ?? 0) + 1;
  return {
    changes: taken,
    next_cursor: rest.length > input.limit ? encodeCursor(changeKey(taken[taken.length - 1])) : null,
    total: scoped.length,
    domains,
  };
}
