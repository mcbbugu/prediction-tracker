import Link from "next/link";
import type { Claim } from "@/lib/api";

// 收录的带期限说法，按「说话年份 × 领域」：格子深浅 = 说了几句，格子底部的细条 = 这些话后来的结果。
// 只统计已收录、带期限的话，受报道量影响；不是这个人全部的公开表达。

const JUDGED_OK = new Set(["已兑现"]);
const PARTIAL = new Set(["部分兑现"]);
const MISSED = new Set(["未兑现"]);

type Cell = { n: number; ok: number; partial: number; missed: number; open: number };

function tally(list: Claim[]): Cell {
  const ok = list.filter((c) => JUDGED_OK.has(c.status)).length;
  const partial = list.filter((c) => PARTIAL.has(c.status)).length;
  const missed = list.filter((c) => MISSED.has(c.status)).length;
  return { n: list.length, ok, partial, missed, open: list.length - ok - partial - missed };
}

function tip(label: string, cell: Cell) {
  return `${label}：${cell.n} 句（兑现 ${cell.ok}、部分 ${cell.partial}、未兑现 ${cell.missed}、待定或作废 ${cell.open}）`;
}

function Strip({ cell }: { cell: Cell }) {
  if (!cell.n) return null;
  const w = (k: number) => `${(100 * k) / cell.n}%`;
  return (
    <span className="absolute inset-x-1 bottom-1 flex h-[3px] overflow-hidden rounded-full bg-white/40" aria-hidden>
      <span className="bg-blue-deep" style={{ width: w(cell.ok) }} />
      <span className="bg-blue/60" style={{ width: w(cell.partial) }} />
      <span className="bg-ink/70" style={{ width: w(cell.missed) }} />
    </span>
  );
}

export function ClaimHeatmap({
  claims,
  href,
  activeYear,
  activeDomain,
}: {
  claims: Claim[];
  href: (next: { domain?: string | null; year?: string | null }) => string;
  activeYear?: string;
  activeDomain?: string;
}) {
  if (claims.length === 0) return null;
  const year = (c: Claim) => c.published_date.slice(0, 4);
  const years: string[] = [];
  const first = Number(claims.map(year).sort()[0]);
  const last = Math.max(...claims.map((c) => Number(year(c))));
  for (let y = first; y <= last; y += 1) years.push(String(y));
  const domains = [...new Set(claims.map((c) => c.category))].sort(
    (a, b) => claims.filter((c) => c.category === b).length - claims.filter((c) => c.category === a).length,
  );
  const cells = new Map<string, Cell>();
  for (const d of domains) for (const y of years) cells.set(`${d}|${y}`, tally(claims.filter((c) => c.category === d && year(c) === y)));
  const totals = new Map(years.map((y) => [y, tally(claims.filter((c) => year(c) === y))]));
  const max = Math.max(1, ...[...cells.values()].map((c) => c.n));
  const maxTotal = Math.max(1, ...[...totals.values()].map((c) => c.n));

  const shade = (n: number, top: number) =>
    n ? { backgroundColor: `color-mix(in srgb, var(--color-blue) ${Math.round(12 + 78 * (n / top))}%, transparent)` } : undefined;
  const ink = (n: number, top: number) => (n / top > 0.55 ? "text-white" : "text-blue-deep");

  const row = (label: string, domain: string | null, get: (y: string) => Cell, top: number) => (
    <div key={label} className="contents">
      <Link
        href={href({ domain, year: null })}
        className={`truncate py-1 pr-2 text-xs no-underline hover-fine:text-blue ${domain === null ? "font-semibold text-ink" : activeDomain === domain ? "font-semibold text-blue" : "text-ink/80"}`}
      >
        {label}
      </Link>
      {years.map((y) => {
        const cell = get(y);
        const active = activeYear === y && (domain === null ? !activeDomain : activeDomain === domain);
        return cell.n ? (
          <Link
            key={y}
            href={href({ domain, year: y })}
            title={tip(`${y} 年 · ${label}`, cell)}
            style={shade(cell.n, top)}
            className={`num relative flex h-8 items-center justify-center rounded-md text-[11px] font-semibold no-underline ${ink(cell.n, top)} ${active ? "ring-2 ring-ink" : "hover-fine:ring-2 hover-fine:ring-blue/40"}`}
          >
            {cell.n}
            <Strip cell={cell} />
          </Link>
        ) : (
          <span key={y} className="h-8 rounded-md bg-sunken/60" />
        );
      })}
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-[14px] bg-card p-4">
      <div className="grid min-w-max gap-1" style={{ gridTemplateColumns: `minmax(88px, 128px) repeat(${years.length}, minmax(34px, 1fr))` }}>
        <span />
        {years.map((y) => (
          <span key={y} className="num text-center text-[10px] text-mute">
            {y}
          </span>
        ))}
        {row("全部领域", null, (y) => totals.get(y)!, maxTotal)}
        {domains.map((d) => row(d, d, (y) => cells.get(`${d}|${y}`)!, max))}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mute">
        <span>格子里的数字 = 那一年在那个领域说了几句；颜色越深越多。点格子看这些话。</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-[3px] w-4 rounded-full bg-blue-deep" />
          兑现
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-[3px] w-4 rounded-full bg-blue/60" />
          部分
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-[3px] w-4 rounded-full bg-ink/70" />
          未兑现
        </span>
        <span>空白处是待定或作废</span>
      </p>
    </div>
  );
}
