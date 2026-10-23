// 可信度：一致记 1，不一致记 0。和兑现率同一套 Beta 后验，半衰期 3 年，κ=4，先验 0.5。
// 一个领域对照少于 5 条不出分，只列例子。
import { betaQuantile } from "./score";

export const MIN_CONSISTENCY = 5;
const KAPPA = 4;
const PRIOR = 0.5;
const HALF_LIFE_DAYS = 3 * 365;

export type ConsistencyRow = { domain: string; consistent: boolean; date: string };

function weight(date: string, now: Date) {
  const then = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const days = Math.max(0, (now.getTime() - then) / 86_400_000);
  return 2 ** (-days / HALF_LIFE_DAYS);
}

export function scoreConsistency(rows: ConsistencyRow[], now = new Date()) {
  let weighted = 0;
  let weightedOutcome = 0;
  for (const row of rows) {
    const w = weight(row.date, now);
    weighted += w;
    if (row.consistent) weightedOutcome += w;
  }
  const n = rows.length;
  const alpha = KAPPA * PRIOR + weightedOutcome;
  const beta = KAPPA * (1 - PRIOR) + (weighted - weightedOutcome);
  if (n < MIN_CONSISTENCY) {
    return { n, status: "examples_only" as const, value: null as number | null, low: null as number | null, high: null as number | null, alpha, beta };
  }
  const value = Math.round(((100 * alpha) / (alpha + beta)) * 10) / 10;
  return {
    n,
    status: "scored" as const,
    value,
    low: Math.round(100 * betaQuantile(0.1, alpha, beta)),
    high: Math.round(100 * betaQuantile(0.9, alpha, beta)),
    alpha,
    beta,
  };
}
