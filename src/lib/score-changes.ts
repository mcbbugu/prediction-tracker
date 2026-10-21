import type { Claim, Score } from "@/lib/api";

export type Snapshot = Score & {
  trigger_action: string | null;
  computed_at: string;
  basis?: { id: string; status: string }[] | null;
};

export type ChangeLine =
  | { kind: "added"; status: string; claim?: Claim }
  | { kind: "removed"; status: string; claim?: Claim }
  | { kind: "changed"; from: string; to: string; claim?: Claim }
  | { kind: "count"; from: number; to: number }
  | { kind: "formula"; version: string };

export type ScoreChange = {
  domain: string;
  at: string;
  before: Snapshot | null;
  after: Snapshot;
  lines: ChangeLine[];
};

const sameScore = (a: Snapshot, b: Snapshot) =>
  a.n === b.n && (a.value ?? null) === (b.value ?? null) && (a.low ?? null) === (b.low ?? null) && (a.high ?? null) === (b.high ?? null);

// Why a person's score moved, in terms of their own record: which judged claims came in, went out or changed
// verdict. Snapshots that changed nothing a reader can see (pure bookkeeping, renamed domains) are dropped.
export function explainChanges(snapshots: Snapshot[], claims: Claim[], liveDomains: Set<string>): ScoreChange[] {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const ordered = [...snapshots].sort((a, b) => a.computed_at.localeCompare(b.computed_at));
  const last = new Map<string, Snapshot>();
  const changes: ScoreChange[] = [];
  for (const snap of ordered) {
    if (snap.confidence === "已移除" || !liveDomains.has(snap.domain)) continue;
    const prev = last.get(snap.domain) ?? null;
    last.set(snap.domain, snap);
    const lines: ChangeLine[] = [];
    if (prev?.basis && snap.basis) {
      const before = new Map(prev.basis.map((item) => [item.id, item.status]));
      const after = new Map(snap.basis.map((item) => [item.id, item.status]));
      for (const [id, status] of after) {
        if (!before.has(id)) lines.push({ kind: "added", status, claim: byId.get(id) });
        else if (before.get(id) !== status) lines.push({ kind: "changed", from: before.get(id)!, to: status, claim: byId.get(id) });
      }
      for (const [id, status] of before) if (!after.has(id)) lines.push({ kind: "removed", status, claim: byId.get(id) });
    } else if (!prev && snap.basis) {
      for (const item of snap.basis) lines.push({ kind: "added", status: item.status, claim: byId.get(item.id) });
    } else if ((prev?.n ?? 0) !== snap.n) {
      lines.push({ kind: "count", from: prev?.n ?? 0, to: snap.n });
    }
    if (prev && prev.formula_version !== snap.formula_version) lines.push({ kind: "formula", version: snap.formula_version });
    if (lines.length === 0 && (!prev || sameScore(prev, snap))) continue;
    // Nothing judged before or after: a rule or bookkeeping change a reader cannot see.
    if (snap.n === 0 && (prev?.n ?? 0) === 0) continue;
    changes.push({ domain: snap.domain, at: snap.computed_at, before: prev, after: snap, lines });
  }
  return changes.reverse();
}
