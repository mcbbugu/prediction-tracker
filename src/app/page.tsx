import Link from "next/link";
import { Card, CARD_TARGET_CLASS } from "@/components/beui/motion/card";
import { HomeHero } from "@/components/home-hero";
import { HomeWash } from "@/components/home-wash";
import { Portrait } from "@/components/portrait";
import { ScoreBadge, scoreCaption } from "@/components/score-badge";
import { cn } from "@/lib/utils";
import { curationLabel, getJson, type Person, type Score } from "@/lib/api";
import { shortTitle, spaceCjk, TERMS } from "@/lib/terms";

export const dynamic = "force-dynamic";


// Scored domains first, then the ones with nothing judged yet; larger samples first.
function picked(score: Score, rank: "promise" | "forecast" | "all"): Score {
  if (rank === "all") return score;
  const part = rank === "forecast" ? score.forecast : score.promise;
  if (!part) return { ...score, value: null, low: null, high: null, n: 0 };
  return { ...score, value: part.value, low: part.low, high: part.high, n: part.n };
}

function rankDomains(scores: Score[], rank: "promise" | "forecast" | "all") {
  const stage = (score: Score) => (score.value != null ? 1 : 0);
  const view = scores.map((score) => picked(score, rank));
  return view.sort((a, b) => stage(b) - stage(a) || b.n - a.n);
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

export default async function HomePage({ searchParams }: { searchParams: Promise<{ page?: string; rank?: string }> }) {
  const { page: pageParam, rank: rankParam } = await searchParams;
  const rank = rankParam === "forecast" || rankParam === "all" ? rankParam : "promise";
  const requested = Math.max(1, Number(pageParam) || 1);
  // Counts and lead domains are aggregated by the API (GET /v1/people), one page at a time, most-judged first.
  const data = await getJson<PeoplePage>(`/v1/people?limit=${PAGE_SIZE}&offset=${(requested - 1) * PAGE_SIZE}&sort=judged`);
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const page = Math.min(pages, requested);
  const homeHref = (n: number) => {
    const params = new URLSearchParams();
    if (n > 1) params.set("page", String(n));
    if (rank !== "promise") params.set("rank", rank);
    const text = params.toString();
    return text ? `/?${text}` : "/";
  };
  const shown = data.people.map((person) => {
    const scores = rankDomains(person.domains, rank);
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
  // Page 1 also shows how many people have a score and a live example for the hero. The list is small for now;
  // a scored-count field on /v1/people can replace this second request once the directory grows past 100.
  const everyone = page === 1 ? await getJson<PeoplePage>(`/v1/people?limit=100&offset=0&sort=judged`) : null;
  const scoredCount = everyone ? everyone.people.filter((p) => p.domains.some((d) => d.value != null)).length : 0;
  const exampleSource = everyone?.people.find((p) => p.domains.some((d) => d.value != null && d.n >= 5)) ?? null;
  const exampleScore = exampleSource ? [...exampleSource.domains].filter((d) => d.value != null).sort((a, b) => b.n - a.n)[0] : null;
  const example =
    exampleSource && exampleScore && exampleScore.value != null
      ? { person: exampleSource.name, domain: exampleScore.domain, value: exampleScore.value, low: exampleScore.low, high: exampleScore.high, n: exampleScore.n, role: shortTitle(exampleSource.title, 30) || null }
      : null;

  return (
    <div>
      <HomeWash />
      <section className="pt-4">
        {page === 1 ? <HomeHero total={cards.length} scored={scoredCount} example={example} /> : null}
      </section>

      <section className="border-t border-black/[0.06] pt-12">
        <div className="mb-8 text-center">
          <p className="text-xs font-medium tracking-wide text-blue">人物库</p>
          <h2 className="mt-1 text-[28px] font-semibold tracking-tight">已收录 {cards.length} 位公众人物{everyone ? <span className="text-mute">，{scoredCount} 位已有分数</span> : null}</h2>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm leading-6 text-mute">分数按领域分开，默认看靠谱度（承诺兑现了多少）。{TERMS.aiDisclosure}。</p>
          <p className="mt-1 text-xs text-mute">实心 ≥ 70 · 浅色 52–70 · 空心 &lt; 52 · 虚线：还没有判定</p>
          <p className="mt-3 flex justify-center gap-3 text-xs">
            {(
              [
                ["promise", "靠谱度"],
                ["forecast", "判断力"],
                ["all", TERMS.pooled],
              ] as const
            ).map(([key, label]) => (
              <Link key={key} href={key === "promise" ? "/" : `/?rank=${key}`} className={rank === key ? "text-blue no-underline" : "text-mute no-underline hover-fine:text-blue"}>
                {label}
              </Link>
            ))}
          </p>
        </div>
        {cards.length === 0 ? (
        <p className="rounded-2xl bg-card p-8 text-sm text-mute">
          还没有公开的人物。在上方搜一个名字，agent 会去公开资料里查。
        </p>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((card) => (
          <li key={card.person.id}>
            <Card
              interactive
              size="compact"
              className="h-full gap-0 border-white/80 bg-white/90 p-0 py-0 shadow-[0_18px_40px_-28px_rgba(31,42,138,0.55)] backdrop-blur-md"
            >
            <Link
              href={`/p/${card.person.id}`}
              prefetch={true}
              className={cn(CARD_TARGET_CLASS, "group flex h-full flex-col p-4 no-underline focus-visible:outline-none")}
            >
              <div className="flex items-start gap-3">
                <Portrait person={card.person} riso className="w-14 shrink-0 !rounded-[9px]" />
                <div className="min-w-0 pt-0.5">
                  <p className="truncate text-[16px] leading-6 font-bold">{card.person.name}</p>
                  <p className="line-clamp-2 text-xs leading-[18px] text-mute" title={spaceCjk(card.person.title)}>{shortTitle(card.person.title)}</p>
                  {curationLabel(card.person.curation) ? (
                    <span className="mt-1 inline-block rounded-md border border-dashed border-ink/40 px-1.5 py-0.5 text-[11px] text-ink">{curationLabel(card.person.curation)}</span>
                  ) : null}
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

              </div>
            </Link>
            </Card>
          </li>
        ))}
      </ul>

      {pages > 1 ? (
        <nav aria-label="分页" className="mt-6 flex items-center justify-center gap-1.5 text-sm">
          {page > 1 ? (
            <Link href={homeHref(page - 1)} className="rounded-lg px-3 py-1.5 no-underline hover-fine:bg-card">
              上一页
            </Link>
          ) : null}
          {Array.from({ length: pages }, (_, index) => index + 1).map((n) => (
            <Link
              key={n}
              href={homeHref(n)}
              aria-current={n === page ? "page" : undefined}
              className={`num min-w-9 rounded-lg px-3 py-1.5 text-center no-underline ${n === page ? "bg-ink font-semibold text-white" : "hover-fine:bg-card"}`}
            >
              {n}
            </Link>
          ))}
          {page < pages ? (
            <Link href={homeHref(page + 1)} className="rounded-lg px-3 py-1.5 no-underline hover-fine:bg-card">
              下一页
            </Link>
          ) : null}
        </nav>
      ) : null}
      </section>
    </div>
  );
}
