import Link from "next/link";
import { Catalog } from "@/components/catalog";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/status-pill";
import { curationLabel, getJson, type Claim, type HomePayload } from "@/lib/api";

export const dynamic = "force-dynamic";

const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);

// ?status= filters, each with the test it applies.
const STATUS: { key: string; label: string; test: (c: Claim, today: string) => boolean }[] = [
  { key: "due-soon", label: "一年内到期", test: (c, today) => c.status === "待定" && c.deadline >= today && c.deadline <= addYear(today) },
  { key: "overdue", label: "已过期待核对", test: (c, today) => c.status === "待定" && c.deadline < today },
  { key: "fulfilled", label: "已兑现", test: (c) => c.status === "已兑现" },
  { key: "partial", label: "部分兑现", test: (c) => c.status === "部分兑现" },
  { key: "missed", label: "未兑现", test: (c) => c.status === "未兑现" },
  { key: "unclear", label: "证据不足", test: (c) => c.status === "证据不足" },
  { key: "disputed", label: "有争议", test: (c) => Boolean(c.disputed) },
];

function addYear(day: string) {
  return `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
}

type Params = { status?: string; domain?: string; person?: string; sort?: string };

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const data = await getJson<HomePayload>("/v1/home");
  const today = data.today;
  const status = STATUS.find((s) => s.key === params.status) ?? null;
  const sort = params.sort === "deadline" || status?.key === "due-soon" ? "deadline" : "said";

  const href = (next: Partial<Params>) => {
    const merged = { ...params, ...next };
    const query = new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/claims${query.size ? `?${query}` : ""}`;
  };
  const inScope = (c: Claim, skip: keyof Params) =>
    (skip === "status" || !status || status.test(c, today)) &&
    (skip === "domain" || !params.domain || c.category === params.domain) &&
    (skip === "person" || !params.person || c.person_id === params.person);

  const claims = data.claims
    .filter((c) => inScope(c, "sort"))
    .sort((a, b) => (sort === "deadline" ? a.deadline.localeCompare(b.deadline) : b.published_date.localeCompare(a.published_date)));

  // Facet counts respect the other active filters, so each number is what clicking it would show.
  const domains = [...new Set(data.claims.map((c) => c.category))]
    .map((d) => ({ d, n: data.claims.filter((c) => c.category === d && inScope(c, "domain")).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const people = data.people
    .map((p) => ({ p, n: data.claims.filter((c) => c.person_id === p.id && inScope(c, "person")).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs no-underline ${active ? "bg-ink text-white" : "bg-card text-ink/80 hover-fine:text-blue"}`;

  return (
    <Catalog title="主张" icon="quote" lede="每一条都有原话、出处和到期后的核对。这是人物分数的数据集。">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Link href={href({ status: undefined })} className={chip(!status)}>
            全部 <span className="num opacity-70">{data.claims.filter((c) => inScope(c, "status")).length}</span>
          </Link>
          {STATUS.map((s) => {
            const n = data.claims.filter((c) => s.test(c, today) && inScope(c, "status")).length;
            return n || status?.key === s.key ? (
              <Link key={s.key} href={href({ status: status?.key === s.key ? undefined : s.key })} className={chip(status?.key === s.key)}>
                {s.label} <span className="num opacity-70">{n}</span>
              </Link>
            ) : null;
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {domains.map(({ d, n }) => (
            <Link key={d} href={href({ domain: params.domain === d ? undefined : d })} className={chip(params.domain === d)}>
              {d} <span className="num opacity-70">{n}</span>
            </Link>
          ))}
        </div>
        <details className="text-xs" open={Boolean(params.person)}>
          <summary className="cursor-pointer text-mute">按人物筛选{params.person ? `：${data.people.find((p) => p.id === params.person)?.name ?? params.person}` : ""}</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {people.map(({ p, n }) => (
              <Link key={p.id} href={href({ person: params.person === p.id ? undefined : p.id })} className={chip(params.person === p.id)}>
                {p.name} <span className="num opacity-70">{n}</span>
              </Link>
            ))}
          </div>
        </details>
        <p className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-xs text-mute">
          <span>{claims.length} 条</span>
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
      {claims.map((claim) => (
        <Link
          key={claim.id}
          href={`/p/${claim.person_id}/${claim.id}`}
          className="grid gap-2 border-b border-line py-4 no-underline sm:grid-cols-[140px_1fr]"
        >
          <span className="flex flex-wrap items-center gap-2 text-xs text-mute">
            <StatusPill status={claim.status === "待定" && claim.deadline < today ? "待核对" : claim.status} />
            <span>{claim.person_name}</span>
            {claim.disputed ? <span className="rounded-md border border-dashed border-ink/40 px-1.5 text-[11px] text-ink">有争议</span> : null}
            {curationLabel(claim.curation) ? <span className="rounded-md border border-dashed border-ink/40 px-1.5 text-[11px] text-ink">{curationLabel(claim.curation)}</span> : null}
          </span>
          <span>
            <span className="block leading-7">{claim.quote_zh}</span>
            <span className="inline-flex flex-wrap items-center gap-1 text-xs text-mute">
              <Icon name="tag" size={12} />
              {claim.category}
              <Icon name="calendar" size={12} />
              {claim.published_date}
              <Icon name="arrow-right" size={12} />
              {claim.deadline}
              {JUDGED.has(claim.status) && claim.actual_result ? <span className="ml-2 line-clamp-1">结果：{claim.actual_result}</span> : null}
            </span>
          </span>
        </Link>
      ))}
      {claims.length === 0 ? <p className="py-10 text-center text-sm text-mute">没有符合条件的主张。</p> : null}
    </Catalog>
  );
}
