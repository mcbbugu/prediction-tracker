import Link from "next/link";
import { KIND_LABEL, isCurrent, orgLabel, type Org, type Relation } from "@/lib/interests";

// 时间线：每家机构一行，横条是他在那里的任职和持股，圆点是他说过的话。
// 读法：一句话落在哪一行、落在横条的哪一段，就是他说这句话时在那家机构的身份。

type ClaimDot = { id: string; quote_zh: string; published_date: string; status: string };

function when(value: string | null) {
  const m = value?.match(/^(\d{4})(?:-(\d{2}))?/);
  return m ? Number(m[1]) + (m[2] ? (Number(m[2]) - 1) / 12 : 0) : null;
}

function span(item: { started: string | null; ended: string | null }) {
  const end = isCurrent(item) ? "至今" : (item.ended ?? "");
  return item.started ? `${item.started} – ${end}` : end;
}

const DONE = new Set(["已兑现", "部分兑现"]);

export function InterestTimeline({
  personId,
  orgs,
  claimsByOrg,
}: {
  personId: string;
  orgs: Org[];
  claimsByOrg: Map<string | null, ClaimDot[]>;
}) {
  const now = new Date();
  const today = now.getFullYear() + now.getMonth() / 12;
  const rows = orgs
    .map((org) => ({
      key: org.org_key,
      label: orgLabel(org),
      relations: org.relations.filter((r) => when(r.started) != null),
      undated: org.relations.filter((r) => when(r.started) == null).length,
      claims: claimsByOrg.get(org.org_key) ?? [],
      current: org.relations.some(isCurrent),
    }))
    .filter((row) => row.relations.length || row.claims.length)
    .sort(
      (a, b) =>
        b.claims.length - a.claims.length ||
        Number(b.current) - Number(a.current) ||
        Math.min(...b.relations.map((r) => when(r.started)!)) - Math.min(...a.relations.map((r) => when(r.started)!)),
    );
  const unrelated = claimsByOrg.get(null) ?? [];
  if (rows.length === 0) return null;

  const starts = [
    ...rows.flatMap((row) => row.relations.map((r) => when(r.started)!)),
    ...[...claimsByOrg.values()].flat().map((c) => when(c.published_date)).filter((v): v is number => v != null),
  ];
  const from = Math.floor(Math.min(...starts));
  const to = Math.ceil(today + 0.5);
  const step = to - from > 20 ? 5 : to - from > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ticks.push(y);
  const pos = (t: number) => `${(Math.min(Math.max(t, from), to) - from) / (to - from) * 100}%`;
  const width = (a: number, b: number) => `${Math.max(0.6, ((Math.min(b, to) - Math.max(a, from)) / (to - from)) * 100)}%`;

  const grid = (
    <>
      {ticks.map((t) => (
        <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: pos(t) }} />
      ))}
      <span className="absolute inset-y-0 w-px bg-ink/30" style={{ left: pos(today) }} />
    </>
  );

  const dot = (claim: ClaimDot) => {
    const t = when(claim.published_date);
    if (t == null) return null;
    const done = DONE.has(claim.status);
    const failed = claim.status === "未兑现";
    return (
      <Link
        key={claim.id}
        href={`/p/${personId}/${claim.id}`}
        title={`${claim.published_date} · ${claim.status}\n「${claim.quote_zh}」`}
        className={`absolute top-1/2 z-10 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-transform hover-fine:scale-150 ${
          done ? "bg-ink" : failed ? "border-[2px] border-ink bg-card" : "bg-mute/45"
        }`}
        style={{ left: pos(t) }}
      />
    );
  };

  const bar = (r: Relation) => {
    const a = when(r.started)!;
    const b = isCurrent(r) ? today : (when(r.ended) ?? a + 1 / 12);
    const title = `${KIND_LABEL[r.kind]} · ${r.role} · ${span(r)}`;
    if (r.kind === "deal") {
      return <span key={r.id} title={title} className="absolute top-[22px] size-[7px] -translate-x-1/2 rotate-45 bg-blue" style={{ left: pos(a) }} />;
    }
    return (
      <span
        key={r.id}
        title={title}
        className={`absolute rounded-full ${r.kind === "role" ? "top-[9px] h-[7px] bg-blue" : "top-[20px] h-[5px] bg-blue/35"}`}
        style={{ left: pos(a), width: width(a, b) }}
      />
    );
  };

  return (
    <div className="rounded-[14px] bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mute">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[7px] w-5 rounded-full bg-blue" />
          任职
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[5px] w-5 rounded-full bg-blue/35" />
          持股
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-[7px] rotate-45 bg-blue" />
          交易
        </span>
        <span className="mx-1 h-3 w-px bg-line" />
        <span className="inline-flex items-center gap-1.5">
          <span className="size-[9px] rounded-full bg-ink" />
          说过的话 · 已兑现
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-[9px] rounded-full border-[2px] border-ink" />
          未兑现
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-[9px] rounded-full bg-mute/45" />
          待定
        </span>
      </div>

      <div className="grid grid-cols-[96px_1fr] gap-x-3 sm:grid-cols-[132px_1fr]">
        {/* Year axis */}
        <span />
        <div className="relative h-5 text-[10px] text-mute">
          {ticks.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2" style={{ left: pos(t) }}>
              {t}
            </span>
          ))}
          <span className="absolute -translate-x-1/2 font-semibold text-ink" style={{ left: pos(today), top: 10 }}>
            今天
          </span>
        </div>

        {rows.map((row) => (
          <div key={row.key} className="contents">
            <div className="flex min-w-0 flex-col justify-center border-t border-line py-1.5">
              <a href={`#org-${row.key}`} className={`truncate text-xs font-medium no-underline hover-fine:text-blue ${row.current ? "text-ink" : "text-mute"}`}>
                {row.label}
              </a>
              {row.claims.length ? <span className="text-[10px] text-mute">{row.claims.length} 句相关</span> : null}
            </div>
            <div className="relative h-[34px] border-t border-line">
              {grid}
              {row.relations.map(bar)}
              {row.claims.map(dot)}
              {row.relations.length === 0 ? <span className="absolute top-2 left-1 text-[10px] text-mute">任职时间未知</span> : null}
            </div>
          </div>
        ))}

        {unrelated.length ? (
          <div className="contents">
            <div className="flex flex-col justify-center border-t border-line py-1.5">
              <span className="text-xs text-mute">与利益无关</span>
              <span className="text-[10px] text-mute">{unrelated.length} 句</span>
            </div>
            <div className="relative h-[34px] border-t border-line">
              {grid}
              {unrelated.map(dot)}
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-mute">
        一句话落在哪一行，就是谈的哪家机构；落在横条的哪一段，就是他说这句话时在那里的身份。点圆点看原话。
      </p>
    </div>
  );
}
