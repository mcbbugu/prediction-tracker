import Link from "next/link";
import { Icon } from "@/components/icon";
import { InterestFlow } from "@/components/interest-flow";
import { Portrait } from "@/components/portrait";
import { getJson, type Claim, type Interest, type Person, type PersonInterests } from "@/lib/api";
import { DIMENSION_LABEL, KIND_LABEL, isCurrent, loadInterests, orgLabel, stakeOf, type Exposure, type Org } from "@/lib/interests";

export const dynamic = "force-dynamic";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const year = (value: string | null) => (value && /^\d{4}/.test(value) ? Number(value.slice(0, 4)) : null);

function span(item: { started: string | null; ended: string | null }) {
  const end = isCurrent(item) ? "至今" : (item.ended ?? "");
  return item.started ? `${item.started} – ${end}` : end;
}

function metricText(metric: Exposure["metric"]) {
  if (!metric) return "规模未公开";
  const y = metric.year ? `（${metric.year}）` : "";
  if (metric.kind === "revenue_share") return `营收占比 ${metric.value}%${y}`;
  if (metric.kind === "production_share") return `产量占比 ${metric.value}%${y}`;
  if (metric.kind === "stake_pct") return `持股 ${metric.value}%${y}`;
  return `$${(metric.value / 1e9).toFixed(1)}B${y}`;
}

function Source({ url, quote, reviewed }: { url: string; quote: string; reviewed: boolean }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" title={quote} className="text-mute no-underline hover-fine:text-blue">
      {host(url)}
      {reviewed ? " · 人工复核" : " · 机器核对"}
    </a>
  );
}

export default async function InterestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJson<{ person: Person; claims: Claim[]; interests?: PersonInterests }>(`/v1/people/${id}`);
  const fallback = data.interests ?? { status: "not_collected" as const, relations: [] as Interest[] };
  const flow = await loadInterests(id, fallback.relations);
  const claims = new Map(data.claims.map((claim) => [claim.id, claim]));
  const orgs = [...flow.orgs].sort(
    (a, b) =>
      Number(b.relations.some(isCurrent)) - Number(a.relations.some(isCurrent)) || (stakeOf(b) ?? -1) - (stakeOf(a) ?? -1),
  );
  const exposureCount = orgs.reduce((sum, org) => sum + org.exposures.length, 0);
  const relationCount = orgs.reduce((sum, org) => sum + org.relations.length, 0);
  const linkedClaims = new Set(flow.claim_links.map((link) => link.claim_id));

  // Timeline range: from the earliest dated relation to this year.
  const thisYear = new Date().getFullYear();
  const starts = orgs.flatMap((org) => org.relations.map((r) => year(r.started))).filter((v): v is number => v != null);
  const from = starts.length ? Math.min(...starts) : thisYear - 10;
  const total = Math.max(1, thisYear - from + 1);
  const linksFor = (kind: "relation" | "exposure", targetId: number) =>
    flow.claim_links.filter((link) => link.target_kind === kind && link.target_id === targetId);

  return (
    <div className="pt-6">
      <p className="flex items-center gap-1 text-xs text-mute">
        <Link href={`/p/${id}`} className="no-underline hover-fine:text-ink">
          {data.person.name}
        </Link>
        <Icon name="chevron-right" size={11} />
        <span>利益关系</span>
      </p>
      <section className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[18px] bg-card p-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Portrait person={data.person} riso className="w-[64px] shrink-0 !rounded-[12px]" />
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-[900] tracking-tight">{data.person.name}的利益版图</h1>
            <p className="text-sm text-mute">公开可核查的任职、持股、交易，以及这些机构对外的地域、工厂、供应链和合作敞口</p>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-x-6">
          {[
            ["机构", orgs.length],
            ["关系", relationCount],
            ["对外敞口", flow.layered ? exposureCount : "采集中"],
            ["关联主张", flow.layered ? linkedClaims.size : "采集中"],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dd className="display-num text-[24px] leading-none font-[800]">{value}</dd>
              <dt className="mt-1 text-[11px] whitespace-nowrap text-mute">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6 rounded-[18px] bg-card p-5">
        <InterestFlow personName={data.person.name} orgs={orgs} claims={data.claims.map(({ id, status }) => ({ id, status }))} claimLinks={flow.claim_links} maxOrgs={12} maxSources={8} />
      </section>

      {/* Timeline of every relation, so "when he said it" can be read against "what he held then" */}
      {starts.length > 0 ? (
        <section className="mt-8">
          <h2 className="flex items-baseline justify-between text-[15px] font-bold">
            时间线
            <span className="num text-xs font-normal text-mute">
              {from} – {thisYear}
            </span>
          </h2>
          <ul className="mt-3 space-y-1.5 rounded-[14px] bg-card p-4">
            {orgs.map((org) => {
              const dated = org.relations.filter((r) => year(r.started) != null);
              if (dated.length === 0) return null;
              return (
                <li key={org.org_key} className="grid items-center gap-3 sm:grid-cols-[140px_1fr]">
                  <span className="truncate text-xs font-medium">{orgLabel(org)}</span>
                  <span className="relative h-5 rounded bg-sunken">
                    {dated.map((r) => {
                      const s = year(r.started)!;
                      const e = isCurrent(r) ? thisYear : (year(r.ended) ?? s);
                      return (
                        <span
                          key={r.id}
                          title={`${KIND_LABEL[r.kind]} · ${r.role} · ${span(r)}`}
                          className="absolute top-1 h-3 rounded-sm bg-blue/70"
                          style={{ left: `${((s - from) / total) * 100}%`, width: `${Math.max(1.5, ((e - s + 1) / total) * 100)}%` }}
                        />
                      );
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Every organisation, every tie, every source */}
      <section className="mt-8">
        <h2 className="text-[15px] font-bold">全部关系</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {orgs.map((org: Org) => {
            const byDim = org.exposures.reduce((map, item) => map.set(item.dimension, [...(map.get(item.dimension) ?? []), item]), new Map<Exposure["dimension"], Exposure[]>());
            return (
              <article key={org.org_key} className="rounded-[14px] bg-card p-4">
                <header className="flex items-baseline justify-between gap-3">
                  <h3 className="font-bold">
                    {orgLabel(org)}
                    {org.name_zh && org.name_zh !== org.name ? <span className="ml-1.5 text-xs font-normal text-mute">{org.name}</span> : null}
                  </h3>
                  {stakeOf(org) != null ? <span className="num text-xs font-semibold text-blue">持股约 {stakeOf(org)}%</span> : null}
                </header>
                <ul className="mt-2 space-y-1.5 text-xs leading-5">
                  {org.relations.map((r) => (
                    <li key={r.id}>
                      <span className="mr-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px]">{KIND_LABEL[r.kind]}</span>
                      <span className="font-medium">{r.role}</span>
                      {span(r) ? <span className="num ml-1.5 text-mute">{span(r)}</span> : null}
                      <span className="ml-1.5">
                        <Source url={r.source_url} quote={r.quote} reviewed={r.reviewed} />
                      </span>
                      {linksFor("relation", r.id).length > 0 ? (
                        <span className="ml-1.5 text-blue">· 关联 {linksFor("relation", r.id).length} 条主张</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {byDim.size > 0 ? (
                  <div className="mt-3 border-t border-line pt-3">
                    {[...byDim].map(([dim, items]) => (
                      <div key={dim} className="mt-1.5 first:mt-0">
                        <p className="text-[11px] font-semibold text-mute">{DIMENSION_LABEL[dim]}</p>
                        <ul className="mt-0.5 space-y-1 text-xs leading-5">
                          {items.map((item) => (
                            <li key={item.id}>
                              <span className="font-medium">{item.target_zh || item.target}</span>
                              <span className="num ml-1.5">{metricText(item.metric)}</span>
                              {span(item) ? <span className="num ml-1.5 text-mute">{span(item)}</span> : null}
                              <span className="ml-1.5">
                                <Source url={item.source_url} quote={item.quote} reviewed={item.reviewed} />
                              </span>
                              {linksFor("exposure", item.id).map((link) => {
                                const claim = claims.get(link.claim_id);
                                return claim ? (
                                  <Link key={link.claim_id} href={`/p/${id}/${claim.id}`} className="mt-0.5 block truncate text-mute no-underline hover-fine:text-blue">
                                    ↳ {link.level === "direct" ? "直接相关" : "间接相关"}：「{claim.quote_zh.slice(0, 40)}」
                                  </Link>
                                ) : null;
                              })}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        {!flow.layered ? (
          <p className="mt-3 px-1 text-[11px] text-mute">
            机构对外的地域营收、生产场地、供应商、合作方和投资（SPEC「利益关系的三层数据」第二层）正在采集；采到后会出现在每个机构下面和上方的流向图右侧。
          </p>
        ) : null}
      </section>
    </div>
  );
}
