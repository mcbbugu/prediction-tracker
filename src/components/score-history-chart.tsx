"use client";

import { useEffect, useRef } from "react";

export type HistoryPoint = { t: number; value: number | null; low: number | null; high: number | null; n: number };
export type DomainHistory = { domain: string; points: HistoryPoint[] };

const BLUE = "#2f3fc4";
const BLUE_SOFT = "#9aa3e6";

function iso(t: number) {
  return new Date(t).toISOString();
}

// One hand-drawn (chart.xkcd) chart per domain: the score line, plus the 80% interval's upper and lower
// edges as two lighter lines. Each snapshot holds until the next; the last one is repeated at "now".
function DomainChart({ history, now }: { history: DomainHistory; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const points = [...history.points].sort((a, b) => a.t - b.t);
  const latest = points.at(-1)!;
  const plotted = points.filter((p) => p.low != null && p.high != null);

  useEffect(() => {
    const host = ref.current;
    if (!host || plotted.length === 0) return;
    let cancelled = false;
    // chart.xkcd sizes the <svg> from its parent (width, height = 2/3 width) and adds its own tooltip nodes,
    // so React only owns the empty host div; the svg inside is created and removed here.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${history.domain}分数变化，共 ${points.length} 个快照`);
    host.replaceChildren(svg);
    import("chart.xkcd").then((mod) => {
      if (cancelled) return;
      const chartXkcd = (mod as { default?: unknown }).default ?? mod;
      const XY = (chartXkcd as { XY: new (el: SVGSVGElement, config: unknown) => unknown }).XY;
      const withNow = [...plotted, { ...plotted.at(-1)!, t: Math.max(now, plotted.at(-1)!.t + 60_000) }];
      const spanDays = (withNow.at(-1)!.t - withNow[0].t) / 86_400_000;
      const datasets = [
        ...(withNow.some((p) => p.value != null)
          ? [{ label: "分数", data: withNow.filter((p) => p.value != null).map((p) => ({ x: iso(p.t), y: p.value })) }]
          : []),
        { label: "区间上沿", data: withNow.map((p) => ({ x: iso(p.t), y: p.high })) },
        { label: "区间下沿", data: withNow.map((p) => ({ x: iso(p.t), y: p.low })) },
      ];
      new XY(svg, {
        data: { datasets },
        options: {
          xTickCount: 3,
          yTickCount: 3,
          showLine: true,
          dotSize: 0.8,
          timeFormat: spanDays > 2 ? "MM-DD" : "HH:mm",
          showLegend: false,
          dataColors: datasets.length === 3 ? [BLUE, BLUE_SOFT, BLUE_SOFT] : [BLUE_SOFT, BLUE_SOFT],
          strokeColor: "#6b6b6f",
          backgroundColor: "#ffffff",
          fontFamily: "xkcd, 'PingFang SC', 'Noto Sans SC', sans-serif",
        },
      });
    });
    return () => {
      cancelled = true;
      host.replaceChildren();
    };
    // plotted/points derive from history; re-run only when the data itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, now]);

  return (
    <figure className="rounded-[14px] bg-card p-3">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{history.domain}</span>
        <span className="num shrink-0 text-[11px] text-mute">
          {latest.value != null
            ? `${latest.value.toFixed(1)} · 区间 ${latest.low}–${latest.high} · ${latest.n} 条`
            : latest.low != null
              ? `区间 ${latest.low}–${latest.high} · ${latest.n} 条`
              : `样本不足 · ${latest.n} 条`}
        </span>
      </figcaption>
      {plotted.length === 0 ? (
        <p className="mt-3 text-[11px] text-mute">满 3 条已判定后开始画线。</p>
      ) : (
        <div ref={ref} className="relative mt-1 w-full" />
      )}
    </figure>
  );
}

export function ScoreHistoryCharts({ domains, now }: { domains: DomainHistory[]; now: number }) {
  // chart.xkcd fixes height at 2/3 of width, so charts are kept small by keeping them narrow (4 per row).
  const drawable = domains.filter((history) => history.points.some((p) => p.low != null && p.high != null));
  const pending = domains.filter((history) => !drawable.includes(history));
  if (domains.length === 0) return <p className="rounded-[14px] bg-card p-4 text-xs text-mute">还没有分数快照。</p>;
  return (
    <div>
      {drawable.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {drawable.map((history) => (
            <DomainChart key={history.domain} history={history} now={now} />
          ))}
        </div>
      ) : null}
      {pending.length > 0 ? (
        <p className="mt-2 px-1 text-[11px] text-mute">
          {pending.map((history) => history.domain).join("、")}：已判定不足 3 条，暂不画线。
        </p>
      ) : null}
    </div>
  );
}
