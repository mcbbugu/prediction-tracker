import { sql } from "../core/db";
import { scoreConsistency, type ConsistencyRow } from "./consistency";
import { DELAY_VERSION, delaySentence, estimateDelay, promiseObservations, type SurvivalClaim } from "./survival";

// v1.1 (2026-10-21): same formula; a score and its 80% interval show from the first judged claim (no 3/8 tiers).
// v1.2 (2026-10-21): half-life 180 days → 3 years, so a record from years ago still counts.
// v1.3 (2026-10-22): 改期合并 — restatements of one commitment (same thread_id) share weight: k judged claims
// in a thread count √k in total, so a repeatedly rescheduled promise is evidence without swamping the domain.
// 证据不足 stays void (not scored); the number voided is reported next to the score. 部分兑现 = 0.5.
export const FORMULA_VERSION = "v1.3";
const KAPPA = 4;
const PRIOR = 0.5;
// A judged claim's weight halves every HALF_LIFE_DAYS after its deadline. 3 years: recent outcomes count more,
// but a promise missed five years ago is still evidence about how this person talks.
export const HALF_LIFE_DAYS = 3 * 365;
// One judged claim is enough to show a score; the Beta prior pulls small samples toward 50 and the interval
// shows how unsure that is. Zero judged claims → 样本不足.
export const MIN_JUDGED = 1;
const INTERVAL_MASS = 0.8;

const OUTCOME: Record<string, number> = {
  已兑现: 1,
  部分兑现: 0.5,
  未兑现: 0,
};

export type ScoredRow = {
  category: string;
  status: string;
  deadline: string;
  evidence_count: number;
  thread_id?: string | null;
  kind?: string | null;
};

// 证据不足: the deadline passed but the outcome cannot be established from sources. Void, not scored.
export const VOID_STATUS = "证据不足";

function weight(deadline: string, now: Date) {
  const then = Date.parse(`${deadline}T00:00:00Z`);
  const days = Math.max(0, (now.getTime() - then) / 86_400_000);
  return 2 ** (-days / HALF_LIFE_DAYS);
}

function confidence(n: number) {
  if (n < 3) return "很低";
  if (n < 16) return "低";
  if (n < 40) return "中";
  return "高";
}

// Regularized incomplete beta I_x(a, b), continued fraction (Numerical Recipes 6.4).
function betacf(x: number, a: number, b: number) {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return h;
}

function lgamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const coef of g) ser += coef / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaCdf(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(x, a, b)) / a : 1 - (front * betacf(1 - x, b, a)) / b;
}

export function betaQuantile(p: number, a: number, b: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function scoreDomain(rows: ScoredRow[], now = new Date()) {
  let weightedEvidence = 0;
  let weightedOutcome = 0;
  let n = 0;
  // Judged claims per thread; a claim without a thread is a thread of one.
  const threadKey = (row: ScoredRow, index: number) => row.thread_id || `self:${index}`;
  const threadSize = new Map<string, number>();
  const scored = (row: ScoredRow) => OUTCOME[row.status] !== undefined && row.evidence_count > 0;
  rows.forEach((row, index) => {
    if (scored(row)) threadSize.set(threadKey(row, index), (threadSize.get(threadKey(row, index)) ?? 0) + 1);
  });
  const voided = rows.filter((row) => row.status === VOID_STATUS || (OUTCOME[row.status] !== undefined && row.evidence_count <= 0)).length;
  for (const [index, row] of rows.entries()) {
    const outcome = OUTCOME[row.status];
    if (outcome === undefined || row.evidence_count <= 0) continue;
    const reliability = 1;
    const share = 1 / Math.sqrt(threadSize.get(threadKey(row, index)) ?? 1);
    const w = weight(row.deadline, now) * share;
    weightedEvidence += w * reliability;
    weightedOutcome += w * reliability * outcome;
    n += 1;
  }
  // The v1 score is the mean of Beta(alpha, beta); the 80% interval is its 10th–90th percentile.
  const alpha = KAPPA * PRIOR + weightedOutcome;
  const beta = KAPPA * (1 - PRIOR) + (weightedEvidence - weightedOutcome);
  const tail = (1 - INTERVAL_MASS) / 2;
  if (n < MIN_JUDGED) {
    return { n, voided, value: null as number | null, low: null as number | null, high: null as number | null, confidence: "不足", alpha, beta };
  }
  const interval = { low: Math.round(100 * betaQuantile(tail, alpha, beta)), high: Math.round(100 * betaQuantile(1 - tail, alpha, beta)) };
  const value = (100 * alpha) / (alpha + beta);
  return { n, voided, value: Math.round(value * 10) / 10, ...interval, confidence: confidence(n), alpha, beta };
}

// ---- Composite score (SPEC 人物画像与综合分): combined inside one domain only, never across domains.

export const COMPOSITE_WEIGHTS = { accuracy: 0.7, consistency: 0.3 } as const;
const COMPOSITE_SAMPLES = 2000;

// `exact` is the part's own analytic score; used as-is when it is the only part, so the two never disagree.
export type Part = {
  key: keyof typeof COMPOSITE_WEIGHTS;
  alpha: number;
  beta: number;
  n: number;
  exact?: { value: number | null; low: number | null; high: number | null };
};

// Deterministic PRNG so the same inputs always give the same interval (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gamma(shape, 1) by Marsaglia–Tsang; shape < 1 via the boost Gamma(a+1)·U^(1/a).
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * rand() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = rand() || 1e-12;
      const u2 = rand();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a: number, b: number, rand: () => number) {
  const x = gamma(a, rand);
  return x / (x + gamma(b, rand));
}

// Parts with no judged items sit out; the remaining weights are renormalised.
export function compositeScore(parts: Part[]) {
  const used = parts.filter((part) => part.n >= MIN_JUDGED);
  if (used.length === 0) return { value: null as number | null, low: null as number | null, high: null as number | null, used: [] as string[] };
  if (used.length === 1 && used[0].exact) return { ...used[0].exact, used: [used[0].key] as string[] };
  const total = used.reduce((sum, part) => sum + COMPOSITE_WEIGHTS[part.key], 0);
  const rand = rng(used.reduce((seed, part) => seed * 31 + Math.round(part.alpha * 1000) + Math.round(part.beta * 7), 17));
  const draws: number[] = [];
  for (let i = 0; i < COMPOSITE_SAMPLES; i += 1) {
    let sum = 0;
    for (const part of used) sum += (COMPOSITE_WEIGHTS[part.key] / total) * betaSample(part.alpha, part.beta, rand);
    draws.push(100 * sum);
  }
  draws.sort((a, b) => a - b);
  const mean = draws.reduce((sum, v) => sum + v, 0) / draws.length;
  const at = (q: number) => draws[Math.min(draws.length - 1, Math.floor(q * draws.length))];
  return {
    value: Math.round(mean * 10) / 10,
    low: Math.round(at(0.1)),
    high: Math.round(at(0.9)),
    used: used.map((part) => part.key),
  };
}

function accuracyPart(rows: ScoredRow[]) {
  const scored = scoreDomain(rows);
  return { value: scored.value, low: scored.low, high: scored.high, n: scored.n };
}

export type FulfillmentPart = { value: number | null; low: number | null; high: number | null; n: number; deprecated?: boolean };

// all 是承诺和预测混在一起的旧兑现率，接口仍返回，标 deprecated。uncertain 两边都不计。
export function fulfillmentSplit(rows: ScoredRow[], now = new Date()) {
  const pack = (list: ScoredRow[]) => {
    const scored = scoreDomain(list, now);
    return { value: scored.value, low: scored.low, high: scored.high, n: scored.n };
  };
  return {
    all: { ...pack(rows), deprecated: true as const },
    promise: pack(rows.filter((row) => row.kind === "promise")),
    forecast: pack(rows.filter((row) => row.kind === "forecast")),
  };
}

export const COMPOSITE_VERSION = "v1.4";

// Per-domain profile from published claims.
// Interests (P12) never enter the composite; when collected, accuracy is split into related / unrelated claims.
// Consistency (P13) joins the composite only when that domain has at least 5 published comparisons.
export function personProfile(rows: (ScoredRow & { related?: boolean })[], interestsCollected = false, consistency: ConsistencyRow[] = []) {
  const byDomain = new Map<string, (ScoredRow & { related?: boolean })[]>();
  for (const row of rows) byDomain.set(row.category, [...(byDomain.get(row.category) ?? []), row]);
  return [...byDomain].map(([domain, list]) => {
    const accuracy = scoreDomain(list);
    const fulfillment = fulfillmentSplit(list);
    const compared = scoreConsistency(consistency.filter((row) => row.domain === domain));
    const parts: Part[] = [
      { key: "accuracy", alpha: accuracy.alpha, beta: accuracy.beta, n: accuracy.n, exact: { value: accuracy.value, low: accuracy.low, high: accuracy.high } },
    ];
    if (compared.status === "scored") {
      parts.push({ key: "consistency", alpha: compared.alpha, beta: compared.beta, n: compared.n, exact: { value: compared.value, low: compared.low, high: compared.high } });
    }
    const consistencyView = compared.status === "scored"
      ? { status: "scored" as const, value: compared.value, low: compared.low, high: compared.high, n: compared.n, weight: COMPOSITE_WEIGHTS.consistency }
      : compared.n > 0
        ? { status: "examples_only" as const, n: compared.n, weight: COMPOSITE_WEIGHTS.consistency }
        : { status: "not_collected" as const, weight: COMPOSITE_WEIGHTS.consistency };
    return {
      domain,
      composite: compositeScore(parts),
      accuracy: { value: accuracy.value, low: accuracy.low, high: accuracy.high, n: accuracy.n, weight: COMPOSITE_WEIGHTS.accuracy },
      fulfillment,
      consistency: consistencyView,
      interests: interestsCollected
        ? {
            status: "collected" as const,
            related: accuracyPart(list.filter((row) => row.related)),
            unrelated: accuracyPart(list.filter((row) => !row.related)),
          }
        : { status: "not_collected" as const },
    };
  });
}

// Across all domains: accuracy of claims touching the speaker's own interests vs the rest.
export function interestSplit(rows: (ScoredRow & { related?: boolean })[]) {
  return {
    related: accuracyPart(rows.filter((row) => row.related)),
    unrelated: accuracyPart(rows.filter((row) => !row.related)),
  };
}

export async function recomputeAll(action: string) {
  const people = await sql<{ person_id: string }[]>`SELECT DISTINCT person_id FROM claims`;
  for (const row of people) await recomputeScores(row.person_id, { action });
  return people.length;
}

export async function recomputeScores(
  personId: string,
  trigger: { claim_id?: string; action?: string } = {},
) {
  const rows = await sql<(ScoredRow & { id: string })[]>`
    SELECT id,
           category,
           status,
           to_char(deadline, 'YYYY-MM-DD') AS deadline,
           jsonb_array_length(evidence) AS evidence_count,
           thread_id,
           kind
    FROM claims
    WHERE person_id = ${personId} AND publication = 'published'
  `;
  const byDomain = new Map<string, (ScoredRow & { id: string })[]>();
  for (const row of rows) {
    const list = byDomain.get(row.category) ?? [];
    list.push(row);
    byDomain.set(row.category, list);
  }
  const latest = await sql<
    {
      domain: string;
      slice: string;
      value: number | null;
      low: number | null;
      high: number | null;
      n: number;
      confidence: string;
      formula_version: string;
      basis: { id: string; status: string }[] | null;
      voided: number;
    }[]
  >`
    SELECT DISTINCT ON (domain, slice) domain, coalesce(slice, 'all') AS slice,
           value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence,
           formula_version, basis, voided
    FROM score_snapshots
    WHERE person_id = ${personId}
    ORDER BY domain, slice, computed_at DESC
  `;
  const previous = new Map(latest.map((row) => [`${row.domain}|${row.slice}`, row]));
  // A domain that no longer has any published claim (e.g. after a remap) gets a closing n=0 snapshot.
  for (const [key, before] of previous) {
    const domain = key.slice(0, key.lastIndexOf("|"));
    if (byDomain.has(domain) || before.confidence === "已移除") continue;
    const slice = key.slice(key.lastIndexOf("|") + 1);
    await sql`
      INSERT INTO score_snapshots (person_id, domain, slice, value, n, confidence, formula_version, trigger_claim_id, trigger_action)
      VALUES (${personId}, ${domain}, ${slice}, ${null}, 0, '已移除', ${FORMULA_VERSION}, ${trigger.claim_id ?? null}, ${trigger.action ?? null})
    `;
  }
  // Snapshots are append-only: a new row is written when the value, the sample, the set of counted claims
  // (basis) or the formula version changes. basis lets the site say which claims moved the score.
  // all 是旧的合并兑现率；promise / forecast 分开计，uncertain 不进任何一边。
  for (const [domain, domainRows] of byDomain) {
    const slices = [
      ["all", domainRows],
      ["promise", domainRows.filter((row) => row.kind === "promise")],
      ["forecast", domainRows.filter((row) => row.kind === "forecast")],
    ] as const;
    for (const [slice, rows] of slices) {
      const scored = scoreDomain(rows);
      const basis = rows
        .filter((row) => row.status in OUTCOME)
        .map((row) => ({ id: row.id, status: row.status }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const before = previous.get(`${domain}|${slice}`);
      if (
        before &&
        before.confidence !== "已移除" &&
        before.formula_version === FORMULA_VERSION &&
        before.n === scored.n &&
        before.voided === scored.voided &&
        (before.value ?? null) === scored.value &&
        (before.low ?? null) === scored.low &&
        (before.high ?? null) === scored.high &&
        JSON.stringify(before.basis ?? null) === JSON.stringify(basis)
      )
        continue;
      await sql`
        INSERT INTO score_snapshots (person_id, domain, slice, value, low, high, n, confidence, formula_version, trigger_claim_id, trigger_action, basis, voided)
        VALUES (
          ${personId},
          ${domain},
          ${slice},
          ${scored.value},
          ${scored.low},
          ${scored.high},
          ${scored.n},
          ${scored.confidence},
          ${FORMULA_VERSION},
          ${trigger.claim_id ?? null},
          ${trigger.action ?? null},
          ${sql.json(basis)},
          ${scored.voided}
        )
      `;
    }
  }
  await refreshDelay(personId);
}

async function refreshDelay(personId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const claims = await sql<SurvivalClaim[]>`
    SELECT c.id, c.person_id, c.category, c.status, c.kind, c.thread_id,
           to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
           to_char(c.deadline, 'YYYY-MM-DD') AS deadline,
           coalesce(
             (SELECT to_char(min(s.fetched_at), 'YYYY-MM-DD')
              FROM sources s
              WHERE jsonb_typeof(c.evidence) = 'array'
                AND s.url IN (SELECT e->>'url' FROM jsonb_array_elements(c.evidence) e WHERE e->>'url' IS NOT NULL)),
             (SELECT to_char(min(ev.created_at), 'YYYY-MM-DD')
              FROM claim_events ev
              WHERE ev.claim_id = c.id AND ev.action IN ('verdict', 'verdict_auto_applied'))
           ) AS resolved_on
    FROM claims c
    WHERE c.publication = 'published' AND c.kind = 'promise'
  `;
  const observations = promiseObservations(claims, today);
  const mine = observations.filter((row) => row.person_id === personId);
  const domains = ["", ...new Set(mine.map((row) => row.category))];
  for (const domain of domains) {
    const personRows = domain ? mine.filter((row) => row.category === domain) : mine;
    if (personRows.length === 0) continue;
    const pool = domain ? observations.filter((row) => row.category === domain) : observations;
    const estimate = estimateDelay(personRows, pool);
    await sql`
      INSERT INTO delay_profiles (person_id, domain, n, censored, partial, median, low, high, curve, shrunk, version)
      VALUES (
        ${personId}, ${domain}, ${estimate.n}, ${estimate.censored}, ${estimate.partial},
        ${estimate.median}, ${estimate.low}, ${estimate.high}, ${sql.json(estimate.curve)},
        ${estimate.shrunk}, ${DELAY_VERSION}
      )
    `;
  }
}

export async function latestDelay(personId: string) {
  const rows = await sql<
    { domain: string; n: number; censored: number; partial: number; median: number | null; low: number | null; high: number | null; shrunk: boolean; curve: { time: number; survival: number }[] }[]
  >`
    SELECT DISTINCT ON (domain) domain, n, censored, partial,
           median::float8 AS median, low::float8 AS low, high::float8 AS high, shrunk, curve
    FROM delay_profiles
    WHERE person_id = ${personId}
    ORDER BY domain, computed_at DESC
  `;
  return rows.map((row) => ({ ...row, sentence: delaySentence(row) }));
}

// pnpm api:rescore — recompute every person's domain scores (e.g. after the interval was added).
if (import.meta.main) {
  const { migrate } = await import("../core/migrate");
  await migrate();
  console.log(`重算了 ${await recomputeAll("rescore")} 个人的领域分。`);
  await sql.end();
}
