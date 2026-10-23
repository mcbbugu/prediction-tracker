import { sql } from "../core/db";

export const DISCLOSURE = "判定由 AI 完成，尚未经人工校准；准确率见 /method#eval";

export type VerdictTier = "human" | "seed_autocheck" | "machine" | "on_demand";

const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);
const HUMAN_ACTIONS = new Set(["verdict_accepted", "disagreement_resolved", "challenge_accepted"]);

export function verdictTier(claim: {
  status: string;
  provenance: string;
  events?: { action: string; actor?: string; note?: string }[];
}): VerdictTier | null {
  if (!JUDGED.has(claim.status)) return null;
  const events = claim.events ?? [];
  const actions = new Set(events.map((event) => event.action));
  if ([...actions].some((action) => HUMAN_ACTIONS.has(action))) return "human";
  if (claim.provenance === "manual" && [...actions].some((action) => action.startsWith("seed_autocheck"))) return "seed_autocheck";
  if (claim.provenance === "manual") return "human";
  if (events.some((event) => (event.note ?? "").includes("按需分析"))) return "on_demand";
  return "machine";
}

export function tallyTiers(claims: { status: string; provenance: string; events?: { action: string; note?: string }[] }[]) {
  const tiers: Record<VerdictTier, number> = { human: 0, seed_autocheck: 0, machine: 0, on_demand: 0 };
  for (const claim of claims) {
    const tier = verdictTier(claim);
    if (tier) tiers[tier] += 1;
  }
  return tiers;
}

export function challengeReview(before: string, after: string) {
  if (before !== after) return { changed: true as const, label: "有争议" };
  return { changed: false as const, label: "已复核，结论不变" };
}

export async function eventsForClaims(ids: string[]) {
  const grouped = new Map<string, { action: string; actor: string; note: string }[]>();
  if (!ids.length) return grouped;
  const rows = await sql<{ claim_id: string; action: string; actor: string; note: string }[]>`
    SELECT claim_id, action, actor, coalesce(note, '') AS note
    FROM claim_events
    WHERE claim_id IN ${sql(ids)}
  `;
  for (const row of rows) {
    const list = grouped.get(row.claim_id) ?? [];
    list.push(row);
    grouped.set(row.claim_id, list);
  }
  return grouped;
}

export async function eventsByClaim(personId: string) {
  const rows = await sql<{ claim_id: string; action: string; actor: string; note: string }[]>`
    SELECT claim_id, action, actor, coalesce(note, '') AS note
    FROM claim_events
    WHERE person_id = ${personId}
  `;
  const grouped = new Map<string, { action: string; actor: string; note: string }[]>();
  for (const row of rows) {
    const list = grouped.get(row.claim_id) ?? [];
    list.push(row);
    grouped.set(row.claim_id, list);
  }
  return grouped;
}
