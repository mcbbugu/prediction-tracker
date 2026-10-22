import { KIND_LABEL, isCurrent, orgLabel, type ClaimLink, type Exposure, type Org, type Relation } from "@/lib/interests";
import { GROUP_LABEL, mergeExposures, metricShort, type MergedSource, type SourceGroup } from "@/lib/money-flow";

// 全部关系：和上面的流向图用同一套合并和分类。
// 有对外关系的机构给整张卡；只有任职或持股的给小卡；已结束的列成一张表。

const GROUPS: SourceGroup[] = ["market", "contract", "capital", "depends"];
const VISIBLE = 6;

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "出处";
  }
}

function span(item: { started: string | null; ended: string | null }) {
  const end = isCurrent(item) ? "至今" : (item.ended ?? "");
  return item.started ? `${item.started} – ${end}` : end;
}

// SEC filing vs the frozen web crawl. Same mark on grouped rows and inter-company ties.
function BasisMark({ verified }: { verified: boolean }) {
  return (
    <span
      title={verified ? "取自 SEC 10-K 的 XBRL 数据，带单位和分类" : "2026-10 网页抓取的结果，未经核验，可能有单位或分类错误"}
      className={`shrink-0 rounded px-1 text-[10px] leading-4 ${verified ? "bg-blue-tint text-blue-deep" : "bg-sunken text-mute"}`}
    >
      {verified ? "SEC 年报" : "未验证"}
    </span>
  );
}

// Numbered links to every archived source behind a row; the quote shows on hover.
function Sources({ items }: { items: { source_url: string; quote: string; reviewed: boolean }[] }) {
  const seen = new Map<string, (typeof items)[number]>();
  for (const item of items) if (!seen.has(item.source_url)) seen.set(item.source_url, item);
  return (
    <span className="ml-1.5 inline-flex gap-1 align-baseline">
      {[...seen.values()].map((item, index) => (
        <a
          key={item.source_url}
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
          title={`${host(item.source_url)}${item.reviewed ? " · 人工复核" : ""}\n「${item.quote}」`}
          className={`num rounded px-1 text-[10px] leading-4 no-underline ${item.reviewed ? "bg-blue-tint text-blue-deep" : "bg-sunken text-mute"} hover-fine:text-blue`}
        >
          {index + 1}
        </a>
      ))}
    </span>
  );
}

function RelationLine({ r }: { r: Relation }) {
  return (
    <li className="text-xs leading-5">
      <span className="mr-1.5 text-[11px] text-mute">{KIND_LABEL[r.kind]}</span>
      <span className="font-medium">{r.role}</span>
      {span(r) ? <span className="num ml-1.5 text-mute">{span(r)}</span> : null}
      <Sources items={[r]} />
    </li>
  );
}

const sortValue = (s: MergedSource) =>
  !s.best ? -1 : s.best.kind === "revenue_share" || s.best.kind === "production_share" ? s.best.value * 1e12 : s.best.value;

export function InterestLedger({
  personId,
  orgs,
  claimLinks,
  claims,
}: {
  personId: string;
  orgs: Org[];
  claimLinks: ClaimLink[];
  claims: Map<string, { id: string; quote_zh: string }>;
}) {
  const current = orgs.filter((org) => org.relations.some(isCurrent));
  const past = orgs.filter((org) => !org.relations.some(isCurrent));
  // Same order as the timeline: the organisation he talks about most comes first.
  const said = (org: Org) => {
    const ids = new Set([...org.relations.map((r) => `r${r.id}`), ...org.exposures.map((e) => `e${e.id}`)]);
    return new Set(claimLinks.filter((l) => ids.has(`${l.target_kind === "relation" ? "r" : "e"}${l.target_id}`)).map((l) => l.claim_id)).size;
  };
  const full = current.filter((org) => org.exposures.length).sort((a, b) => said(b) - said(a) || b.exposures.length - a.exposures.length);
  const small = current.filter((org) => !org.exposures.length);
  const labelOf = new Map(orgs.map((org) => [org.org_key, orgLabel(org)]));
  const quotesFor = (exposures: Exposure[]) => {
    const ids = new Set(exposures.map((e) => e.id));
    return [...new Set(claimLinks.filter((l) => l.target_kind === "exposure" && ids.has(l.target_id)).map((l) => l.claim_id))]
      .map((id) => claims.get(id))
      .filter((c): c is { id: string; quote_zh: string } => Boolean(c));
  };

  return (
    <div className="space-y-3">
      <p className="px-1 text-[11px] text-mute">
        每条关系后面的数字是出处，悬停看原句，点开看存档页；蓝底的经过人工复核，其余是机器逐字核对。同一目标的多条披露合并成一行，显示最新、最具体的那个数。美股公司的地区营收取自 SEC 年报（10-K 的 XBRL 数据）；标「未验证」的是早先网页抓取的结果，可能有单位或分类错误。
      </p>

      {full.map((org) => {
        const { sources, ties } = mergeExposures(org, orgs);
        const stake = org.relations.find((r) => r.kind === "holding" && isCurrent(r))?.role.match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
        const count = said(org);
        return (
          <article key={org.org_key} id={`org-${org.org_key}`} className="scroll-mt-24 rounded-[14px] bg-card p-4 sm:p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-[17px] font-bold">
                {orgLabel(org)}
                {org.name_zh && org.name_zh !== org.name ? <span className="ml-1.5 text-xs font-normal text-mute">{org.name}</span> : null}
              </h3>
              <span className="flex gap-3 text-xs">
                {count ? <span className="text-ink">{count} 句相关的话</span> : null}
                {stake ? <span className="num font-semibold text-blue">持股 {stake}%</span> : null}
              </span>
            </header>
            <ul className="mt-1.5 space-y-0.5">
              {org.relations.map((r) => (
                <RelationLine key={r.id} r={r} />
              ))}
            </ul>
            {org.financials ? (
              <p className="mt-2 text-xs">
                <span className="mr-1.5 text-[11px] text-mute">年营收</span>
                <span className="num font-medium">
                  {org.financials.year ? `FY${org.financials.year} ` : ""}${(org.financials.revenue_usd / 1e9).toFixed(1)}B
                </span>
                <a href={org.financials.source_url} target="_blank" rel="noreferrer" className="ml-1.5 text-[11px] text-blue">
                  SEC 10-K 数据
                </a>
              </p>
            ) : null}

            {ties.length ? (
              <p className="mt-3 text-xs leading-5">
                <span className="mr-1.5 text-[11px] text-mute">和他的其他公司</span>
                {ties.map((tie, index) => (
                  <span key={`${tie.from}>${tie.to}`}>
                    {index ? "；" : ""}
                    {labelOf.get(tie.from)} → {labelOf.get(tie.to)}
                    <span className={`num ml-1 ${tie.known ? "text-blue" : "text-mute"}`}>{tie.label}</span>
                    <span className="ml-1 inline-flex align-baseline">
                      <BasisMark verified={tie.exposures.length > 0 && tie.exposures.every((e) => e.basis === "sec_xbrl")} />
                    </span>
                    <Sources items={tie.exposures} />
                  </span>
                ))}
              </p>
            ) : null}

            <div className="mt-4 grid gap-x-8 gap-y-4 border-t border-line pt-4 md:grid-cols-2">
              {GROUPS.map((group) => {
                const items = sources.filter((s) => s.group === group).sort((a, b) => sortValue(b) - sortValue(a) || b.exposures.length - a.exposures.length);
                if (!items.length) return null;
                const row = (s: MergedSource) => {
                  const quotes = quotesFor(s.exposures);
                  return (
                    <li key={s.key} className="flex items-baseline gap-2 text-xs leading-5">
                      <span className={`min-w-0 truncate font-medium ${s.current ? "" : "text-mute"}`} title={s.label}>
                        {s.label}
                      </span>
                      <span className={`num shrink-0 ${s.best ? (s.verified ? "text-blue" : "text-mute italic") : "text-mute"}`}>
                        {s.best ? metricShort(s.best) : "规模未公开"}
                      </span>
                      <BasisMark verified={s.verified} />
                      <span className="shrink-0">
                        <Sources items={s.exposures} />
                      </span>
                      {quotes.length ? (
                        <a
                          href={`/p/${personId}/${quotes[0].id}`}
                          title={quotes.map((q) => `「${q.quote_zh}」`).join("\n")}
                          className="shrink-0 text-[11px] text-ink no-underline hover-fine:text-blue"
                        >
                          · {quotes.length} 句相关
                        </a>
                      ) : null}
                    </li>
                  );
                };
                return (
                  <section key={group}>
                    <h4 className="mb-1 flex items-baseline justify-between text-[11px] font-semibold text-mute">
                      {GROUP_LABEL[group]}
                      <span className="num font-normal">{items.length}</span>
                    </h4>
                    <ul className="space-y-0.5">{items.slice(0, VISIBLE).map(row)}</ul>
                    {items.length > VISIBLE ? (
                      <details className="group mt-0.5">
                        <summary className="cursor-pointer list-none text-[11px] text-blue group-open:hidden">展开其余 {items.length - VISIBLE} 项</summary>
                        <ul className="space-y-0.5">{items.slice(VISIBLE).map(row)}</ul>
                      </details>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </article>
        );
      })}

      {small.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {small.map((org) => (
            <article key={org.org_key} id={`org-${org.org_key}`} className="scroll-mt-24 rounded-[14px] bg-card p-4">
              <h3 className="font-bold">
                {orgLabel(org)}
                {org.name_zh && org.name_zh !== org.name ? <span className="ml-1.5 text-xs font-normal text-mute">{org.name}</span> : null}
              </h3>
              <ul className="mt-1 space-y-0.5">
                {org.relations.map((r) => (
                  <RelationLine key={r.id} r={r} />
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-mute">对外的营收、合同、投资还没有采到</p>
            </article>
          ))}
        </div>
      ) : null}

      {past.length ? (
        <section className="rounded-[14px] bg-card p-4">
          <h3 className="text-xs font-semibold text-mute">已结束的关系</h3>
          <ul className="mt-2 divide-y divide-line">
            {past.map((org) => (
              <li key={org.org_key} id={`org-${org.org_key}`} className="grid scroll-mt-24 gap-x-4 py-1.5 sm:grid-cols-[140px_1fr]">
                <span className="truncate text-xs font-medium">{orgLabel(org)}</span>
                <ul>
                  {org.relations.map((r) => (
                    <RelationLine key={r.id} r={r} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
