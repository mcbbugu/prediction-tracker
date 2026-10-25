import Link from "next/link";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/status-pill";
import { curationLabel, type Claim } from "@/lib/api";
import { plainResult, spaceCjk } from "@/lib/terms";

const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type Chip = { key: string; label: string; reason: string };

// One claim in a person's list (person page overview and /p/[id]/claims). Plain markup, usable from client feeds.
export function ClaimRow({ claim, today, chips = [] }: { claim: Claim; today: string; chips?: Chip[] }) {
  const overdue = claim.status === "待定" && claim.deadline < today;
  const upcoming = claim.status === "待定" && claim.deadline >= today;
  return (
    <li className="border-b border-line last:border-0">
      <Link
        prefetch={false}
        href={`/p/${claim.person_id}/${claim.id}`}
        className="grid gap-x-4 gap-y-1 px-4 py-3 no-underline hover-fine:bg-sunken/60 md:grid-cols-[112px_1fr_150px]"
      >
        <span className="flex flex-wrap items-start gap-1.5">
          {overdue ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink/30 px-2 py-0.5 text-[12px] font-medium text-ink">
              <Icon name="hourglass" size={12} />
              待核对
            </span>
          ) : (
            <StatusPill status={upcoming ? "未到期" : claim.status} />
          )}
          {claim.quote_kind === "reported" ? <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-mute">转述</span> : null}
          {claim.kind === "promise" || claim.kind === "forecast" || claim.kind === "uncertain" ? (
            <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-mute">
              {claim.kind === "promise" ? "承诺" : claim.kind === "forecast" ? "预测" : "类别存疑"}
            </span>
          ) : null}
          {claim.disputed ? (
            <span title="有人提交了反证，正在复核" className="rounded-md border border-dashed border-ink/40 px-1.5 py-0.5 text-[11px] text-ink">
              有争议
            </span>
          ) : null}
          {claim.recheck_note?.includes("结论不变") ? <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-mute">已复核，结论不变</span> : null}
          {claim.disagreed ? (
            <span title="两次独立判定不一致，等待人工裁定" className="rounded-md border border-dashed border-ink/40 px-1.5 py-0.5 text-[11px] text-ink">
              有分歧
            </span>
          ) : null}
          {curationLabel(claim.curation) ? (
            <span className="rounded-md border border-dashed border-ink/40 px-1.5 py-0.5 text-[11px] text-ink">{curationLabel(claim.curation)}</span>
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 block text-[15px] leading-6">{claim.quote_zh}</span>
          {claim.interest_note ? <span className="mt-0.5 block text-xs text-mute">{spaceCjk(claim.interest_note)}</span> : null}
          {chips.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {chips.map((chip) => (
                <span key={chip.key} title={chip.reason} className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink/80">
                  {chip.label}
                </span>
              ))}
            </span>
          ) : null}
          {JUDGED.has(claim.status) && claim.actual_result ? (
            <span className="mt-0.5 line-clamp-1 block text-xs text-mute">
              <span className="font-medium text-ink/70">结果：</span>
              {plainResult(claim.actual_result)}
            </span>
          ) : null}
        </span>
        <span className="flex flex-row flex-wrap gap-x-3 text-[11px] text-mute md:flex-col md:items-end md:text-right">
          <span className="num">
            {claim.published_date.slice(0, 7)} → {claim.deadline.slice(0, 7)}
          </span>
          <span>{claim.category}</span>
          <span className="truncate">
            {host(claim.source_url)}
            {claim.reviewed === false ? "" : " · 人工复核"}
          </span>
        </span>
      </Link>
    </li>
  );
}

// One claim in the site-wide list (/claims): who said it, then the quote.
export function SiteClaimRow({ claim, today }: { claim: Claim; today: string }) {
  return (
    <li className="border-b border-line">
      <Link prefetch={false} href={`/p/${claim.person_id}/${claim.id}`} className="grid gap-2 py-4 no-underline sm:grid-cols-[140px_1fr]">
        <span className="flex flex-wrap items-center gap-2 text-xs text-mute">
          <StatusPill status={claim.status === "待定" && claim.deadline < today ? "待核对" : claim.status} />
          <span>{claim.person_name}</span>
          {claim.disputed ? <span className="rounded-md border border-dashed border-ink/40 px-1.5 text-[11px] text-ink">有争议</span> : null}
          {claim.disagreed ? <span className="rounded-md border border-dashed border-ink/40 px-1.5 text-[11px] text-ink">有分歧</span> : null}
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
            {JUDGED.has(claim.status) && claim.actual_result ? <span className="ml-2 line-clamp-1">结果：{plainResult(claim.actual_result)}</span> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
