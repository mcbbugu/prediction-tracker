import Link from "next/link";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/status-pill";
import { claimExposureChips, loadInterests } from "@/lib/interests";
import { getJson, type Claim } from "@/lib/api";
import { sourceLabel } from "@/lib/utils";
import { ChallengeForm } from "@/components/challenge-form";

export const dynamic = "force-dynamic";

type Archive = { url: string; fetched_at: string; sha256: string; wayback_url: string | null; fetched_via: string };

// Our archived copy (date + hash) and the Wayback capture, next to every external link.
type PropositionRow = {
  subject: string;
  metric: string;
  comparator: string | null;
  threshold: number | null;
  unit: string;
  deadline: string | null;
  resolver: string;
  spec_version: string;
};

const RESOLVER_LABEL: Record<string, string> = {
  sec_xbrl: "确定性 · SEC 申报",
  price: "确定性 · 股价",
  model: "模型读存档",
};

function Proposition({ claim }: { claim: Claim & { proposition?: PropositionRow | null; resolved_by?: string | null } }) {
  const proposition = claim.proposition;
  if (!proposition && !claim.resolved_by) return null;
  const comparator = proposition?.comparator === ">=" ? "不低于" : proposition?.comparator === "<=" ? "不高于" : proposition?.comparator === "=" ? "等于" : proposition?.comparator === "exists_by" ? "在截止日前存在" : "";
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">判定标准</h2>
      {proposition ? (
        <p className="mt-1 text-sm text-mute">
          {proposition.subject || "未写主体"}
          {proposition.metric ? ` · ${proposition.metric}` : ""}
          {comparator ? ` · ${comparator}` : ""}
          {proposition.threshold != null ? ` ${proposition.threshold}` : ""}
          {proposition.unit ? ` ${proposition.unit}` : ""}
          {proposition.deadline ? ` · 截止 ${proposition.deadline}` : ""}
          。方式：{RESOLVER_LABEL[proposition.resolver] ?? proposition.resolver}
          <span className="text-mute"> · {proposition.spec_version}</span>
        </p>
      ) : null}
      {claim.resolved_by ? <p className="mt-1 text-sm text-mute">这次结论由{RESOLVER_LABEL[claim.resolved_by] ?? claim.resolved_by}写出。</p> : null}
    </section>
  );
}

function ArchiveNote({ archive }: { archive?: Archive }) {
  if (!archive) return null;
  return (
    <span className="text-[11px] text-mute" title={`抓取途径 ${archive.fetched_via} · 正文 sha256 ${archive.sha256}`}>
      {archive.fetched_at} 已存档
      {archive.wayback_url ? (
        <>
          {" · "}
          <a href={archive.wayback_url} target="_blank" rel="noreferrer" className="text-mute hover-fine:text-blue">
            Wayback 快照
          </a>
        </>
      ) : null}
    </span>
  );
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string; claimId: string }>;
}) {
  const { id, claimId } = await params;
  const data = await getJson<{ claim: Claim & { proposition?: PropositionRow | null; resolved_by?: string | null }; related: Claim[]; thread?: Claim[]; archives?: Record<string, Archive> }>(
    `/v1/people/${id}/claims/${claimId}`,
  );
  const archives = data.archives ?? {};
  const claim = data.claim;
  const flow = await loadInterests(id, []);
  const chips = claimExposureChips(flow, claim.id);

  return (
    <article className="mx-auto max-w-[720px] pt-6">
      <p className="inline-flex items-center gap-1 text-sm text-mute">
        <Link href={`/p/${id}`} className="inline-flex items-center gap-1 no-underline hover-fine:text-ink">
          <Icon name="person" size={14} />
          {claim.person_name}
        </Link>
        <Icon name="chevron-right" size={12} />
        <Link
          href={`/p/${id}?domain=${encodeURIComponent(claim.category)}#claims`}
          className="inline-flex items-center gap-1 no-underline hover-fine:text-ink"
        >
          <Icon name="tag" size={14} />
          {claim.category}
        </Link>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusPill status={claim.status} />
        {claim.disputed ? (
          <span title="有人提交了反证，正在复核；复核期间结论保留显示" className="rounded-md border border-dashed border-ink/40 px-1.5 py-0.5 text-[11px] font-medium text-ink">
            有争议 · 复核中
          </span>
        ) : null}
        {claim.quote_kind === "reported" ? <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-mute">转述</span> : null}
      </div>
      <blockquote className="mt-6">
        <p className="font-semibold tracking-tight text-3xl leading-snug">“{claim.quote_zh}”</p>
        <p className="mt-4 text-lg text-mute italic">“{claim.quote_en}”</p>
      </blockquote>
      <p className="mt-4 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-mute">
        <span className="inline-flex items-center gap-1">
          <Icon name="calendar" size={14} />
          {claim.published_date} 说出
        </span>
        <Icon name="arrow-right" size={12} />
        <span>{claim.deadline} 截止</span>
        <a href={claim.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
          {sourceLabel(claim.source_url)}
          <Icon name="open" size={14} />
        </a>
        <ArchiveNote archive={archives[claim.source_url]} />
      </p>
      <Proposition claim={claim} />
      {claim.interest_note || chips.length > 0 ? (
        <section className="mt-8">
          <h2 className="flex items-baseline justify-between text-sm font-semibold">
            说这句话时的利益
            <Link href={`/p/${id}/interests`} className="text-xs font-normal text-blue no-underline">
              看利益版图
            </Link>
          </h2>
          {claim.interest_note ? <p className="mt-1 text-sm text-mute">{claim.interest_note}</p> : null}
          {chips.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <li key={chip.key}>
                  <Link
                    href={`/p/${id}/interests`}
                    title={chip.reason}
                    className="block rounded-full bg-sunken px-2.5 py-1 text-xs text-ink no-underline hover-fine:text-blue"
                  >
                    {chip.level === "direct" ? "直接" : "间接"} · {chip.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <p className="mt-8 leading-8">{claim.actual_result || "尚未核对。"}</p>
      <ul className="mt-6 flex flex-col gap-2 text-sm">
        {claim.evidence.map((item) => (
          <li key={item.url} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 no-underline">
              {sourceLabel(item.url)}
              <Icon name="open" size={14} className="text-mute" />
            </a>
            <ArchiveNote archive={archives[item.url]} />
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <ChallengeForm claimId={claim.id} />
      </div>
      {data.thread && data.thread.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight">同一承诺的其他说法</h2>
          <p className="mt-1 text-sm text-mute">这件事在不同时间被反复说过，连成一串；整串 {data.thread.length + 1} 条合计按 √{data.thread.length + 1} 条计分。</p>
          {data.thread.map((item) => (
            <Link key={item.id} href={`/p/${id}/${item.id}`} className="block border-b border-line py-4 no-underline">
              <span className="flex flex-wrap items-center gap-2 text-xs text-mute">
                <StatusPill status={item.status} />
                <span className="num">
                  {item.published_date} 说 · 期限 {item.deadline}
                </span>
              </span>
              <p className="mt-2">{item.quote_zh}</p>
            </Link>
          ))}
        </section>
      ) : null}
      {data.related.length > 0 ? (
        <section className="mt-12">
          <h2 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Icon name="grid" size={18} className="text-mute" />
            同一领域
          </h2>
          <Link href={`/p/${id}?domain=${encodeURIComponent(claim.category)}#claims`} className="mt-1 block text-sm text-blue no-underline">
            看这个领域的全部主张
          </Link>
          {data.related.map((item) => (
            <Link key={item.id} href={`/p/${id}/${item.id}`} className="block border-b border-line py-4 no-underline">
              <StatusPill status={item.status} />
              <p className="mt-2">{item.quote_zh}</p>
            </Link>
          ))}
        </section>
      ) : null}
    </article>
  );
}
