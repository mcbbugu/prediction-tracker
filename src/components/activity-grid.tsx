import Link from "next/link";
import type { Claim } from "@/lib/api";

// GitHub 风格的小格子图：一列一年、一行一个月，颜色越深那个月收录的带期限说法越多。点格子筛出那个月说的话。
// 只统计已收录的话，受报道量影响，不代表全部的公开表达。

const CELL = 10;
const GAP = 2;

export function ActivityGrid({
  claims,
  href,
  active,
}: {
  claims: Claim[];
  href: (month: string) => string;
  active?: string;
}) {
  if (claims.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of claims) {
    const month = c.published_date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  const years = claims.map((c) => Number(c.published_date.slice(0, 4)));
  const first = Math.min(...years);
  const last = Math.max(...years);
  const cols = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const max = Math.max(...counts.values());
  // Four steps like GitHub; any month with something is at least the lightest step.
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((4 * n) / max)));
  const FILL = ["bg-sunken", "bg-blue/25", "bg-blue/45", "bg-blue/70", "bg-blue"];

  return (
    <div className="inline-flex flex-col gap-1" aria-label="按月份的收录说法">
      <div className="flex gap-[2px]">
        <div className="mr-1 flex flex-col justify-between text-[9px] leading-none text-mute" style={{ height: 12 * CELL + 11 * GAP }}>
          <span>1月</span>
          <span>12月</span>
        </div>
        {cols.map((year) => (
          <div key={year} className="flex flex-col gap-[2px]">
            {Array.from({ length: 12 }, (_, m) => {
              const month = `${year}-${String(m + 1).padStart(2, "0")}`;
              const n = counts.get(month) ?? 0;
              const cls = `block rounded-[2px] ${FILL[level(n)]} ${active === month ? "ring-1 ring-ink" : ""}`;
              return n ? (
                <Link
                  key={month}
                  href={href(month)}
                  title={`${year} 年 ${m + 1} 月：${n} 句`}
                  className={`${cls} hover-fine:ring-1 hover-fine:ring-blue`}
                  style={{ width: CELL, height: CELL }}
                />
              ) : (
                <span key={month} title={`${year} 年 ${m + 1} 月：没有收录`} className={cls} style={{ width: CELL, height: CELL }} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex justify-between pl-[22px] text-[9px] leading-none text-mute">
        <span className="num">{first}</span>
        {last > first ? <span className="num">{last}</span> : null}
      </div>
    </div>
  );
}
