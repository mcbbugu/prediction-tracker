import Link from "next/link";
import { ChangeFeed } from "@/components/change-feed";
import { PersonSubhead } from "@/components/person-subhead";
import { ScoreHistoryCharts, type DomainHistory } from "@/components/score-history-chart";
import { getJson, type Person, type Score, type ScoreChangePage } from "@/lib/api";

export const dynamic = "force-dynamic";

type Snapshot = Score & { computed_at: string };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJson<{ person: Person }>(`/v1/people/${id}`).catch(() => null);
  return { title: `分数变化 · ${data?.person.name ?? "人物"}` };
}

export default async function PersonHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ domain?: string }> }) {
  const { id } = await params;
  const { domain } = await searchParams;
  const path = `/v1/people/${id}/score-changes${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`;
  const [data, history, changes] = await Promise.all([
    getJson<{ person: Person; scores: Score[] }>(`/v1/people/${id}`),
    getJson<{ snapshots: Snapshot[] }>(`/v1/people/${id}/history?compact=1`).catch(() => ({ snapshots: [] as Snapshot[] })),
    getJson<ScoreChangePage>(path),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  // One chart per domain the person still has, larger samples first; oldest point first.
  const charts: DomainHistory[] = [...data.scores]
    .sort((a, b) => b.n - a.n)
    .filter((score) => !domain || score.domain === domain)
    .map((score) => ({
      domain: score.domain,
      points: history.snapshots
        .filter((snap) => snap.domain === score.domain && snap.confidence !== "已移除")
        .map((snap) => ({ t: Date.parse(snap.computed_at), value: snap.value, low: snap.low, high: snap.high, n: snap.n }))
        .reverse(),
    }))
    .filter((row) => row.points.length > 0);
  const domains = Object.entries(changes.domains).sort((a, b) => b[1] - a[1]);
  const all = domains.reduce((sum, [, n]) => sum + n, 0);
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs no-underline ${active ? "bg-ink text-white" : "bg-sunken text-ink/80 hover-fine:text-blue"}`;

  return (
    <div className="pt-6">
      <PersonSubhead person={data.person} crumb="分数变化" title={`${data.person.name}的分数变化`} lede="每次分数变化追加快照，不覆盖；每一次都列出是哪几条主张引起的">
        {domains.length > 1 ? (
          <div className="mt-5 flex flex-wrap gap-1.5">
            <Link href={`/p/${id}/history`} className={chip(!domain)}>
              全部领域 <span className="num opacity-70">{all}</span>
            </Link>
            {domains.map(([name, n]) => (
              <Link key={name} href={domain === name ? `/p/${id}/history` : `/p/${id}/history?domain=${encodeURIComponent(name)}`} className={chip(domain === name)}>
                {name} <span className="num opacity-70">{n}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </PersonSubhead>
      <section className="mt-6">
        <h2 className="flex items-baseline justify-between text-[15px] font-bold">
          分数走势
          <span className="text-xs font-normal text-mute">深色线是分数，两条浅色线是 80% 区间上下沿</span>
        </h2>
        <div className="mt-3">
          <ScoreHistoryCharts domains={charts} now={Date.parse(`${today}T00:00:00Z`)} />
        </div>
      </section>
      <section className="mt-8">
        <h2 className="flex items-baseline justify-between text-[15px] font-bold">
          变化原因
          <span className="text-xs font-normal text-mute">新的在上 · 共 {changes.total} 次</span>
        </h2>
        <div className="mt-3">
          <ChangeFeed key={path} path={path} personId={id} initial={changes.changes} nextCursor={changes.next_cursor} total={changes.total} />
        </div>
      </section>
    </div>
  );
}
