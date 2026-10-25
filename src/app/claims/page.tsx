import Link from "next/link";
import { Catalog } from "@/components/catalog";
import { ClaimFeed } from "@/components/claim-feed";
import { getJson, type ClaimPage } from "@/lib/api";

export const dynamic = "force-dynamic";

// ?status= filters; the API applies them (GET /v1/claims) and counts each under the other active filters.
const STATUS: { key: string; label: string }[] = [
  { key: "due-soon", label: "一年内到期" },
  { key: "overdue", label: "已过期待核对" },
  { key: "fulfilled", label: "已兑现" },
  { key: "partial", label: "部分兑现" },
  { key: "missed", label: "未兑现" },
  { key: "unclear", label: "证据不足" },
  { key: "disputed", label: "有争议" },
];

type Params = { status?: string; domain?: string; person?: string; sort?: string };

export const metadata = { title: "主张" };

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const status = STATUS.find((s) => s.key === params.status) ?? null;
  const sort = params.sort === "deadline" || status?.key === "due-soon" ? "deadline" : "said";
  const api = new URLSearchParams({ sort });
  if (status) api.set("status", status.key);
  if (params.domain) api.set("domain", params.domain);
  if (params.person) api.set("person", params.person);
  const path = `/v1/claims?${api}`;
  const data = await getJson<ClaimPage>(path);

  const href = (next: Partial<Params>) => {
    const merged = { ...params, ...next };
    const query = new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/claims${query.size ? `?${query}` : ""}`;
  };
  const domains = Object.entries(data.counts.domain).sort((a, b) => b[1] - a[1]);
  const people = Object.entries(data.counts.person).sort((a, b) => b[1] - a[1]);
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs no-underline ${active ? "bg-ink text-white" : "bg-card text-ink/80 hover-fine:text-blue"}`;

  return (
    <Catalog title="主张" icon="quote" lede="每一条都有原话、出处和到期后的核对。这是人物分数的数据集。">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Link href={href({ status: undefined })} className={chip(!status)}>
            全部 <span className="num opacity-70">{data.counts.all}</span>
          </Link>
          {STATUS.map((s) => {
            const n = data.counts.status[s.key] ?? 0;
            return n || status?.key === s.key ? (
              <Link key={s.key} href={href({ status: status?.key === s.key ? undefined : s.key })} className={chip(status?.key === s.key)}>
                {s.label} <span className="num opacity-70">{n}</span>
              </Link>
            ) : null;
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {domains.map(([d, n]) => (
            <Link key={d} href={href({ domain: params.domain === d ? undefined : d })} className={chip(params.domain === d)}>
              {d} <span className="num opacity-70">{n}</span>
            </Link>
          ))}
        </div>
        <details className="text-xs" open={Boolean(params.person)}>
          <summary className="cursor-pointer text-mute">按人物筛选{params.person ? `：${data.names[params.person] ?? params.person}` : ""}</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {people.map(([id, n]) => (
              <Link key={id} href={href({ person: params.person === id ? undefined : id })} className={chip(params.person === id)}>
                {data.names[id] ?? id} <span className="num opacity-70">{n}</span>
              </Link>
            ))}
          </div>
        </details>
        <p className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-xs text-mute">
          <span>{data.total} 条</span>
          <span className="flex gap-3">
            <Link href={href({ sort: undefined })} className={sort === "said" ? "text-ink" : "text-mute no-underline"}>
              按说话时间
            </Link>
            <Link href={href({ sort: "deadline" })} className={sort === "deadline" ? "text-ink" : "text-mute no-underline"}>
              按到期时间
            </Link>
          </span>
        </p>
      </div>
      <ClaimFeed key={path} variant="site" path={path} initial={data.claims} nextCursor={data.next_cursor} total={data.total} today={data.today} />
    </Catalog>
  );
}
