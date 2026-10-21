import Link from "next/link";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/status-pill";
import { getJson, type Claim } from "@/lib/api";
import { sourceLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string; claimId: string }>;
}) {
  const { id, claimId } = await params;
  const data = await getJson<{ claim: Claim; related: Claim[] }>(`/v1/people/${id}/claims/${claimId}`);
  const claim = data.claim;

  return (
    <article className="mx-auto max-w-[720px] pt-6">
      <p className="inline-flex items-center gap-1 text-sm text-mute">
        <Link href={`/p/${id}`} className="inline-flex items-center gap-1 no-underline hover-fine:text-ink">
          <Icon name="person" size={14} />
          {claim.person_name}
        </Link>
        <Icon name="chevron-right" size={12} />
        <span className="inline-flex items-center gap-1">
          <Icon name="tag" size={14} />
          {claim.category}
        </span>
      </p>
      <div className="mt-4">
        <StatusPill status={claim.status} />
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
        <a href={claim.source_url} className="inline-flex items-center gap-1">
          {sourceLabel(claim.source_url)}
          <Icon name="open" size={14} />
        </a>
      </p>
      <p className="mt-8 leading-8">{claim.actual_result || "尚未核对。"}</p>
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        {claim.evidence.map((item) => (
          <a key={item.url} href={item.url} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 no-underline">
            {sourceLabel(item.url)}
            <Icon name="open" size={14} className="text-mute" />
          </a>
        ))}
      </div>
      {data.related.length > 0 ? (
        <section className="mt-12">
          <h2 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Icon name="grid" size={18} className="text-mute" />
            同一领域
          </h2>
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
