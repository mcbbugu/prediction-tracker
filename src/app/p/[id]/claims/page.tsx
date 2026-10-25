import Link from "next/link";
import { ActivityGrid } from "@/components/activity-grid";
import { ClaimFeed } from "@/components/claim-feed";
import { Icon } from "@/components/icon";
import { PersonSubhead } from "@/components/person-subhead";
import { getJson, type ClaimPage, type ClaimSummary, type Interest, type Person, type PersonInterests } from "@/lib/api";
import { chipsByClaim, loadInterests } from "@/lib/interests";

export const dynamic = "force-dynamic";

// ?show= keys: the same filters as the person page used to have. The API calls them status.
const SHOW: Record<string, string> = {
  judged: "已判定",
  overdue: "已过期待核对",
  upcoming: "未到期",
  unclear: "证据不足（作废）",
  fulfilled: "已兑现",
  partial: "部分兑现",
  missed: "未兑现",
  rescheduled: "改期串",
  machine: "AI 判定",
  manual: "人工复核",
};
const SHOW_CHIPS = ["judged", "fulfilled", "partial", "missed", "overdue", "upcoming", "unclear", "rescheduled"];

type Params = { domain?: string; show?: string; year?: string; month?: string };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJson<{ person: Person }>(`/v1/people/${id}`).catch(() => null);
  return { title: `全部主张 · ${data?.person.name ?? "人物"}` };
}

export default async function PersonClaimsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  const raw = await searchParams;
  const filters: Params = {
    domain: raw.domain || undefined,
    show: raw.show && SHOW[raw.show] ? raw.show : undefined,
    year: raw.year && /^\d{4}$/.test(raw.year) ? raw.year : undefined,
    month: raw.month && /^\d{4}-\d{2}$/.test(raw.month) ? raw.month : undefined,
  };
  const api = new URLSearchParams();
  if (filters.domain) api.set("domain", filters.domain);
  if (filters.show) api.set("status", filters.show);
  if (filters.year) api.set("year", filters.year);
  if (filters.month) api.set("month", filters.month);
  const path = `/v1/people/${id}/claims${api.size ? `?${api}` : ""}`;
  const [data, list] = await Promise.all([
    getJson<{ person: Person; claim_summary: ClaimSummary; interests?: PersonInterests }>(`/v1/people/${id}`),
    getJson<ClaimPage>(path),
  ]);
  const relations = data.interests?.relations ?? ([] as Interest[]);
  const flow = await loadInterests(id, relations);
  const chips = chipsByClaim(flow, data.claim_summary.statuses);

  // Filters live in the URL, so a filtered list can be linked to.
  const href = (next: Partial<Params>) => {
    const merged = { ...filters, ...next };
    const query = new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/p/${id}/claims${query.size ? `?${query}` : ""}`;
  };
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs no-underline ${active ? "bg-ink text-white" : "bg-sunken text-ink/80 hover-fine:text-blue"}`;
  const domains = Object.entries(list.counts.domain).sort((a, b) => b[1] - a[1]);
  const active = [
    filters.month ? { label: `${filters.month.slice(0, 4)} 年 ${Number(filters.month.slice(5))} 月说的`, clear: { month: undefined } } : null,
    filters.year ? { label: `${filters.year} 年说的`, clear: { year: undefined } } : null,
  ].filter((item) => item !== null);

  return (
    <div className="pt-6">
      <PersonSubhead person={data.person} crumb="全部主张" title={`${data.person.name}的全部主张`} lede={`共 ${data.claim_summary.total} 条，先列已到期的（最近的在上），再列未到期的`}>
        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
          <div className="shrink-0" title="按说话月份：颜色越深，那个月收录的带期限说法越多；只统计已收录的话">
            <p className="mb-2 text-[11px] tracking-wide text-mute">按月份</p>
            <ActivityGrid months={list.counts.month} href={(month) => href({ month, year: undefined })} active={filters.month} />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Link href={href({ show: undefined })} className={chip(!filters.show)}>
                全部 <span className="num opacity-70">{list.counts.all}</span>
              </Link>
              {SHOW_CHIPS.map((key) => {
                const n = list.counts.status[key] ?? 0;
                return n || filters.show === key ? (
                  <Link key={key} href={href({ show: filters.show === key ? undefined : key })} className={chip(filters.show === key)}>
                    {SHOW[key]} <span className="num opacity-70">{n}</span>
                  </Link>
                ) : null;
              })}
              {filters.show && !SHOW_CHIPS.includes(filters.show) ? (
                <Link href={href({ show: undefined })} className={chip(true)}>
                  {SHOW[filters.show]} <span className="num opacity-70">{list.total}</span>
                </Link>
              ) : null}
            </div>
            {domains.length > 1 || filters.domain ? (
              <div className="flex flex-wrap gap-1.5">
                {domains.map(([domain, n]) => (
                  <Link key={domain} href={href({ domain: filters.domain === domain ? undefined : domain })} className={chip(filters.domain === domain)}>
                    {domain} <span className="num opacity-70">{n}</span>
                  </Link>
                ))}
              </div>
            ) : null}
            {active.length ? (
              <div className="flex flex-wrap gap-1.5">
                {active.map((item) => (
                  <Link key={item.label} href={href(item.clear)} className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep no-underline">
                    {item.label}
                    <Icon name="cancel" size={11} />
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </PersonSubhead>
      <section className="mt-6">
        <p className="mb-2 px-1 text-xs text-mute">
          <span className="num">{list.total}</span> 条
        </p>
        <ClaimFeed key={path} path={path} initial={list.claims} nextCursor={list.next_cursor} total={list.total} today={list.today} chips={chips} />
      </section>
    </div>
  );
}
