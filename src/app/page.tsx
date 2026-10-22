import Link from "next/link";
import { Portrait } from "@/components/portrait";
import { ScoreBadge, scoreCaption } from "@/components/score-badge";
import { getJson, type Person, type Score } from "@/lib/api";

export const dynamic = "force-dynamic";


// Scored domains first, then the ones with nothing judged yet; larger samples first.
const stage = (score: Score) => (score.value != null ? 1 : 0);
function rankDomains(scores: Score[]) {
  return [...scores].sort((a, b) => stage(b) - stage(a) || b.n - a.n);
}

const PAGE_SIZE = 20;

type PeoplePage = {
  total: number;
  people: (Person & {
    claims: number;
    judged: number;
    pending: number;
    insufficient: number;
    machine: number;
    domains: Score[];
  })[];
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const requested = Math.max(1, Number(pageParam) || 1);
  // Counts and lead domains are aggregated by the API (GET /v1/people), one page at a time, most-judged first.
  const data = await getJson<PeoplePage>(`/v1/people?limit=${PAGE_SIZE}&offset=${(requested - 1) * PAGE_SIZE}&sort=judged`);
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const page = Math.min(pages, requested);
  const shown = data.people.map((person) => {
    const scores = rankDomains(person.domains);
    return {
      person,
      lead: scores[0],
      rest: scores.slice(1, 4),
      more: 0,
      total: person.claims,
      judged: person.judged,
      pending: person.pending,
      machine: person.machine,
    };
  });
  const cards = { length: data.total };

  return (
    <div>
      <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-20 pb-8">
        <div>
          <h1 className="text-[40px] leading-tight font-[900] tracking-tight">
            <span className="display-num mr-2 text-blue">{cards.length}</span>位人物
          </h1>
          <p className="mt-2 max-w-[46ch] text-[15px] text-ink/70">
            每个人说过的、带期限的话，到期后对照结果。分数按领域分开算，不是人品分。
          </p>
        </div>
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-mute">
          <div className="flex items-center gap-1.5">
            <ScoreBadge value={78} n={12} size="sm" />
            <dt>70 以上</dt>
          </div>
          <div className="flex items-center gap-1.5">
            <ScoreBadge value={61} n={12} size="sm" />
            <dt>52–70</dt>
          </div>
          <div className="flex items-center gap-1.5">
            <ScoreBadge value={38} n={12} size="sm" />
            <dt>52 以下</dt>
          </div>
          <div className="flex items-center gap-1.5">
            <ScoreBadge value={null} n={0} size="sm" />
            <dt>还没有已判定的主张</dt>
          </div>
          <dt className="basis-full text-[11px] sm:basis-auto">分数旁的区间越宽、条数越少，越不确定</dt>
        </dl>
      </section>

      {cards.length === 0 ? (
        <p className="rounded-2xl bg-card p-8 text-sm text-mute">
          还没有公开的人物。在上方搜一个名字，agent 会去公开资料里查。
        </p>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((card) => (
          <li key={card.person.id}>
            <Link
              href={`/p/${card.person.id}`}
              className="group flex h-full flex-col rounded-[14px] bg-card p-4 no-underline transition-shadow duration-150 hover-fine:ring-2 hover-fine:ring-blue/25 focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-none"
            >
              <div className="flex items-start gap-3">
                <Portrait person={card.person} riso className="w-14 shrink-0 !rounded-[9px]" />
                <div className="min-w-0 pt-0.5">
                  <p className="truncate text-[16px] leading-6 font-bold">{card.person.name}</p>
                  <p className="line-clamp-2 text-xs leading-[18px] text-mute">{card.person.title}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                {card.lead ? (
                  <>
                    <ScoreBadge value={card.lead.value} n={card.lead.n} low={card.lead.low} high={card.lead.high} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm leading-5 font-medium">{card.lead.domain}</p>
                      <p className="text-xs text-mute">
                        {scoreCaption(card.lead)}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-mute">还没有公开的预测</p>
                )}
              </div>

              {card.rest.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                  {card.rest.map((score) => (
                    <span key={score.domain} className="inline-flex items-center gap-1.5 text-xs">
                      <ScoreBadge value={score.value} n={score.n} low={score.low} high={score.high} size="sm" />
                      <span className="max-w-[9em] truncate text-ink">{score.domain}</span>
                    </span>
                  ))}
                  {card.more > 0 ? <span className="self-center text-xs text-mute">另 {card.more} 个领域</span> : null}
                </div>
              ) : null}

              <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-mute">
                <span>
                  已判定 <b className="num font-semibold text-ink">{card.judged}</b>
                </span>
                <span>
                  待到期 <b className="num font-semibold text-ink">{card.pending}</b>
                </span>
                {card.machine > 0 ? (
                  <span className="ml-auto rounded-full bg-sunken px-2 py-0.5" title="这些主张由 agent 自动核对原话，尚未人工审核">
                    机器核对
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {pages > 1 ? (
        <nav aria-label="分页" className="mt-6 flex items-center justify-center gap-1.5 text-sm">
          {page > 1 ? (
            <Link href={page === 2 ? "/" : `/?page=${page - 1}`} className="rounded-lg px-3 py-1.5 no-underline hover-fine:bg-card">
              上一页
            </Link>
          ) : null}
          {Array.from({ length: pages }, (_, index) => index + 1).map((n) => (
            <Link
              key={n}
              href={n === 1 ? "/" : `/?page=${n}`}
              aria-current={n === page ? "page" : undefined}
              className={`num min-w-9 rounded-lg px-3 py-1.5 text-center no-underline ${n === page ? "bg-ink font-semibold text-white" : "hover-fine:bg-card"}`}
            >
              {n}
            </Link>
          ))}
          {page < pages ? (
            <Link href={`/?page=${page + 1}`} className="rounded-lg px-3 py-1.5 no-underline hover-fine:bg-card">
              下一页
            </Link>
          ) : null}
        </nav>
      ) : null}

      <p className="mt-10 max-w-[70ch] text-xs leading-6 text-mute">
        给 AI 调用：<code className="rounded bg-card px-1.5 py-0.5 text-ink">POST /v1/consult</code>
        ，传入一句话，返回说话人在该领域的分数、80% 区间、样本量和可点回的原话。
        <Link href="/method" className="ml-1 text-blue">
          分数怎么算
        </Link>
      </p>
    </div>
  );
}
