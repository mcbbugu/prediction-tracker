import Link from "next/link";
import { Icon } from "@/components/icon";
import { ActivityGrid } from "@/components/activity-grid";
import { Portrait } from "@/components/portrait";
import { ScoreBadge } from "@/components/score-badge";
import { explainChanges, type ChangeLine, type Snapshot } from "@/lib/score-changes";
import { InterestFlow } from "@/components/interest-flow";
import { claimExposureChips, loadInterests } from "@/lib/interests";
import { CopyButton } from "@/components/copy-button";
import { ScoreHistoryCharts, type DomainHistory } from "@/components/score-history-chart";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";
import { apiBase, getJson, type Claim, type Indicators, type Interest, type Person, type PersonInterests, type ProfileRow, type Score } from "@/lib/api";

export const dynamic = "force-dynamic";

const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);

// What each formula version changed, in reader terms (see SPEC 分数显示).
const FORMULA_NOTES: Record<string, string> = {
  "v1.1": "有一条判定就出分，并给出区间",
  "v1.2": "时间衰减放宽为每 3 年减半，几年前的判定重新计入",
};

function quoteSnippet(claim: Claim | undefined) {
  if (!claim) return "一条已不再公开的主张";
  const text = claim.quote_zh.replace(/\s+/g, " ");
  return `「${text.length > 34 ? `${text.slice(0, 34)}…` : text}」`;
}

// One reason line, in the reader's terms: what happened to which of this person's claims.
function describe(line: ChangeLine, personId: string) {
  const link = (claim: Claim | undefined) =>
    claim ? (
      <Link href={`/p/${personId}/${claim.id}`} className="text-ink/80 no-underline hover-fine:text-blue">
        {quoteSnippet(claim)}
      </Link>
    ) : (
      quoteSnippet(claim)
    );
  if (line.kind === "added") return <>新判定 <b className="font-medium text-ink">{line.status}</b>：{link(line.claim)}</>;
  if (line.kind === "removed") return <>撤回不计（{line.status}）：{link(line.claim)}</>;
  if (line.kind === "changed")
    return (
      <>
        判定改为 <b className="font-medium text-ink">{line.to}</b>（原为 {line.from}）：{link(line.claim)}
      </>
    );
  if (line.kind === "count")
    return line.to > line.from ? `新增 ${line.to - line.from} 条已判定（${line.from} → ${line.to}）` : `减少 ${line.from - line.to} 条已判定（${line.from} → ${line.to}）`;
  return `计分规则调整为 ${line.version}：${FORMULA_NOTES[line.version] ?? "计算方式调整"}`;
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// 待定 with a passed deadline is not the same as 待定 still in the future: one is our backlog, the other is time.
function phase(claim: Claim, today: string) {
  if (JUDGED.has(claim.status)) return "judged";
  if (claim.status === "证据不足") return "unclear";
  return claim.deadline < today ? "overdue" : "upcoming";
}

// ?show= filters behind the clickable numbers.
const SHOW: Record<string, { label: string; test: (claim: Claim, today: string) => boolean }> = {
  judged: { label: "已判定", test: (c) => JUDGED.has(c.status) },
  overdue: { label: "已过期待核对", test: (c, today) => phase(c, today) === "overdue" },
  upcoming: { label: "未到期", test: (c, today) => phase(c, today) === "upcoming" },
  unclear: { label: "证据不足（作废）", test: (c) => c.status === "证据不足" },
  fulfilled: { label: "已兑现", test: (c) => c.status === "已兑现" },
  partial: { label: "部分兑现", test: (c) => c.status === "部分兑现" },
  missed: { label: "未兑现", test: (c) => c.status === "未兑现" },
  rescheduled: { label: "改期串", test: (c) => Boolean(c.thread_id) },
  machine: { label: "机器核对", test: (c) => c.reviewed === false },
  manual: { label: "人工复核", test: (c) => c.reviewed !== false },
};

function yearSpan(claim: Claim) {
  return `${claim.published_date.slice(0, 7)} → ${claim.deadline.slice(0, 7)}`;
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ domain?: string; show?: string; year?: string; month?: string }>;
}) {
  const { id } = await params;
  const { domain: domainFilter, show, year: rawYear, month: rawMonth } = await searchParams;
  const yearFilter = rawYear && /^\d{4}$/.test(rawYear) ? rawYear : undefined;
  const monthFilter = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : undefined;
  const [data, history] = await Promise.all([
    getJson<{ person: Person; claims: Claim[]; scores: Score[]; profile: ProfileRow[]; interests?: PersonInterests; indicators?: Indicators }>(`/v1/people/${id}`),
    getJson<{ snapshots: Snapshot[] }>(`/v1/people/${id}/history`).catch(() => ({ snapshots: [] as Snapshot[] })),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const claims = data.claims;
  const count = (list: Claim[], p: string) => list.filter((claim) => phase(claim, today) === p).length;

  // One row per domain: scored first, then by sample size.
  const stage = (score: Score) => (score.value != null ? 1 : 0);
  const domains = [...data.scores]
    .sort((a, b) => stage(b) - stage(a) || b.n - a.n)
    .map((score) => {
      const list = claims.filter((claim) => claim.category === score.domain);
      const next = list
        .filter((claim) => phase(claim, today) === "upcoming")
        .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
      return {
        score,
        total: list.length,
        fulfilled: list.filter((claim) => claim.status === "已兑现").length,
        partial: list.filter((claim) => claim.status === "部分兑现").length,
        missed: list.filter((claim) => claim.status === "未兑现").length,
        voided: list.filter((claim) => claim.status === "证据不足").length,
        threads: new Set(list.filter((claim) => claim.thread_id).map((claim) => claim.thread_id)).size,
        overdue: count(list, "overdue"),
        upcoming: count(list, "upcoming"),
        next,
      };
    });

  // Past deadlines first (most recent at the top: these carry the record), then the future, soonest first.
  const showFilter = show && SHOW[show] ? SHOW[show] : null;
  const scoped = claims.filter(
    (claim) =>
      (!domainFilter || claim.category === domainFilter) &&
      (!showFilter || showFilter.test(claim, today)) &&
      (!yearFilter || claim.published_date.startsWith(yearFilter)) &&
      (!monthFilter || claim.published_date.startsWith(monthFilter)),
  );
  // Every number on this page links to the claims behind it (SPEC: 数字都能追到原文).
  const listHref = (next: { domain?: string | null; show?: string | null; year?: string | null; month?: string | null }) => {
    const params = new URLSearchParams();
    const d = next.domain === undefined ? domainFilter : next.domain;
    const sh = next.show === undefined ? show : next.show;
    const y = next.year === undefined ? yearFilter : next.year;
    if (d) params.set("domain", d);
    if (sh) params.set("show", sh);
    if (y) params.set("year", y);
    const mo = next.month === undefined ? monthFilter : next.month;
    if (mo) params.set("month", mo);
    const query = params.toString();
    return `/p/${id}${query ? `?${query}` : ""}#claims`;
  };
  const shown = [
    ...scoped.filter((claim) => claim.deadline < today).sort((a, b) => b.deadline.localeCompare(a.deadline)),
    ...scoped.filter((claim) => claim.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline)),
  ];
  const upcoming = claims
    .filter((claim) => phase(claim, today) === "upcoming")
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 3);
  const machine = claims.filter((claim) => claim.reviewed === false).length;
  const lastChange = history.snapshots[0]?.computed_at?.slice(0, 10);
  const lead = domains.find((row) => row.score.value != null)?.score;

  const changes = explainChanges(history.snapshots, claims, new Set(data.scores.map((score) => score.domain)));

  // Snapshots grouped per domain (oldest first), for the domains the person still has.
  const charts: DomainHistory[] = domains
    .map((row) => ({
      domain: row.score.domain,
      points: history.snapshots
        .filter((snap) => snap.domain === row.score.domain && snap.confidence !== "已移除")
        .map((snap) => ({ t: Date.parse(snap.computed_at), value: snap.value, low: snap.low, high: snap.high, n: snap.n }))
        .reverse(),
    }))
    .filter((row) => row.points.length > 0);
  const curl = `curl -X POST ${apiBase()}/v1/consult \\
  -H 'content-type: application/json' \\
  -d '{"person_id":"${id}","domain":"${lead?.domain ?? domains[0]?.score.domain ?? ""}","query":"${data.person.name}说明年……"}'`;

  // Profile rows: composites with a score first; larger samples first.
  const cstage = (row: ProfileRow) => (row.composite.value != null ? 1 : 0);
  const profile = [...(data.profile ?? [])].sort((a, b) => cstage(b) - cstage(a) || b.accuracy.n - a.accuracy.n);
  const top = profile[0];
  const pct = (w: number) => `${Math.round(w * 100)}%`;
  const fmtPart = (part: { value: number | null; low: number | null; high: number | null }) =>
    part.value != null ? `${part.value.toFixed(1)}（${part.low}–${part.high}）` : "样本不足";

  // 利益关系: the layered payload when the API has it, otherwise layer 1 from this payload.
  const interests = data.interests ?? { status: "not_collected" as const, relations: [] as Interest[] };
  const flow = await loadInterests(id, interests.relations);

  const stats = [
    { label: "公开主张", value: claims.length, show: null },
    { label: "已判定", value: claims.filter((claim) => JUDGED.has(claim.status)).length, show: "judged" },
    { label: "已过期待核对", value: count(claims, "overdue"), hint: "截止日已过，还没找到结果", show: "overdue" },
    { label: "未到期", value: count(claims, "upcoming"), show: "upcoming" },
    { label: "证据不足", value: count(claims, "unclear"), show: "unclear" },
  ];

  return (
    <div className="pt-6">
      {/* Identity + numbers at a glance */}
      <section className="flex flex-wrap items-center gap-x-8 gap-y-5 rounded-[18px] bg-card p-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Portrait person={data.person} riso className="w-[76px] shrink-0 !rounded-[12px]" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs text-mute">
              <Link href="/speakers" className="no-underline hover-fine:text-ink">
                人物
              </Link>
              <Icon name="chevron-right" size={11} />
              <span className="truncate">{data.person.name_en}</span>
            </p>
            <h1 className="mt-0.5 text-[28px] leading-tight font-[900] tracking-tight">{data.person.name}</h1>
            <p className="truncate text-sm text-mute">{data.person.title}</p>
          </div>
        </div>
        <dl className="grid grid-cols-5 gap-x-5 gap-y-1">
          {stats.map((stat) => {
            const href = `/p/${id}${stat.show ? `?show=${stat.show}` : ""}#claims`;
            return (
              <div key={stat.label} title={stat.hint ?? `看${stat.label}的主张`}>
                <dd className={cn("display-num text-[26px] leading-none font-[800]", stat.value === 0 && "text-mute/50")}>
                  <Link href={href} className="text-inherit no-underline hover-fine:text-blue">
                    {stat.value}
                  </Link>
                </dd>
                <dt className="mt-1 text-[11px] whitespace-nowrap text-mute">
                  <Link href={href} className="text-mute no-underline hover-fine:text-blue">
                    {stat.label}
                  </Link>
                </dt>
              </div>
            );
          })}
        </dl>
      </section>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-mute">
        <span>
          核对层级：
          <Link href={`/p/${id}?show=machine#claims`} className="text-mute hover-fine:text-blue">
            机器核对 {machine}
          </Link>
          {" · "}
          <Link href={`/p/${id}?show=manual#claims`} className="text-mute hover-fine:text-blue">
            人工复核 {claims.length - machine}
          </Link>
        </span>
        {lastChange ? <span>分数最近变化 {lastChange}</span> : null}
        {data.person.portrait_credit ? (
          <span>
            头像{" "}
            {data.person.portrait_source_url ? (
              <a href={data.person.portrait_source_url} target="_blank" rel="noreferrer" className="text-mute hover-fine:text-blue">
                {data.person.portrait_credit}
              </a>
            ) : (
              data.person.portrait_credit
            )}
          </span>
        ) : null}
      </p>

      {/* Profile: the composite per domain, always taken apart into its parts (SPEC 人物画像与综合分) */}
      <section className="mt-8">
        <h2 className="flex items-baseline justify-between text-[15px] font-bold">
          人物画像
          <span className="text-xs font-normal text-mute">
            综合分只在领域内合成，不跨领域平均 ·{" "}
            <Link href="/method" className="text-blue no-underline">
              怎么算
            </Link>
          </span>
        </h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_2fr]">
          <div className="rounded-[14px] bg-card p-5">
            <p className="text-xs text-mute">
              {top ? (
                <>
                  综合分 · 判定最多的领域：<b className="font-semibold text-ink">{top.domain}</b>
                </>
              ) : (
                "综合分"
              )}
            </p>
            {top?.composite.value != null ? (
              <p className="display-num mt-1 text-[56px] leading-none font-[800] text-blue">{top.composite.value.toFixed(1)}</p>
            ) : (
              <p className="mt-2 text-2xl font-bold text-mute">样本不足</p>
            )}
            <p className="mt-2 text-xs leading-5 text-mute">
              {top?.composite.low != null ? `80% 区间 ${top.composite.low}–${top.composite.high}，基于 ${top.accuracy.n} 条已判定。` : ""}
              {top && top.composite.used.length === 1 ? "目前只含兑现率：可信度还没有数据，不参与合成。" : null}
              {profile.length > 1 ? `综合分按领域分开算，不跨领域平均；其余 ${profile.length - 1} 个领域见下表。` : null}
              {!top || top.composite.used.length === 0 ? "有一条主张被判定后就会出分。" : null}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] bg-card p-4">
              <p className="flex items-center justify-between text-xs text-mute">
                兑现率<span>权重 {pct(top?.accuracy.weight ?? 0.7)}</span>
              </p>
              <p className="num mt-1.5 text-lg font-bold">{top ? fmtPart(top.accuracy) : "—"}</p>
              <p className="mt-1 text-[11px] leading-4 text-mute">带期限的预测和承诺，到期核对。{top ? `已判定 ${top.accuracy.n} 条。` : ""}</p>
            </div>
            <div className="rounded-[14px] border border-dashed border-line bg-card/60 p-4">
              <p className="flex items-center justify-between text-xs text-mute">
                可信度（一致性）<span>权重 {pct(top?.consistency.weight ?? 0.3)}</span>
              </p>
              <p className="mt-1.5 text-lg font-bold text-mute">尚未收集</p>
              <p className="mt-1 text-[11px] leading-4 text-mute">建议和立场的前后对照、言行对照。校准后才进综合分。</p>
            </div>
            <div className="rounded-[14px] border border-dashed border-line bg-card/60 p-4">
              <p className="flex items-center justify-between text-xs text-mute">
                利益关系<span>不进综合分</span>
              </p>
              {interests.status === "collected" ? (
                <>
                  <p className="num mt-1.5 text-sm font-bold">
                    关于自家公司 {fmtPart(interests.related)} <span className="font-normal text-mute">· {interests.related.n} 句已判定</span>
                  </p>
                  <p className="num text-sm font-bold">
                    其他话题 {fmtPart(interests.unrelated)} <span className="font-normal text-mute">· {interests.unrelated.n} 句已判定</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-mute">
                    {flow.orgs.length} 家机构的任职、持股、商业往来。谈的是说话当时任职或持股的机构，算「关于自家公司」。
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-lg font-bold text-mute">尚未收集</p>
                  <p className="mt-1 text-[11px] leading-4 text-mute">任职、持股、商业往来；会并排给出「利益相关 / 无关」主张的兑现率。</p>
                </>
              )}
            </div>
            {data.indicators ? (
              <div className="rounded-[14px] border border-dashed border-line bg-card/60 p-4">
                <p className="flex items-center justify-between text-xs text-mute">
                  改期与可检验度<span>不进综合分</span>
                </p>
                <p className="num mt-1.5 text-sm font-bold">
                  <Link href={`/p/${id}?show=rescheduled#claims`} className="text-ink no-underline hover-fine:text-blue">
                    改期 {data.indicators.rescheduling.rescheduled}/{data.indicators.rescheduling.commitments} 个承诺
                  </Link>
                  {data.indicators.rescheduling.pushes ? (
                    <span className="font-normal text-mute">
                      {" "}
                      · 推迟 {data.indicators.rescheduling.pushes} 次，平均 {data.indicators.rescheduling.avg_delay_months} 个月
                    </span>
                  ) : null}
                </p>
                <p className="num text-sm font-bold">
                  可判定 {data.indicators.testability.judged}/{data.indicators.testability.resolved}
                  <Link href={`/p/${id}?show=unclear#claims`} className="font-normal text-mute no-underline hover-fine:text-blue">
                    {" "}
                    · 作废 {data.indicators.testability.voided}（证据不足）
                  </Link>
                </p>
                <p className="mt-1 text-[11px] leading-4 text-mute">
                  同一件事后来再说时期限往后推，算一次改期。到期的话里查不到结果的作废，不计分。只统计已收录的主张。
                </p>
              </div>
            ) : null}
          </div>
        </div>
        {profile.length > 1 ? (
          <div className="mt-3 overflow-x-auto rounded-[14px] bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-mute">
                  <th className="py-2 pr-2 pl-4 font-medium">领域</th>
                  <th className="px-2 font-medium">综合分</th>
                  <th className="px-2 font-medium">兑现率 · {pct(profile[0].accuracy.weight)}</th>
                  <th className="px-2 font-medium">可信度 · {pct(profile[0].consistency.weight)}</th>
                  <th className="py-2 pr-4 pl-2 font-medium">合成说明</th>
                </tr>
              </thead>
              <tbody>
                {profile.map((row) => (
                  <tr key={row.domain} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2 pl-4 font-medium">{row.domain}</td>
                    <td className="px-2 py-1.5">
                      <ScoreBadge value={row.composite.value} n={row.accuracy.n} low={row.composite.low} high={row.composite.high} size="sm" />
                    </td>
                    <td className="num px-2 text-xs">
                      {fmtPart(row.accuracy)} <span className="text-mute">· {row.accuracy.n} 条</span>
                    </td>
                    <td className="px-2 text-xs text-mute">尚未收集</td>
                    <td className="py-2 pr-4 pl-2 text-[11px] text-mute">
                      {row.composite.used.length === 0 ? "还没有已判定的主张" : "只含兑现率"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* 利益版图: where this person's money and stakes sit (SPEC 利益关系的展示) */}
      {flow.orgs.length > 0 ? (
        <section className="mt-8">
          <h2 className="flex items-baseline justify-between text-[15px] font-bold">
            利益版图
            <Link href={`/p/${id}/interests`} className="inline-flex items-center gap-1 text-xs font-normal text-blue no-underline">
              查看全貌
              <Icon name="arrow-right" size={12} />
            </Link>
          </h2>
          <Link href={`/p/${id}/interests`} className="mt-3 block rounded-[14px] bg-card px-4 pt-4 pb-3 no-underline">
            <InterestFlow personName={data.person.name} orgs={flow.orgs} claims={data.claims.map(({ id, status }) => ({ id, status }))} claimLinks={flow.claim_links} compact maxOrgs={4} maxSources={3} />
          </Link>
          <p className="mt-2 px-1 text-[11px] text-mute">
            {flow.orgs.length} 个机构 · {flow.orgs.reduce((sum, org) => sum + org.relations.length, 0)} 段关系
            {flow.layered ? ` · ${flow.orgs.reduce((sum, org) => sum + org.exposures.length, 0)} 项对外敞口` : ""}
            {interests.status === "collected"
              ? ` · 关于自家公司的话兑现率 ${fmtPart(interests.related)}，其他话题 ${fmtPart(interests.unrelated)}`
              : ""}
          </p>
        </section>
      ) : null}

      {/* Domain table */}
      <section className="mt-8">
        <h2 className="flex items-baseline justify-between text-[15px] font-bold">
          兑现记录
          <span className="text-xs font-normal text-mute">
            有判定就出分，区间越宽、条数越少越不确定 ·{" "}
            <Link href="/method" className="text-blue no-underline">
              怎么算
            </Link>
          </span>
        </h2>
        <div className="mt-3 overflow-x-auto rounded-[14px] bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] text-mute">
                <th className="py-2.5 pr-2 pl-4 font-medium">领域</th>
                <th className="px-2 font-medium">分数</th>
                <th className="px-2 font-medium">兑现构成</th>
                <th className="px-2 text-right font-medium">已过期待核对</th>
                <th className="px-2 text-right font-medium">未到期</th>
                <th className="py-2.5 pr-4 pl-2 font-medium">下一个截止</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((row) => {
                const judged = row.fulfilled + row.partial + row.missed;
                const active = domainFilter === row.score.domain;
                return (
                  <tr key={row.score.domain} className={cn("border-b border-line last:border-0", active && "bg-blue-tint/40")}>
                    <td className="py-2.5 pr-2 pl-4">
                      <Link
                        href={active ? `/p/${id}` : `/p/${id}?domain=${encodeURIComponent(row.score.domain)}#claims`}
                        className="font-medium no-underline hover-fine:text-blue"
                      >
                        {row.score.domain}
                      </Link>
                      <span className="ml-1.5 text-xs text-mute">{row.total} 条</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2">
                        <ScoreBadge value={row.score.value} n={row.score.n} low={row.score.low} high={row.score.high} size="sm" />
                        <span className="text-[11px] leading-4 text-mute">
                          {row.score.value != null
                            ? `区间 ${row.score.low}–${row.score.high} · ${row.score.n} 条 · 先验 ${(row.score.value / 100).toFixed(3)}`
                            : "还没有已判定"}
                        </span>
                      </span>
                    </td>
                    <td className="px-2">
                      {judged > 0 ? (
                        <span className="flex items-center gap-2">
                          <span className="flex h-2 w-24 overflow-hidden rounded-full bg-sunken" aria-hidden>
                            <span className="bg-blue" style={{ width: `${(100 * row.fulfilled) / judged}%` }} />
                            <span className="bg-blue/45" style={{ width: `${(100 * row.partial) / judged}%` }} />
                            <span className="bg-ink/25" style={{ width: `${(100 * row.missed) / judged}%` }} />
                          </span>
                          <span className="num text-[11px] whitespace-nowrap text-mute">
                            {(
                              [
                                ["fulfilled", "兑现", row.fulfilled, ""],
                                ["partial", "部分", row.partial, ""],
                                ["missed", "未", row.missed, ""],
                                ["unclear", "作废", row.voided, "期限已过但查不到能判定结果的资料：作废，不计分"],
                                ["rescheduled", "改期串", row.threads, "同一承诺反复改期再说，连成一串，整串 k 条合计按 √k 条计分"],
                              ] as const
                            )
                              .filter(([key, , n]) => n > 0 || ["fulfilled", "partial", "missed"].includes(key))
                              .map(([key, label, n, hint], i) => (
                                <span key={key}>
                                  {i ? " · " : ""}
                                  <Link
                                    href={listHref({ domain: row.score.domain, show: key })}
                                    title={hint || `看这个领域里${label}的主张`}
                                    className="text-mute no-underline hover-fine:text-blue"
                                  >
                                    {label} {n}
                                  </Link>
                                </span>
                              ))}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-mute">—</span>
                      )}
                    </td>
                    <td className={cn("num px-2 text-right", row.overdue > 0 ? "text-ink" : "text-mute/50")}>{row.overdue}</td>
                    <td className={cn("num px-2 text-right", row.upcoming > 0 ? "text-ink" : "text-mute/50")}>{row.upcoming}</td>
                    <td className="num py-2.5 pr-4 pl-2 text-xs whitespace-nowrap text-mute">{row.next?.deadline ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Score history: one small chart per domain, then the raw snapshots as a table */}
      <section className="mt-8">
        <h2 className="flex items-baseline justify-between text-[15px] font-bold">
          分数变化
          <span className="text-xs font-normal text-mute">深色线是分数，两条浅色线是 80% 区间上下沿；每次变化追加快照，不覆盖</span>
        </h2>
        <div className="mt-3">
          <ScoreHistoryCharts domains={charts} now={Date.now()} />
        </div>
        <h3 className="mt-5 flex items-baseline justify-between text-[13px] font-bold">
          变化原因
          <span className="text-xs font-normal text-mute">每次分数变化是哪几条主张引起的，新的在上</span>
        </h3>
        <ul className="mt-2 rounded-[14px] bg-card px-4 py-1 text-sm">
          {changes.slice(0, 30).map((change) => {
            const after = change.after;
            const delta = change.before?.value != null && after.value != null ? after.value - change.before.value : null;
            return (
              <li key={`${change.domain}-${change.at}`} className="grid gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-0 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="font-medium">{change.domain}</p>
                  <ul className="mt-0.5 space-y-0.5 text-xs text-mute">
                    {change.lines.length === 0 ? <li>旧判定随时间降低权重，分数略有变化</li> : null}
                    {change.lines.slice(0, 4).map((line, index) => (
                      <li key={index} className="truncate">
                        {describe(line, id)}
                      </li>
                    ))}
                    {change.lines.length > 4 ? <li>另有 {change.lines.length - 4} 条变化</li> : null}
                  </ul>
                </div>
                <div className="flex shrink-0 items-start gap-3 text-xs text-mute sm:flex-col sm:items-end sm:gap-0.5">
                  <span className="num text-sm text-ink">
                    {after.value != null ? `${after.value.toFixed(1)}（${after.low}–${after.high}）` : "样本不足"}
                    {delta != null && Math.abs(delta) >= 0.05 ? (
                      <span className={cn("ml-1.5 text-xs", delta > 0 ? "text-blue" : "text-ink/60")}>
                        {delta > 0 ? "↑" : "↓"}
                        {Math.abs(delta).toFixed(1)}
                      </span>
                    ) : null}
                  </span>
                  <span className="num">
                    {after.n} 条 · {change.at.slice(5, 16).replace("T", " ")}
                  </span>
                </div>
              </li>
            );
          })}
          {changes.length === 0 ? <li className="py-2 text-xs text-mute">分数还没有变化过。</li> : null}
        </ul>
      </section>

      {/* Upcoming deadlines */}
      {upcoming.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[15px] font-bold">即将到期</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {upcoming.map((claim) => (
              <Link key={claim.id} href={`/p/${id}/${claim.id}`} className="rounded-[14px] bg-card p-4 no-underline hover-fine:ring-2 hover-fine:ring-blue/20">
                <span className="flex items-center justify-between text-xs text-mute">
                  <span>{claim.category}</span>
                  <span className="num font-semibold text-blue">{claim.deadline}</span>
                </span>
                <span className="mt-1.5 line-clamp-3 block text-sm leading-6">{claim.quote_zh}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Claims */}
      <section id="claims" className="mt-8 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h2 className="flex flex-wrap items-baseline gap-x-3 text-[15px] font-bold">
          全部主张
          <span className="text-xs font-normal text-mute">先列已到期的（最近的在上），再列未到期的</span>
          {domainFilter ? (
            <Link href={listHref({ domain: null })} className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep no-underline">
              {domainFilter}
              <Icon name="cancel" size={11} />
            </Link>
          ) : null}
          {monthFilter ? (
            <Link href={listHref({ month: null })} className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep no-underline">
              {monthFilter.slice(0, 4)} 年 {Number(monthFilter.slice(5))} 月说的
              <Icon name="cancel" size={11} />
            </Link>
          ) : null}
          {yearFilter ? (
            <Link href={listHref({ year: null })} className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep no-underline">
              {yearFilter} 年说的
              <Icon name="cancel" size={11} />
            </Link>
          ) : null}
          {showFilter ? (
            <Link href={listHref({ show: null })} className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep no-underline">
              {showFilter.label} · {shown.length} 条
              <Icon name="cancel" size={11} />
            </Link>
          ) : null}
        </h2>
        <div className="flex items-end gap-2" title="按说话月份：颜色越深，那个月收录的带期限说法越多；只统计已收录的话">
          <span className="text-[10px] leading-tight text-mute">按月份</span>
          <ActivityGrid claims={claims} href={(month) => listHref({ month, year: null, show: null })} active={monthFilter} />
        </div>
        </div>
        <ul className="mt-3 overflow-hidden rounded-[14px] bg-card">
          {shown.map((claim) => {
            const p = phase(claim, today);
            const chips = claimExposureChips(flow, claim.id);
            return (
              <li key={claim.id} className="border-b border-line last:border-0">
                <Link
                  href={`/p/${id}/${claim.id}`}
                  className="grid gap-x-4 gap-y-1 px-4 py-3 no-underline hover-fine:bg-sunken/60 md:grid-cols-[112px_1fr_150px]"
                >
                  <span className="flex flex-wrap items-start gap-1.5">
                    {p === "overdue" ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink/30 px-2 py-0.5 text-[12px] font-medium text-ink">
                        <Icon name="hourglass" size={12} />
                        待核对
                      </span>
                    ) : (
                      <StatusPill status={p === "upcoming" ? "未到期" : claim.status} />
                    )}
                    {claim.quote_kind === "reported" ? (
                      <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-mute">转述</span>
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-[15px] leading-6">{claim.quote_zh}</span>
                    {claim.interest_note ? <span className="mt-0.5 block text-xs text-mute">{claim.interest_note}</span> : null}
                    {chips.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {chips.map((chip) => (
                          <span key={chip.key} title={chip.reason} className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink/80">
                            {chip.label}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {JUDGED.has(claim.status) && claim.actual_result ? (
                      <span className="mt-0.5 line-clamp-1 block text-xs text-mute">
                        <span className="font-medium text-ink/70">结果：</span>
                        {claim.actual_result}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-row flex-wrap gap-x-3 text-[11px] text-mute md:flex-col md:items-end md:text-right">
                    <span className="num">{yearSpan(claim)}</span>
                    <span>{claim.category}</span>
                    <span className="truncate">
                      {host(claim.source_url)}
                      {claim.reviewed === false ? " · 机器核对" : " · 人工复核"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* For agents */}
      <section className="mt-8">
        <h2 className="text-[15px] font-bold">给 AI 调用</h2>
        <p className="mt-1 text-xs text-mute">采信{data.person.name}的一句新说法之前，先取这个人在该领域的先验。</p>
        <div className="relative mt-3">
          <pre className="overflow-x-auto rounded-[14px] bg-ink p-4 pr-20 text-[12px] leading-5 text-white/90">
            <code>{curl}</code>
          </pre>
          <CopyButton text={curl} className="absolute top-3 right-3" />
        </div>
        {lead ? (
          <p className="mt-2 text-xs text-mute">
            当前返回：{lead.domain} 先验 <b className="num text-ink">{((lead.value ?? 0) / 100).toFixed(3)}</b>，80% 区间 {lead.low}–{lead.high}，基于 {lead.n} 条。
          </p>
        ) : null}
      </section>
    </div>
  );
}
