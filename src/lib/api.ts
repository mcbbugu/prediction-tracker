export type Evidence = { url: string };

export type Claim = {
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
  provenance?: string;
  reviewed?: boolean;
  // direct = 本人原话, reported = 可靠来源明确归于本人的转述.
  quote_kind?: "direct" | "reported" | string;
  // SPEC 利益关系: neutral note such as「说话时任特斯拉 CEO」, null when the claim does not touch the speaker's interests.
  interest_note?: string | null;
  // 改期合并 (formula v1.3): restatements of one commitment share a thread.
  thread_id?: string | null;
};

export type Person = {
  id: string;
  name: string;
  name_en: string;
  title: string;
  portrait_path: string | null;
  portrait_credit: string | null;
  portrait_source_url: string | null;
  portrait_license: string | null;
};

export type Score = {
  person_id?: string;
  domain: string;
  value: number | null;
  // 80% interval, 0–100; null below 3 judged claims.
  low: number | null;
  high: number | null;
  n: number;
  confidence: string;
  formula_version: string;
  // 证据不足 in this domain: void, not scored.
  voided?: number;
};

// SPEC 人物画像与综合分: per domain, composite = accuracy + consistency, every part listed.
export type ProfileRow = {
  domain: string;
  composite: { value: number | null; low: number | null; high: number | null; used: string[] };
  accuracy: { value: number | null; low: number | null; high: number | null; n: number; weight: number };
  consistency: { status: "not_collected"; weight: number };
  interests: { status: "not_collected" } | { status: "collected"; related: AccuracyPart; unrelated: AccuracyPart };
};

export type AccuracyPart = { value: number | null; low: number | null; high: number | null; n: number };

// SPEC 利益关系 (P12): never part of the score; shown beside it.
export type Interest = {
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

export type PersonInterests =
  | { status: "not_collected"; relations: Interest[] }
  | { status: "collected"; relations: Interest[]; related: AccuracyPart; unrelated: AccuracyPart };

export type HomePayload = {
  people: Person[];
  claims: Claim[];
  scores: (Score & { person_id: string })[];
  today: string;
};

export type ConsultEvaluation = {
  person_id: string;
  person_name: string;
  person_name_en: string;
  person_title: string;
  portrait_path: string | null;
  domain: string;
  score: number | null;
  prior_weight: number | null;
  verified_count: number;
  voided_count?: number;
  interval_80: { low: number; high: number } | null;
  min_required: number;
  confidence: string;
  formula_version: string;
  stance: "HIGH_PRIOR" | "MODERATE_PRIOR" | "SKEPTICAL_PRIOR" | "INSUFFICIENT_SAMPLE";
  counts: {
    fulfilled: number;
    partial: number;
    unfulfilled: number;
    pending: number;
  };
  directive: string;
  all_domains: Score[];
  exposures?: {
    org_key?: string;
    organisation: string;
    dimension: string;
    target: string;
    target_zh: string;
    metric: { kind: string; value: number; year: number | null } | null;
    level: "direct" | "indirect";
    reason: string;
    source_url: string;
  }[];
};

export type ConsultPayload = {
  query: string;
  timestamp: string;
  formula_version: string;
  min_scored_threshold: number;
  evaluations: ConsultEvaluation[];
  evidence_chain: (Claim & { relevance: number; decay_weight: number })[];
  trace: {
    step: string;
    title: string;
    status: string;
    detail: string;
  }[];
};

// The API as the browser reaches it (NEXT_PUBLIC_API_URL), and as the Next server reaches it (API_URL,
// e.g. a private network address in production). Both default to the local dev API.
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3011";

export function apiBase() {
  return process.env.API_URL || PUBLIC_API_URL;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`接口 ${response.status}`);
  return response.json() as Promise<T>;
}

// 画像旁证 (not in the composite): how often commitments slipped, and how many due claims could be judged.
export type Rescheduling = {
  commitments: number;
  rescheduled: number;
  rate: number | null;
  pushes: number;
  avg_delay_months: number | null;
  longest: { thread_id: string; times: number; first_said: string; first_deadline: string; last_deadline: string } | null;
};
export type Testability = { resolved: number; judged: number; voided: number; rate: number | null };
export type Indicators = {
  rescheduling: Rescheduling;
  testability: Testability;
  by_domain: Record<string, { rescheduling: Rescheduling; testability: Testability }>;
};
