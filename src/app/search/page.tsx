import Link from "next/link";
import { Suspense } from "react";
import Loading from "@/app/loading";
import { ScoreNum } from "@/components/score-num";
import { SearchField } from "@/components/search-field";
import { StatusPill } from "@/components/status-pill";
import { Icon } from "@/components/icon";
import { AnalyzeButton } from "@/components/analyze-button";
import { getJson, type ConsultPayload } from "@/lib/api";

export const dynamic = "force-dynamic";

export default function SearchPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <SearchBody {...props} />
    </Suspense>
  );
}

async function SearchBody({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const data = query
    ? await getJson<ConsultPayload>(`/v1/consult?q=${encodeURIComponent(query)}`)
    : null;

  return (
    <div className="pt-6">
      <form action="/search" className="flex flex-col gap-2 sm:flex-row">
        <SearchField
          label="检索"
          placeholder="人物、领域，或一句待采信的话"
          defaultValue={query}
          className="h-12"
          inputClassName="bg-card"
        />
        <button className="inline-flex h-12 cursor-pointer items-center gap-1.5 self-start rounded-xl bg-ink px-5 text-sm font-medium text-white">
          <Icon name="search" className="text-white" />
          检索
        </button>
      </form>

      {!data ? (
        <p className="mt-10 inline-flex items-center gap-2 text-mute">
          <Icon name="search" className="text-mute" />
          从上面开始。检索会返回人物先验和能点回的原话，不会编造分数。
        </p>
      ) : data.evaluations.length === 0 && data.evidence_chain.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-line p-6">
          <p className="text-lg font-semibold tracking-tight">库里还没有「{query}」</p>
          <p className="mt-2 max-w-[56ch] text-sm leading-6 text-mute">
            agent 会去公开资料里找这个人带期限的说法、头像和利益关系，逐条核对原话。做完就打开他的页面。政治人物和没有公开身份的人不做分析。
          </p>
          <div className="mt-5">
            <AnalyzeButton query={query} auto />
          </div>
        </div>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <section>
            {data.parsed?.claim ? (
              <p className="mb-6 rounded-2xl bg-card px-4 py-3 text-sm leading-6">
                <span className="text-mute">理解为：</span>
                {data.parsed.person_id ? <b className="font-semibold">{data.evaluations[0]?.person_name ?? data.parsed.person_id}</b> : "未识别人物"}
                {data.parsed.domain ? ` · ${data.parsed.domain}` : ""}
                {data.parsed.deadline ? ` · 期限 ${data.parsed.deadline}` : ""}
                <span className="mt-0.5 block text-mute">「{data.parsed.claim}」</span>
              </p>
            ) : null}
            {data.precedents && data.precedents.length > 0 ? (
              <div className="mb-8">
                <h2 className="text-lg font-semibold tracking-tight">他以前说过同一件事</h2>
                <p className="mt-1 text-xs text-mute">同一个目标在不同时间说过的话，以及后来的结果</p>
                <ul className="mt-3 overflow-hidden rounded-2xl bg-card">
                  {data.precedents.map((item) => (
                    <li key={item.claim_id} className="border-b border-line last:border-0">
                      <Link href={item.url.replace(/^https?:\/\/[^/]+/, "")} title={item.why} className="block px-4 py-3 no-underline hover-fine:bg-sunken/60">
                        <span className="flex flex-wrap items-center gap-2 text-xs text-mute">
                          <StatusPill status={item.status} />
                          <span className="num">
                            {item.said_on} 说 · 期限 {item.deadline}
                          </span>
                        </span>
                        <span className="mt-1.5 block text-sm leading-6">{item.quote_zh}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <h2 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Icon name="person" size={20} className="text-mute" />
              人物先验
            </h2>
            <div className="mt-4 space-y-3">
              {data.evaluations.map((item) => (
                <div key={`${item.person_id}-${item.domain}`} className="rounded-3xl border border-line bg-card p-5">
                  <Link href={`/p/${item.person_id}?domain=${encodeURIComponent(item.domain)}#claims`} className="block no-underline">
                    <span className="text-sm text-mute">
                      {item.person_name} · {item.domain}
                    </span>
                    <span className="mt-1 flex items-baseline justify-between">
                      <ScoreNum value={item.score} className="text-5xl" />
                      <span className="text-xs text-mute">
                        {item.score != null
                          ? `P ${item.prior_weight?.toFixed(3)} · n=${item.verified_count}${item.interval_80 ? ` · 80% 区间 ${item.interval_80.low}–${item.interval_80.high}` : ""}`
                          : "还没有已判定的主张"}
                      </span>
                    </span>
                    <span className="mt-3 block text-sm leading-6 text-mute">{item.directive}</span>
                  </Link>
                  {item.exposures && item.exposures.length > 0 ? (
                    <span className="mt-2 flex flex-wrap gap-1">
                      {item.exposures.slice(0, 4).map((exposure) => (
                        <Link
                          key={`${exposure.organisation}-${exposure.target}`}
                          href={`/p/${item.person_id}/interests${exposure.org_key ? `#org-${exposure.org_key}` : ""}`}
                          title={exposure.reason || exposure.organisation}
                          className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink/80 no-underline hover-fine:text-blue"
                        >
                          {exposure.target_zh || exposure.target}
                        </Link>
                      ))}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Icon name="quote" size={20} className="text-mute" />
              主张
            </h2>
            <div className="mt-4">
              {data.evidence_chain.map((claim) => (
                <Link
                  key={claim.id}
                  href={`/p/${claim.person_id}/${claim.id}`}
                  className="block border-b border-line py-4 no-underline"
                >
                  <span className="flex items-center gap-2 text-xs text-mute">
                    <StatusPill status={claim.status} />
                    {claim.person_name} · {claim.category}
                  </span>
                  <span className="mt-1 block leading-7">{claim.quote_zh}</span>
                </Link>
              ))}
            </div>
          </section>
          <div className="lg:col-span-2 border-t border-line pt-6">
            <p className="mb-3 text-sm text-mute">没有你要找的人？</p>
            <AnalyzeButton query={query} variant="secondary" />
          </div>
        </div>
      )}
    </div>
  );
}
