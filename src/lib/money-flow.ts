import { isCurrent, orgLabel, stakeOf, type ClaimLink, type Exposure, type Org } from "@/lib/interests";

// SPEC 利益关系的展示（2026-10-22 改版）：钱从哪来 → 经过哪家公司 → 他 → 他说了什么。
// This module only shapes the data; the component lays it out and animates it.

export type SourceGroup = "market" | "contract" | "capital" | "depends";

export const GROUP_LABEL: Record<SourceGroup, string> = {
  market: "市场",
  contract: "客户与合同",
  capital: "投资往来",
  depends: "他依赖的",
};

const GROUP_OF: Record<Exposure["dimension"], SourceGroup> = {
  region: "market",
  customer: "contract",
  partner: "contract",
  investment: "capital",
  supplier: "depends",
  facility: "depends",
};

// Organisation-level revenue (SPEC 推算规则). Not served by the API yet; read when it is.
export type Financials = { revenue_usd: number; year: number | null; source_url: string };
type OrgIn = Org & { financials?: Financials | null };

export type FlowSource = {
  id: string;
  orgId: string;
  group: SourceGroup;
  label: string;
  metric: string; // shortest readable form of the best disclosed number, "" if none
  share: number | null; // fraction of the organisation's revenue, when disclosed
  estimate: Estimate | null;
  current: boolean;
  details: string[]; // one line per merged disclosure, for the tooltip
};

export type Estimate = { usd: number; formula: string };

export type FlowOrg = {
  id: string;
  label: string;
  sub: string;
  stake: number | null;
  estimate: Estimate | null;
  sources: FlowSource[];
  hidden: number; // sources folded away by the cap
};

export type InterOrg = { from: string; to: string; label: string; known: boolean };

export type ClaimGroup = {
  id: string;
  orgId: string | null; // null = 与利益无关
  label: string;
  count: number;
  fulfilled: number;
  failed: number;
};

// minor: current ties with nothing to draw (no exposures, stake, claims or estimate) — listed, not drawn.
export type MoneyFlow = { orgs: FlowOrg[]; minor: string[]; inter: InterOrg[]; claims: ClaimGroup[]; past: string[]; hasRevenue: boolean };

// The stake as published, falling back to the percentage in a verified holding's wording ("持股约20.3%").
function stakeFor(org: Org) {
  const known = stakeOf(org);
  if (known != null) return known;
  const holding = org.relations.find((r) => r.kind === "holding" && isCurrent(r))?.role.match(/(\d+(?:\.\d+)?)\s*%/);
  return holding ? Number(holding[1]) : null;
}

// An amount without its unit ("20.96" for $20.96B) is not usable; real disclosures are never this small.
const MIN_PLAUSIBLE_USD = 10_000;

export function usd(value: number) {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(value >= 1e10 ? 0 : 1)}B`;
  if (value >= 1e6) return `$${Math.round(value / 1e6)}M`;
  return `$${Math.round(value / 1e3)}K`;
}

function metricOf(exposure: Exposure) {
  const m = exposure.metric;
  if (!m) return null;
  if (m.kind === "amount_usd" && m.value < MIN_PLAUSIBLE_USD) return null;
  return m;
}

function metricShort(m: NonNullable<Exposure["metric"]>) {
  const y = m.year ? ` ${m.year}` : "";
  if (m.kind === "revenue_share") return `营收 ${m.value}%${y}`;
  if (m.kind === "production_share") return `产量 ${m.value}%${y}`;
  if (m.kind === "stake_pct") return `持股 ${m.value}%${y}`;
  return `${usd(m.value)}${y}`;
}

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[,.()（）]|\b(inc|corp|corporation|ltd|llc|plc)\b/g, "")
    .replace(/\s+/g, "");

const ZH_ALIASES: Record<string, string> = { 太空探索技术公司: "spacex", spaceexplorationtechnologies: "spacex" };

// Which of his own organisations an exposure target names, if any.
function ownOrg(orgs: Org[], exposure: Exposure, self: string) {
  const names = [exposure.target, exposure.target_zh].filter(Boolean).map(norm);
  for (const name of names) {
    if (ZH_ALIASES[name] && ZH_ALIASES[name] !== self && orgs.some((o) => o.org_key === ZH_ALIASES[name])) return ZH_ALIASES[name];
    const hit = orgs.find((o) => o.org_key !== self && [o.org_key, o.name, o.name_zh].filter(Boolean).map(norm).includes(name));
    if (hit) return hit.org_key;
  }
  return null;
}

// Ranking value for picking a merged source's headline number: shares first, then newest.
const rank = (m: NonNullable<Exposure["metric"]>) => (m.kind === "revenue_share" ? 2e4 : m.kind === "amount_usd" ? 1e4 : 0) + (m.year ?? 0);

// Which organisation each claim is about: the one its links (to a relation or an exposure) point at most.
// Claims with no link land under null (与利益无关), so the groups add up to the total.
export function assignClaims<T extends { id: string }>(orgs: Org[], claims: T[], links: ClaimLink[]) {
  const orgOfRelation = new Map<number, string>();
  const orgOfExposure = new Map<number, string>();
  for (const org of orgs) {
    for (const r of org.relations) orgOfRelation.set(r.id, org.org_key);
    for (const e of org.exposures) orgOfExposure.set(e.id, org.org_key);
  }
  const claimOrgs = new Map<string, Map<string, number>>();
  for (const link of links) {
    const key = link.target_kind === "relation" ? orgOfRelation.get(link.target_id) : orgOfExposure.get(link.target_id);
    if (!key) continue;
    const tally = claimOrgs.get(link.claim_id) ?? new Map<string, number>();
    tally.set(key, (tally.get(key) ?? 0) + 1);
    claimOrgs.set(link.claim_id, tally);
  }
  const byOrg = new Map<string | null, T[]>();
  for (const claim of claims) {
    const tally = claimOrgs.get(claim.id);
    const key = tally ? [...tally].sort((x, y) => y[1] - x[1])[0][0] : null;
    byOrg.set(key, [...(byOrg.get(key) ?? []), claim]);
  }
  return byOrg;
}

export type MergedSource = {
  key: string;
  group: SourceGroup;
  label: string;
  best: NonNullable<Exposure["metric"]> | null;
  current: boolean;
  exposures: Exposure[];
};
export type OwnTie = { from: string; to: string; label: string; known: boolean; exposures: Exposure[] };

// One row per (group, target) for an organisation; ties to his other organisations come out separately.
export function mergeExposures(org: Org, orgs: Org[]) {
  const merged = new Map<string, MergedSource>();
  const ties = new Map<string, OwnTie>();
  for (const exposure of org.exposures) {
    const other = ownOrg(orgs, exposure, org.org_key);
    const m = metricOf(exposure);
    if (other) {
      // Money between his own companies: a customer pays the organisation; it pays suppliers and investees.
      const [from, to] = exposure.dimension === "customer" ? [other, org.org_key] : [org.org_key, other];
      const kind = { customer: "采购", supplier: "采购", investment: "投资", partner: "合作", region: "往来", facility: "往来" }[exposure.dimension];
      const key = `${from}>${to}`;
      const tie = ties.get(key) ?? { from, to, label: kind, known: false, exposures: [] };
      tie.exposures.push(exposure);
      if (m && !tie.known) Object.assign(tie, { label: `${kind} ${metricShort(m)}`, known: true });
      ties.set(key, tie);
      continue;
    }
    const group = GROUP_OF[exposure.dimension];
    const label = exposure.target_zh || exposure.target;
    const key = `${group}:${norm(label)}`;
    const item = merged.get(key) ?? { key, group, label, best: null, current: false, exposures: [] };
    item.exposures.push(exposure);
    item.current ||= isCurrent(exposure);
    if (m && (!item.best || rank(m) > rank(item.best))) item.best = m;
    merged.set(key, item);
  }
  return { sources: [...merged.values()], ties: [...ties.values()] };
}

export { metricShort };

function estimateOrg(org: OrgIn): Estimate | null {
  const stake = stakeFor(org);
  const fin = org.financials;
  if (stake == null || !fin) return null;
  return {
    usd: (stake / 100) * fin.revenue_usd,
    formula: `持股 ${stake}% × ${orgLabel(org)}营收 ${usd(fin.revenue_usd)}${fin.year ? `（${fin.year}）` : ""}`,
  };
}

export function buildMoneyFlow(
  orgsIn: OrgIn[],
  claims: { id: string; status: string }[],
  links: ClaimLink[],
  { maxOrgs = 8, maxSources = 6 }: { maxOrgs?: number; maxSources?: number } = {},
): MoneyFlow {
  const current = orgsIn.filter((org) => org.relations.some(isCurrent));
  const past = orgsIn.filter((org) => !org.relations.some(isCurrent)).map(orgLabel);

  const claimsByOrg = assignClaims(orgsIn, claims, links);

  const ranked = current
    .map((org) => ({ org, estimate: estimateOrg(org), stake: stakeFor(org), said: claimsByOrg.get(org.org_key)?.length ?? 0 }))
    .sort(
      (a, b) =>
        (b.estimate?.usd ?? -1) - (a.estimate?.usd ?? -1) ||
        b.said - a.said ||
        b.org.exposures.length - a.org.exposures.length ||
        (b.stake ?? -1) - (a.stake ?? -1),
    )
    .slice(0, maxOrgs);
  const shown = new Set(ranked.map((r) => r.org.org_key));

  const inter = new Map<string, InterOrg>();
  const orgs: FlowOrg[] = ranked.map(({ org, estimate, stake }) => {
    const { sources: mergedSources, ties } = mergeExposures(org, orgsIn);
    for (const tie of ties) {
      if (!shown.has(tie.from) || !shown.has(tie.to)) continue;
      const key = `${tie.from}>${tie.to}`;
      const prev = inter.get(key);
      if (!prev || (!prev.known && tie.known)) inter.set(key, { from: `o:${tie.from}`, to: `o:${tie.to}`, label: tie.label, known: tie.known });
    }
    const merged = mergedSources.map((m) => ({
      id: `s:${org.org_key}:${m.key}`,
      orgId: `o:${org.org_key}`,
      group: m.group,
      label: m.label,
      metric: "",
      share: null as number | null,
      estimate: null as Estimate | null,
      current: m.current,
      details: m.exposures.map((e) => {
        const em = metricOf(e);
        return `${m.label}：${em ? metricShort(em) : "规模未公开"}${e.started ? ` · ${e.started} 起` : ""}`;
      }),
      best: m.best,
    }));

    const revenue = org.financials?.revenue_usd ?? null;
    const sources = merged.map(({ best, ...item }) => {
      if (best) item.metric = metricShort(best);
      if (best?.kind === "revenue_share") item.share = best.value / 100;
      else if (best?.kind === "amount_usd" && revenue && item.group !== "depends") item.share = Math.min(1, best.value / revenue);
      if (item.share != null && revenue && stake != null && item.group !== "depends") {
        item.estimate = {
          usd: (stake / 100) * revenue * item.share,
          formula: `持股 ${stake}% × 营收 ${usd(revenue)} × 占比 ${(item.share * 100).toFixed(1)}%`,
        };
      }
      return item;
    });
    // Money in first (by share), dependencies last.
    sources.sort((a, b) => Number(a.group === "depends") - Number(b.group === "depends") || (b.share ?? -1) - (a.share ?? -1) || b.details.length - a.details.length);

    const roles = [...new Set(org.relations.filter(isCurrent).map((r) => r.role.split(/[、,，]/)[0]))].slice(0, 2).join("、");
    return {
      id: `o:${org.org_key}`,
      label: orgLabel(org),
      sub: stake != null ? `持股 ${stake}%` : roles,
      stake,
      estimate,
      sources: sources.slice(0, maxSources),
      hidden: Math.max(0, sources.length - maxSources),
    };
  });

  const groupOf = (id: string, orgId: string | null, label: string, list: { status: string }[]): ClaimGroup => ({
    id,
    orgId: orgId ? `o:${orgId}` : null,
    label,
    count: list.length,
    fulfilled: list.filter((c) => c.status === "已兑现" || c.status === "部分兑现").length,
    failed: list.filter((c) => c.status === "未兑现").length,
  });
  const claimGroups = ranked
    .filter(({ org }) => claimsByOrg.get(org.org_key)?.length)
    .map(({ org }) => groupOf(`c:${org.org_key}`, org.org_key, `关于${orgLabel(org)}`, claimsByOrg.get(org.org_key)!));
  // Claims tied to an organisation that is past or off-chart still count as interested speech.
  const elsewhere = [...claimsByOrg].filter(([key]) => key != null && !shown.has(key)).flatMap(([, list]) => list);
  if (elsewhere.length) claimGroups.push(groupOf("c:elsewhere", null, "关于其他机构", elsewhere));
  const unrelated = claimsByOrg.get(null) ?? [];
  if (unrelated.length) claimGroups.push(groupOf("c:unrelated", null, "与利益无关", unrelated));

  const drawn = orgs.filter((org) => org.sources.length || org.stake != null || org.estimate || claimsByOrg.get(org.id.slice(2))?.length || [...inter.values()].some((t) => t.from === org.id || t.to === org.id));
  const minor = orgs.filter((org) => !drawn.includes(org)).map((org) => (org.sub ? `${org.label}（${org.sub}）` : org.label));
  return { orgs: drawn, minor, inter: [...inter.values()], claims: claimGroups, past, hasRevenue: orgsIn.some((o) => o.financials) };
}
