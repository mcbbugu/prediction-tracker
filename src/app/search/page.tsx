import Link from "next/link";
import { ScoreNum } from "@/components/score-num";
import { SearchField } from "@/components/search-field";
import { StatusPill } from "@/components/status-pill";
import { Icon } from "@/components/icon";
import { AnalyzeButton } from "@/components/analyze-button";
import { getJson, type ConsultPayload } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SearchPage({
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
            agent 可以现在去公开资料里找这个人说过的、带截止时间的预测，逐条核对原话；已经到期的再找实际结果。大约需要几分钟，结果先进审核台，不会直接公开。政治人物和没有公开身份的人不做分析。
          </p>
          <div className="mt-5">
            <AnalyzeButton query={query} />
          </div>
        </div>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <section>
            <h2 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Icon name="person" size={20} className="text-mute" />
              人物先验
            </h2>
            <div className="mt-4 space-y-3">
              {data.evaluations.map((item) => (
                <Link
                  key={`${item.person_id}-${item.domain}`}
                  href={`/p/${item.person_id}`}
                  className="block rounded-3xl border border-line bg-card p-5 no-underline"
                >
                  <span className="text-sm text-mute">
                    {item.person_name} · {item.domain}
                  </span>
                  <span className="mt-1 flex items-baseline justify-between">
                    {item.score == null && item.interval_80 ? (
                      <span className="num text-3xl text-mute">
                        {item.interval_80.low}–{item.interval_80.high}
                      </span>
                    ) : (
                      <ScoreNum value={item.score} className="text-5xl" />
                    )}
                    <span className="text-xs text-mute">
                      {item.score != null
                        ? `P ${item.prior_weight?.toFixed(3)} · n=${item.verified_count}${item.interval_80 ? ` · 80% 区间 ${item.interval_80.low}–${item.interval_80.high}` : ""}`
                        : item.interval_80
                          ? `80% 区间 · n=${item.verified_count}，满 8 条出分`
                          : "样本不足"}
                    </span>
                  </span>
                  <span className="mt-3 block text-sm leading-6 text-mute">{item.directive}</span>
                </Link>
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
