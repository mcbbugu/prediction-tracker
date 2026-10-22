import { getJson, type Interest } from "@/lib/api";

// SPEC 利益关系的三层数据. Layer 1: person ↔ organisation; layer 2: organisation ↔ the outside world;
// layer 3: claim ↔ the relation or exposure it touches.
export type Dimension = "region" | "facility" | "supplier" | "customer" | "partner" | "investment";

export type Relation = {
  id: number;
  kind: "role" | "holding" | "deal";
  role: string;
  stake_pct: number | null;
  amount_usd: number | null;
  started: string | null;
  ended: string | null;
  source_url: string;
  quote: string;
  reviewed: boolean;
  // 利益关系双时态: ongoing / ended / planned / unknown (no end date recorded).
  end_kind?: "ongoing" | "ended" | "planned" | "unknown";
  // Derived on load (see settleCurrent): whether to treat this tie as current.
  current?: boolean;
};

export type Exposure = {
  id: number;
  dimension: Dimension;
  target: string;
  target_zh: string;
  country: string | null;
  metric: { kind: "revenue_share" | "production_share" | "amount_usd" | "stake_pct"; value: number; year: number | null } | null;
  started: string | null;
  ended: string | null;
  source_url: string;
  quote: string;
  reviewed: boolean;
  // sec_xbrl = read from a 10-K's XBRL; crawl = the frozen 2026-10 web crawl, shown as unverified.
  basis?: "sec_xbrl" | "crawl";
};

// Latest annual revenue from filings (SPEC 推算规则).
// form / period say what the number covers; only a ~12-month period feeds 推算 (see money-flow).
export type Financials = {
  revenue_usd: number;
  year: number | null;
  source_url: string;
  form?: string;
  period_start?: string;
  period_end?: string;
};

// How many months a filing's revenue covers (12 when unknown, as for older annual-only rows).
export function periodMonths(f: Financials) {
  if (!f.period_start || !f.period_end) return 12;
  return Math.round((Date.parse(f.period_end) - Date.parse(f.period_start)) / (30.44 * 86_400_000));
}

// "FY2025" for a full year, "2026 上半年" / "2026 前三季度" / "2026 Q1" for partial periods.
export function periodLabel(f: Financials) {
  const months = periodMonths(f);
  const year = f.period_end?.slice(0, 4) ?? String(f.year ?? "");
  if (months >= 11) return f.year ? `FY${f.year}` : year;
  if (months >= 8) return `${year} 前三季度`;
  if (months >= 5) return `${year} 上半年`;
  return `${year} 单季`;
}

export type Org = {
  org_key: string;
  name: string;
  name_zh: string;
  relations: Relation[];
  exposures: Exposure[];
  financials?: Financials | null;
};

export type ClaimLink = {
  claim_id: string;
  target_kind: "relation" | "exposure";
  target_id: number;
  level: "direct" | "indirect";
  reason: string;
};

export type InterestsPayload = { status: "collected" | "not_collected"; orgs: Org[]; claim_links: ClaimLink[]; layered: boolean };

export const DIMENSION_LABEL: Record<Dimension, string> = {
  region: "地域",
  facility: "生产场地",
  supplier: "供应商",
  customer: "客户",
  partner: "合作",
  investment: "投资",
};

export const KIND_LABEL: Record<Relation["kind"], string> = { role: "任职", holding: "持股", deal: "交易" };

// Until GET /v1/people/:id/interests exists, layer 1 is built from the person payload's relations.
// The stake is read from the relation's (already verified) description, e.g. "持股约20.3%", and marked as such.
function fromRelations(relations: Interest[]): InterestsPayload {
  const byOrg = new Map<string, Org>();
  for (const item of relations) {
    const key = item.counterparty.toLowerCase().replace(/[,.]|\binc\b/g, "").trim();
    const org = byOrg.get(key) ?? { org_key: key, name: item.counterparty, name_zh: item.counterparty_zh, relations: [], exposures: [] };
    const pct = item.kind === "holding" ? item.role.match(/(\d+(?:\.\d+)?)\s*%/) : null;
    org.relations.push({
      id: item.id,
      kind: item.kind,
      role: item.role,
      stake_pct: pct ? Number(pct[1]) : null,
      amount_usd: null,
      started: item.started,
      ended: item.ended,
      source_url: item.source_url,
      quote: item.quote,
      reviewed: item.reviewed,
    });
    if (!org.name_zh && item.counterparty_zh) org.name_zh = item.counterparty_zh;
    byOrg.set(key, org);
  }
  return { status: relations.length ? "collected" : "not_collected", orgs: [...byOrg.values()], claim_links: [], layered: false };
}

// A tie with no recorded end date is current only if the person still holds a confirmed tie at the same
// organisation (e.g. Huang's 3.6% Nvidia stake while he is CEO); otherwise it is treated as past
// (Huang's early AMD job, Musk's Zip2). Confirmed ones follow end_kind.
function settleCurrent(orgs: Org[]) {
  for (const org of orgs) {
    const confirmed = org.relations.some((r) => r.end_kind === "ongoing" || r.end_kind === "planned");
    for (const r of org.relations) {
      if (!r.end_kind) continue;
      r.current = r.end_kind === "ongoing" || r.end_kind === "planned" || (r.end_kind === "unknown" && confirmed);
    }
  }
  return orgs;
}

export async function loadInterests(personId: string, fallback: Interest[]): Promise<InterestsPayload> {
  try {
    const data = await getJson<Omit<InterestsPayload, "layered">>(`/v1/people/${personId}/interests`);
    if (Array.isArray(data.orgs)) return { ...data, orgs: settleCurrent(data.orgs), claim_links: data.claim_links ?? [], layered: true };
  } catch {
    // Endpoint not deployed yet: fall through to layer 1 only.
  }
  return fromRelations(fallback);
}

// The largest stake this person holds in an organisation, if any is known.
export function stakeOf(org: Org) {
  const stakes = org.relations.map((r) => r.stake_pct).filter((v): v is number => v != null);
  return stakes.length ? Math.max(...stakes) : null;
}

export function isCurrent(item: { ended: string | null; current?: boolean }) {
  if (typeof item.current === "boolean") return item.current;
  return !item.ended || item.ended === "present";
}

// "2004 – 至今", "1983 – 1985", "1993 – 结束时间未知".
export function spanText(item: { started: string | null; ended: string | null; end_kind?: string; current?: boolean }) {
  const end =
    item.end_kind === "unknown" && !item.current
      ? "结束时间未知"
      : isCurrent(item)
        ? item.end_kind === "unknown"
          ? "至今（未记录结束）"
          : "至今"
        : (item.ended ?? "");
  return item.started ? `${item.started} – ${end}` : end;
}

export function orgLabel(org: Org) {
  return org.name_zh || org.name;
}

function shortMetric(metric: Exposure["metric"]) {
  if (!metric) return "";
  if (metric.kind === "revenue_share") return `营收 ${metric.value}%`;
  if (metric.kind === "production_share") return `产量 ${metric.value}%`;
  if (metric.kind === "stake_pct") return `持股 ${metric.value}%`;
  if (metric.value >= 1e9) return `$${(metric.value / 1e9).toFixed(metric.value >= 1e10 ? 0 : 1)}B`;
  if (metric.value >= 1e6) return `$${(metric.value / 1e6).toFixed(0)}M`;
  return `$${Math.round(metric.value)}`;
}

// SPEC：主张上的「说这句话时的利益」，点开能看到原因。
export function claimExposureChips(flow: InterestsPayload, claimId: string) {
  const chips: { key: string; label: string; level: "direct" | "indirect"; reason: string }[] = [];
  for (const link of flow.claim_links) {
    if (link.claim_id !== claimId || link.target_kind !== "exposure") continue;
    for (const org of flow.orgs) {
      const exposure = org.exposures.find((item) => item.id === link.target_id);
      if (!exposure) continue;
      const name = exposure.target_zh || exposure.target;
      const metric = shortMetric(exposure.metric);
      chips.push({
        key: `${exposure.id}`,
        label: metric ? `${name} · ${metric}` : name,
        level: link.level,
        reason: link.reason,
      });
    }
  }
  return chips;
}
