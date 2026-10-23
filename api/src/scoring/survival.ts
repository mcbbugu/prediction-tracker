// 承诺的延迟比。改期串算一条，从第一次说的那天起。已兑现是事件，未兑现和待定在今天删失。
// Kaplan–Meier 是乘积极限：同一时刻先计事件，再把删失移出风险集。

export const DELAY_VERSION = "delay-v1";
export const SHRINK_K = 8;

export type SurvivalClaim = {
  id: string;
  person_id: string;
  category: string;
  status: string;
  kind: string;
  published_date: string;
  deadline: string;
  thread_id: string | null;
  resolved_on: string | null;
};

export type Observation = {
  person_id: string;
  category: string;
  promised: number;
  time: number;
  event: boolean;
  partial: boolean;
};

export type KmPoint = { time: number; survival: number; atRisk: number; events: number };

const DAY = 86_400_000;

export function daysBetween(from: string, to: string) {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((end - start) / DAY);
}

export function addDays(from: string, days: number) {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  return new Date(start + Math.round(days) * DAY).toISOString().slice(0, 10);
}

export function promiseObservations(claims: SurvivalClaim[], today: string): Observation[] {
  const groups = new Map<string, SurvivalClaim[]>();
  for (const claim of claims) {
    if (claim.kind !== "promise") continue;
    const key = `${claim.person_id}|${claim.thread_id || `self:${claim.id}`}`;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  const rows: Observation[] = [];
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => a.published_date.localeCompare(b.published_date) || a.deadline.localeCompare(b.deadline));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (last.status === "证据不足") continue;
    const promised = daysBetween(first.published_date, last.deadline);
    if (promised <= 0) continue;
    const fulfilled = last.status === "已兑现" || last.status === "部分兑现";
    const end = fulfilled ? last.resolved_on || last.deadline : today;
    const elapsed = Math.max(0, daysBetween(first.published_date, end));
    rows.push({
      person_id: first.person_id,
      category: last.category,
      promised,
      time: Math.round((elapsed / promised) * 1000) / 1000,
      event: fulfilled,
      partial: last.status === "部分兑现",
    });
  }
  return rows;
}

export function kaplanMeier(rows: { time: number; event: boolean }[]): KmPoint[] {
  const sorted = [...rows].sort((a, b) => a.time - b.time || Number(b.event) - Number(a.event));
  const points: KmPoint[] = [{ time: 0, survival: 1, atRisk: rows.length, events: 0 }];
  let survival = 1;
  let i = 0;
  while (i < sorted.length) {
    const time = sorted[i].time;
    const atRisk = sorted.length - i;
    let events = 0;
    while (i < sorted.length && sorted[i].time === time && sorted[i].event) {
      events += 1;
      i += 1;
    }
    if (events > 0 && atRisk > 0) {
      survival *= 1 - events / atRisk;
      points.push({ time, survival: Math.round(survival * 10000) / 10000, atRisk, events });
    }
    while (i < sorted.length && sorted[i].time === time && !sorted[i].event) i += 1;
  }
  return points;
}

// p 是分布的分位（0.5 为中位数）。生存曲线不再降到 1-p 以下时，分位数是无穷。
export function survivalQuantile(points: KmPoint[], p: number): number | null {
  const target = 1 - p;
  for (const point of points) {
    if (point.events > 0 && point.survival <= target + 1e-9) return point.time;
  }
  return null;
}

export function mixQuantile(person: number | null, domain: number | null, n: number, k = SHRINK_K) {
  if (n >= k || person == null || domain == null) return person;
  const weight = n / (n + k);
  return Math.round((weight * person + (1 - weight) * domain) * 1000) / 1000;
}

export type DelayEstimate = {
  n: number;
  censored: number;
  partial: number;
  median: number | null;
  low: number | null;
  high: number | null;
  shrunk: boolean;
  curve: KmPoint[];
};

export function estimateDelay(personRows: Observation[], domainRows: Observation[]): DelayEstimate {
  const curve = kaplanMeier(personRows);
  const domainCurve = kaplanMeier(domainRows);
  const n = personRows.length;
  const shrunk = n > 0 && n < SHRINK_K;
  const pick = (p: number) => (shrunk ? mixQuantile(survivalQuantile(curve, p), survivalQuantile(domainCurve, p), n) : survivalQuantile(curve, p));
  let low = pick(0.1);
  let median = pick(0.5);
  let high = pick(0.9);
  if (low != null && median != null && low > median) low = median;
  if (high != null && median != null && high < median) high = median;
  return {
    n,
    censored: personRows.filter((row) => !row.event).length,
    partial: personRows.filter((row) => row.partial).length,
    median,
    low,
    high,
    shrunk,
    curve,
  };
}

export function predictWhen(saidOn: string, deadline: string, estimate: Pick<DelayEstimate, "median" | "low" | "high">) {
  if (estimate.high == null || estimate.median == null) {
    return { date: null as string | null, low: null as string | null, high: null as string | null, note: "多数同类承诺至今未兑现" };
  }
  const promised = Math.max(1, daysBetween(saidOn, deadline));
  return {
    date: addDays(saidOn, promised * estimate.median),
    low: estimate.low == null ? null : addDays(saidOn, promised * estimate.low),
    high: addDays(saidOn, promised * estimate.high),
    note: null as string | null,
  };
}

export function delaySentence(estimate: Pick<DelayEstimate, "n" | "censored" | "median" | "low" | "high" | "shrunk">) {
  if (estimate.n === 0) return "还没有可用来估计延迟的承诺。";
  if (estimate.median == null || estimate.high == null) return `多数同类承诺至今未兑现（${estimate.n} 条，其中 ${estimate.censored} 条还没兑现）。`;
  const round = (value: number) => Math.round(value * 10) / 10;
  const band = estimate.low == null ? "" : `（${round(estimate.low)}–${round(estimate.high ?? estimate.median ?? estimate.low)}）`;
  const borrowed = estimate.shrunk ? "样本少，参考同领域。" : "";
  return `承诺通常在期限的 ${round(estimate.median)} 倍时间后兑现${band}。${borrowed}`;
}
