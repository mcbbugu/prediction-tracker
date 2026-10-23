import Link from "next/link";
import type { ReactNode } from "react";
import { AnimatedNumber } from "@/components/beui/motion/animated-number";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";

// Everything on the home page between the hero and the people directory. Written for readers, not for us:
// each section answers one question a reader has. Numbers come from the live database; technical detail lives on /method.

export type TickerItem = { id: string; person_id: string; person: string; quote: string; status: string; said: string; deadline: string };
export type HomeStats = {
  people: number;
  scored: number;
  claims: number;
  judged: number;
  upcoming: number;
  overdue: number;
  voided: number;
  fulfilled: number;
  partial: number;
  missed: number;
  rescheduled: number;
  since: number | null;
};
export type Receipt = {
  person: string;
  person_id: string;
  claim_id: string;
  quote: string;
  kind: string | null;
  said: string;
  deadline: string;
  status: string;
  result: string;
  source_host: string;
  sha256: string | null;
  fetched_at: string | null;
  fetched_via: string | null;
  evidence_host: string | null;
  evidence_quote: string | null;
  resolver: string | null;
};
export type AgentExample = { person: string; person_id: string; domain: string; value: number; low: number | null; high: number | null; n: number };

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium tracking-[0.18em] text-blue", className)}>{children}</p>;
}

function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="mx-auto max-w-[760px] text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-[30px] leading-tight font-[800] tracking-tight text-ink sm:text-[40px]">{title}</h2>
      {lede ? <p className="mx-auto mt-4 max-w-[40em] text-[15px] leading-7 text-mute">{lede}</p> : null}
    </div>
  );
}

const glass = "border border-white/85 bg-white/85 shadow-[0_20px_48px_-32px_rgba(31,42,138,0.45)] backdrop-blur-md";

export function VerdictTicker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;
  const row = [...items, ...items];
  return (
    <div className="mt-2">
      <p className="mb-2 text-center text-xs text-mute">最近到期的话，和后来的结果</p>
      <div className="ticker relative -mx-5 overflow-hidden py-2" aria-label="最近到期的话和结果">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-paper to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-paper to-transparent" />
        <ul className="ticker-track flex w-max gap-3">
          {row.map((item, index) => (
            <li key={`${item.id}-${index}`} aria-hidden={index >= items.length}>
              <Link
                href={`/p/${item.person_id}/${item.id}`}
                prefetch={false}
                tabIndex={index >= items.length ? -1 : undefined}
                className={cn("flex w-[340px] flex-col gap-2 rounded-2xl p-4 no-underline transition-colors hover-fine:ring-2 hover-fine:ring-blue/20", glass)}
              >
                <span className="flex items-center justify-between gap-2 text-xs text-mute">
                  <span className="font-medium text-ink">{item.person}</span>
                  <StatusPill status={item.status} />
                </span>
                <span className="line-clamp-2 text-[13px] leading-5 text-ink/85">「{item.quote}」</span>
                <span className="num text-[11px] text-mute">
                  {item.said.slice(0, 7)} 说，说到 {item.deadline.slice(0, 7)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function StatsStrip({ stats }: { stats: HomeStats }) {
  const cells: [number, string, string][] = [
    [stats.people, "位公众人物", `${stats.scored} 位已经能看到分数`],
    [stats.claims, "句带期限的话", "每一句都能点回原文"],
    [stats.judged, "句已经到期，看过结果", `看不清结果的 ${stats.voided} 句不算分`],
    [stats.upcoming, "句还没到期", "到期那天自动去查"],
  ];
  return (
    <div>
      <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-line/70 lg:grid-cols-4", glass)}>
        {cells.map(([value, label, note]) => (
          <div key={label} className="bg-white/90 p-5 sm:p-6">
            <p className="display-num text-[34px] leading-none font-[800] text-ink sm:text-[44px]">
              <AnimatedNumber value={value} startOnView />
            </p>
            <p className="mt-2 text-sm font-medium text-ink">{label}</p>
            <p className="mt-1 text-xs leading-5 text-mute">{note}</p>
          </div>
        ))}
      </div>
      {stats.since ? <p className="mt-3 text-center text-[11px] text-mute">最早的一句说于 {stats.since} 年 · 数字每天更新</p> : null}
    </div>
  );
}

const MOMENTS: [string, string, string][] = [
  [
    "刷到一条大新闻",
    "「某 CEO：明年实现完全自动驾驶」。听起来很确定，但他以前说过几次同样的话？",
    "查一下他过去这类话兑现了多少，以及通常会晚多久。",
  ],
  [
    "准备做一个决定",
    "投资、跳槽、买一个还没发布的产品，都在押某个人对未来的判断。",
    "看他在这个领域的记录，也看他说这话时，自己有没有利益在里面。",
  ],
  [
    "让 AI 帮你分析",
    "AI 读新闻时，把所有人的话当成同样可靠的事实。",
    "接入以后，AI 在引用一句话之前，会先查说话的人。",
  ],
];

export function MomentsSection() {
  return (
    <section className="pt-24">
      <SectionHead eyebrow="什么时候用得上" title={<>当你准备<span className="text-blue">相信一句话</span>的时候</>} />
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {MOMENTS.map(([title, situation, answer], index) => (
          <div key={title} className={cn("flex flex-col rounded-3xl p-6", glass)}>
            <p className="display-num text-xs font-semibold text-blue">0{index + 1}</p>
            <h3 className="mt-2 text-[19px] font-bold text-ink">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-mute">{situation}</p>
            <p className="mt-auto border-t border-line pt-4 text-sm leading-6 text-ink">
              <span className="mr-1.5 text-blue">→</span>
              {answer}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// A statechart of one sentence's life. Every state shows how many sentences in the library are in it right now.
function StateNode({ title, count, note, tone = "plain", className }: { title: string; count?: number; note: string; tone?: "plain" | "blue" | "ink" | "dashed"; className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl p-4",
        tone === "blue" && "bg-blue text-white shadow-[0_14px_30px_-14px_rgba(47,63,196,0.9)]",
        tone === "ink" && "bg-ink text-white",
        tone === "plain" && glass,
        tone === "dashed" && "border border-dashed border-ink/25 bg-white/60",
        className,
      )}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-bold">{title}</span>
        {count != null ? <span className={cn("display-num text-[22px] font-[800]", tone === "plain" || tone === "dashed" ? "text-ink" : "text-white")}>{count}</span> : null}
      </p>
      <p className={cn("mt-1 text-xs leading-5", tone === "plain" || tone === "dashed" ? "text-mute" : "text-white/75")}>{note}</p>
    </div>
  );
}

function Arrow({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center text-blue/70", className)} aria-hidden>
      <span className="hidden h-px w-full bg-gradient-to-r from-blue/20 to-blue/60 lg:block" />
      <span className="text-lg lg:-ml-1">
        <span className="lg:hidden">↓</span>
        <span className="hidden lg:inline">›</span>
      </span>
      {label ? <span className="ml-2 text-[11px] whitespace-nowrap text-mute lg:hidden">{label}</span> : null}
    </div>
  );
}

export function LifeSection({ stats }: { stats: HomeStats }) {
  return (
    <section className="relative pt-24">
      <div className="ledger-grid pointer-events-none absolute inset-0 -z-10" />
      <SectionHead
        eyebrow="一句话的一生"
        title={<>从说出口，到<span className="text-blue">被时间核对</span></>}
        lede="每一句收进来的话都会走完这条路。图上的数字是库里此刻处在每一步的句数。"
      />
      <div className="mt-12 grid items-center gap-3 lg:grid-cols-[1fr_40px_1fr_40px_1fr_40px_1.2fr]">
        <StateNode title="说出口" note="采访、发布会、财报会、社交媒体上，一句带期限的话。" tone="dashed" />
        <Arrow />
        <StateNode title="记下原话" count={stats.claims} note="原文一字不差地保存下来。网页以后删了、改了，也还能查到。" />
        <Arrow />
        <div className="space-y-3">
          <StateNode title="等待到期" count={stats.upcoming} note="期限没到，先不下结论。" />
          <div className="rounded-2xl border border-dashed border-blue/30 bg-blue-tint/40 px-4 py-3 text-xs leading-5 text-ink/80">
            <span className="font-semibold text-blue">↺ 改口</span>：后来又说「再等一年」，算一次推迟，和原来那句串在一起记。库里有 {stats.rescheduled} 串这样的话。
          </div>
        </div>
        <Arrow />
        <div className="grid grid-cols-2 gap-3">
          <StateNode title="兑现了" count={stats.fulfilled} note="结果和他说的一致。" tone="blue" />
          <StateNode title="部分兑现" count={stats.partial} note="做到了一部分。" />
          <StateNode title="没兑现" count={stats.missed} note="到期没有做到。" tone="ink" />
          <StateNode title="看不清" count={stats.voided} note="查不到确切结果，不算分。" tone="dashed" />
        </div>
      </div>
      <p className="mt-6 text-center text-xs text-mute">
        到期的话会自动去找结果；还有 {stats.overdue} 句刚过期、正在查。
        <Link href="/method" prefetch={false} className="ml-1 font-medium text-blue no-underline">
          怎么判的 →
        </Link>
      </p>
    </section>
  );
}

export function ReceiptSection({ receipt }: { receipt: Receipt | null }) {
  if (!receipt) return null;
  const rows: [string, ReactNode][] = [
    ["谁说的", receipt.person],
    ["什么时候说", receipt.said],
    ["说到什么时候", receipt.deadline],
    ["这是", receipt.kind === "promise" ? "承诺：结果在他自己手里" : receipt.kind === "forecast" ? "预测：结果不在他手里" : "一句带期限的话"],
    [
      "原文在哪",
      <span key="src" title={receipt.sha256 ? `存档指纹 sha256:${receipt.sha256}` : undefined}>
        {receipt.source_host}
        {receipt.sha256 ? " · 已存档，网页删了也能查" : ""}
      </span>,
    ],
  ];
  return (
    <section className="pt-24">
      <SectionHead
        eyebrow="每个分数背后"
        title={<>不是「我们认为」，<span className="text-blue">而是「原文在这里」</span></>}
        lede="下面是库里的一条真实记录。页面上的每一个分数，都是由这样一条条记录累加出来的。"
      />
      <div className="mx-auto mt-10 grid max-w-[1000px] gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-white sm:p-8">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-blue/40 blur-3xl" />
          <p className="relative flex items-center justify-between text-[11px] text-white/50">
            <span>他说的</span>
            <span className="rounded-full border border-white/20 px-2 py-0.5">{receipt.status}</span>
          </p>
          <p className="relative mt-4 text-[20px] leading-9 font-medium">「{receipt.quote}」</p>
          <dl className="relative mt-6 grid gap-y-2 border-t border-dashed border-white/20 pt-5 text-[13px]">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[96px_1fr] gap-3">
                <dt className="text-white/45">{label}</dt>
                <dd className="text-white/90">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={cn("flex flex-col rounded-3xl p-6 sm:p-8", glass)}>
          <p className="text-xs font-medium text-blue">后来怎样</p>
          <p className="mt-3 text-[15px] leading-7 text-ink">{receipt.result}</p>
          {receipt.evidence_quote ? (
            <blockquote className="mt-5 border-l-2 border-blue/40 pl-4 text-[13px] leading-6 text-mute">
              {receipt.evidence_quote.length > 200 ? `${receipt.evidence_quote.slice(0, 200)}…` : receipt.evidence_quote}
              {receipt.evidence_host ? <span className="mt-1 block text-[11px] text-mute/80">— 出自 {receipt.evidence_host}</span> : null}
            </blockquote>
          ) : null}
          <p className="mt-5 text-[11px] leading-5 text-mute">结果由 AI 对照原文判断，目前还没有经过人工校准。</p>
          <Link href={`/p/${receipt.person_id}/${receipt.claim_id}`} prefetch={false} className="mt-auto pt-5 text-sm font-medium text-blue no-underline">
            看完整记录 →
          </Link>
        </div>
      </div>
    </section>
  );
}

const PROMISES: [string, string][] = [
  ["每一句都能点回原文", "你不需要相信我们，点开就能看到他当时的原话和后来的结果。"],
  ["不确定就直说", "记录少的人，分数会标出范围有多宽；看不清结果的话不算分。"],
  ["只看话准不准，不评价人", "一个人可以在芯片上很准，在时间表上很不准。我们分领域算，不打人品分，也不收政治人物。"],
  ["标准当天定好，事后不改", "一句话怎样算兑现，收进来那天就写好，结果出来以后不会再挑对谁有利的说法。"],
];

export function PromisesSection() {
  return (
    <section className="pt-24">
      <SectionHead eyebrow="我们的承诺" title={<>给别人记账的人，<span className="text-blue">自己必须最透明</span></>} />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {PROMISES.map(([title, body]) => (
          <div key={title} className={cn("rounded-3xl p-6", glass)}>
            <h3 className="text-[17px] font-bold text-ink">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-mute">{body}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-xs">
        <Link href="/method" prefetch={false} className="font-medium text-blue no-underline">
          怎么算的、还有哪些不足 →
        </Link>
      </p>
    </section>
  );
}

export function AgentSection({ example }: { example: AgentExample | null }) {
  const response = example
    ? `{
  "person": "${example.person}",
  "domain": "${example.domain}",
  "score": ${example.value.toFixed(1)},
  "interval_80": [${example.low ?? "null"}, ${example.high ?? "null"}],
  "judged": ${example.n},
  "claims": [ …每条都带原话和原文链接… ]
}`
    : "{ … }";
  return (
    <section className="pt-24">
      <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <Eyebrow>也可以交给 AI</Eyebrow>
          <h2 className="mt-3 text-[30px] leading-tight font-[800] tracking-tight text-ink sm:text-[40px]">
            让你的 AI 在引用一句话之前，
            <span className="text-blue">先查说话的人</span>
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-mute">
            把它接进你常用的 AI 助手。以后 AI 读到「某某说明年会怎样」，会先看这个人以前准不准、说这话时有没有利益在里面，再决定该信几分，并把依据一起给你。
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink">
            <li className="flex gap-2">
              <span className="text-blue">●</span>贴一句话，自动认出说话的人和领域
            </li>
            <li className="flex gap-2">
              <span className="text-blue">●</span>找出他以前说过的同一件事，以及结果
            </li>
            <li className="flex gap-2">
              <span className="text-blue">●</span>可以回到过去某一天，只看那天之前知道的信息
            </li>
          </ul>
        </div>
        <div className="overflow-hidden rounded-3xl bg-ink text-white shadow-[0_30px_70px_-35px_rgba(31,42,138,0.8)]">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-5 py-3">
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="ml-3 text-[11px] text-white/45">给开发者 · 一次真实的查询结果</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-6 text-white/90">{response}</pre>
          <p className="border-t border-white/10 px-5 py-3 text-[11px] text-white/45">
            支持 HTTP 接口和 MCP。
            {example ? (
              <Link href={`/p/${example.person_id}#agents`} prefetch={false} className="ml-1 text-white/70 no-underline hover-fine:text-white">
                看接入方式 →
              </Link>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}

const ROADMAP: [string, string][] = [
  ["现在可以", "查任何公众人物过去说的话准不准；看他说话时在哪里任职、持有什么"],
  ["即将上线", "他的承诺通常会晚多久兑现；他的立场前后是否一致、说的和做的是否一致"],
  ["之后", "任何人都能自己证明，某句话是哪天被记下的，之后没有被改过"],
  ["长期", "我们自己也做预测，接受和所有人一样的检验"],
];

export function VisionSection() {
  return (
    <section className="pt-24">
      <div className="relative overflow-hidden rounded-[32px] bg-blue-deep p-8 text-white sm:p-12">
        <div className="absolute -bottom-32 -left-20 size-96 rounded-full bg-blue/60 blur-3xl" />
        <div className="absolute -top-24 right-0 size-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow className="text-white/60">我们想做成的事</Eyebrow>
            <h2 className="mt-3 text-[30px] leading-tight font-[800] tracking-tight sm:text-[40px]">让说过的话，都有账可查</h2>
            <p className="mt-4 text-[15px] leading-7 text-white/75">
              以后，视频和录音越来越容易伪造，越来越多的判断由 AI 替人做出。到那时，「他到底说过什么」「他以前准不准」会比今天更难回答，也更重要。我们想把这本账一直记下去，而且记得让任何人都能自己核对。
            </p>
          </div>
          <ol className="space-y-3">
            {ROADMAP.map(([stage, body]) => (
              <li key={body} className="rounded-2xl border border-white/15 bg-white/[0.06] p-4 backdrop-blur-sm">
                <p className={cn("text-[11px]", stage === "现在可以" ? "text-white" : "text-white/55")}>{stage}</p>
                <p className="mt-1 text-sm leading-6 text-white/90">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
