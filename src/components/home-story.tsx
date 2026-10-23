import Link from "next/link";
import type { ReactNode } from "react";
import { AnimatedNumber } from "@/components/beui/motion/animated-number";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";

// Everything on the home page between the hero and the people directory. All numbers come from the live database;
// nothing here is a mock. Roadmap items are labelled as such.

export type TickerItem = {
  id: string;
  person_id: string;
  person: string;
  quote: string;
  status: string;
  said: string;
  deadline: string;
};
export type HomeStats = {
  people: number;
  scored: number;
  claims: number;
  judged: number;
  upcoming: number;
  voided: number;
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
export type AgentExample = {
  person: string;
  person_id: string;
  domain: string;
  value: number;
  low: number | null;
  high: number | null;
  n: number;
};

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium tracking-[0.18em] text-blue uppercase">{children}</p>;
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
    <div className="ticker relative -mx-5 overflow-hidden py-2" aria-label="最近的核对结果">
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
                {item.said.slice(0, 7)} 说 → 期限 {item.deadline.slice(0, 7)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatsStrip({ stats }: { stats: HomeStats }) {
  const cells: [number, string, string][] = [
    [stats.people, "位公众人物", `其中 ${stats.scored} 位已有分数`],
    [stats.claims, "句带期限的原话", "每句都逐字对回存档原文"],
    [stats.judged, "句已到期核对", `另有 ${stats.voided} 句因证据不足作废、不计分`],
    [stats.upcoming, "句正在等待到期", "到期那天自动去找结果"],
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
      {stats.since ? <p className="mt-3 text-center text-[11px] text-mute">最早的一句说于 {stats.since} 年 · 数字随每天的核对实时变化</p> : null}
    </div>
  );
}

const PROBLEMS: [string, string, string][] = [
  [
    "说话没有成本",
    "同一个「明年就实现」可以每年重说一次。说错不扣分，说对被反复传颂，没人统计总账。",
    "我们记总账：每句带期限的话到期都核对，改期也串起来算。",
  ],
  [
    "所有人的话被当成同一种事实",
    "人和 AI 读新闻时，一个十年没兑现过承诺的人，和一个说到做到的人，分量一样。",
    "我们给每个人、每个领域一个有区间的兑现率，读的人可以据此加权。",
  ],
  [
    "利益藏在话的背后",
    "谈自家公司的前景，和谈与自己无关的事，可信度不一样，但读者通常看不到他的持股和营收来源。",
    "我们标出说话那天他在哪里任职、持有什么、公司的钱从哪来。",
  ],
];

export function WhySection() {
  return (
    <section className="pt-24">
      <SectionHead
        eyebrow="为什么需要它"
        title={
          <>
            预测满天飞，<span className="text-blue">却没有人记账</span>
          </>
        }
      />
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {PROBLEMS.map(([title, pain, answer], index) => (
          <div key={title} className={cn("flex flex-col rounded-3xl p-6", glass)}>
            <p className="display-num text-xs font-semibold text-blue">0{index + 1}</p>
            <h3 className="mt-2 text-[19px] font-bold text-ink">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-mute">{pain}</p>
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

const PIPELINE: [string, string, string][] = [
  ["发现", "从网页、财报新闻稿、RSS 等多个来源找他带期限的原话，联网搜索只用来补缺。", "每个来源的产出率单独统计"],
  ["存档", "程序自己打开原网页，原始字节压缩保存，记下 SHA-256 和抓取途径。网页以后改了、删了，证据还在。", "SHA-256 · 抓取途径 · 时间"],
  ["逐字核对", "原话必须一字不差地出现在存档正文里。模型复述、记者概括、对不上的，一律丢弃。", "丢弃的条目和理由全部公开"],
  ["写成可检验命题", "收录时就定好：谁、做到什么、什么时候、由什么数据判定。之后不能改，避免事后挑对自己有利的标准。", "主体 · 指标 · 期限 · 判定方式"],
  ["到期判定", "能用结构化数据判的（如 SEC 财报）由程序直接判；其余由模型只读存档证据判，再由第二个模型独立复判。", "确定性判定优先 · 双模型交叉"],
  ["计分与利益对照", "按领域、分「承诺」和「预测」算兑现率，样本少就给宽区间；并对照说话当天的任职、持股与营收敞口。", "Beta 后验 · 80% 区间 · 时间衰减"],
];

export function PipelineSection() {
  return (
    <section className="relative pt-24">
      <div className="ledger-grid pointer-events-none absolute inset-0 -z-10" />
      <SectionHead
        eyebrow="怎么做到的"
        title={
          <>
            从一句话到一个分数，<span className="text-blue">每一步都留痕</span>
          </>
        }
        lede="不靠模型的印象打分。六个步骤，每一步的输入和输出都存下来，任何人都能从分数一路点回原始网页。"
      />
      <ol className="relative mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PIPELINE.map(([title, body, proof], index) => (
          <li key={title} className={cn("group relative flex flex-col rounded-3xl p-6 transition-transform duration-300 hover-fine:-translate-y-1", glass)}>
            <span className="flex items-center gap-3">
              <span className="display-num flex size-9 items-center justify-center rounded-xl bg-blue text-sm font-bold text-white shadow-[0_8px_20px_-8px_rgba(47,63,196,0.8)]">
                {index + 1}
              </span>
              <span className="text-[18px] font-bold text-ink">{title}</span>
            </span>
            <p className="mt-4 text-sm leading-6 text-ink/75">{body}</p>
            <p className="mt-auto pt-5 font-mono text-[11px] tracking-tight text-blue">{proof}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ReceiptSection({ receipt }: { receipt: Receipt | null }) {
  if (!receipt) return null;
  const rows: [string, ReactNode][] = [
    ["人物", receipt.person],
    ["类型", receipt.kind === "promise" ? "承诺（结果在他控制之内）" : receipt.kind === "forecast" ? "预测（结果不在他控制之内）" : "主张"],
    ["说于", receipt.said],
    ["期限", receipt.deadline],
    [
      "出处",
      `${receipt.source_host}${receipt.fetched_via ? ` · ${receipt.fetched_via === "direct" ? "直接抓取" : receipt.fetched_via === "browser" ? "浏览器抓取" : receipt.fetched_via}` : ""}`,
    ],
    ["存档", receipt.sha256 ? `sha256:${receipt.sha256.slice(0, 16)}…${receipt.fetched_at ? ` · ${receipt.fetched_at}` : ""}` : "—"],
    ["判定方式", receipt.resolver === "model" || !receipt.resolver ? "模型只读存档证据判定 · AI 判定，尚未经人工校准" : "结构化数据，程序直接判定"],
  ];
  return (
    <section className="pt-24">
      <SectionHead
        eyebrow="一张真实的核对凭证"
        title={
          <>
            不是「我们认为」，
            <span className="text-blue">而是「原文在这里」</span>
          </>
        }
        lede="下面是库里的一条真实记录。页面上每一个分数，都由这样的凭证一条条累加出来。"
      />
      <div className="mx-auto mt-10 grid max-w-[1000px] gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-white sm:p-8">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-blue/40 blur-3xl" />
          <p className="relative flex items-center justify-between text-[11px] tracking-[0.18em] text-white/50 uppercase">
            <span>Claim · {receipt.claim_id}</span>
            <span className="rounded-full border border-white/20 px-2 py-0.5 tracking-normal normal-case">{receipt.status}</span>
          </p>
          <p className="relative mt-5 text-[20px] leading-9 font-medium">「{receipt.quote}」</p>
          <dl className="relative mt-6 grid gap-y-2 border-t border-dashed border-white/20 pt-5 font-mono text-[12px]">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[84px_1fr] gap-3">
                <dt className="text-white/45">{label}</dt>
                <dd className="break-all text-white/90">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={cn("flex flex-col rounded-3xl p-6 sm:p-8", glass)}>
          <p className="text-xs font-medium text-blue">到期后找到的结果</p>
          <p className="mt-3 text-[15px] leading-7 text-ink">{receipt.result}</p>
          {receipt.evidence_quote ? (
            <blockquote className="mt-5 border-l-2 border-blue/40 pl-4 text-[13px] leading-6 text-mute">
              {receipt.evidence_quote.length > 220 ? `${receipt.evidence_quote.slice(0, 220)}…` : receipt.evidence_quote}
              {receipt.evidence_host ? <span className="mt-1 block text-[11px] text-mute/80">— {receipt.evidence_host}，证据句同样逐字核对</span> : null}
            </blockquote>
          ) : null}
          <Link href={`/p/${receipt.person_id}/${receipt.claim_id}`} prefetch={false} className="mt-auto pt-6 text-sm font-medium text-blue no-underline">
            打开完整凭证：原文、存档、证据链 →
          </Link>
        </div>
      </div>
    </section>
  );
}

const PRINCIPLES: [string, string][] = [
  ["可以复核", "每个分数都能点回原话、存档网页和它的哈希。你不需要相信我们，只需要去看。"],
  ["承认不确定", "样本少就给宽区间，证据不足就作废不计分；判定由 AI 完成、尚未经人工校准，这件事写在每个分数旁边。"],
  ["只评价话，不评价人", "不打跨领域的人品总分，芯片可以很准、时间表可以很差。不收政治人物和选举预测。"],
  ["标准事先定好", "判定标准在收录那天就写死，结果出来以后不改。改了口的承诺串成一串，整串计分。"],
];

export function PrinciplesSection() {
  return (
    <section className="pt-24">
      <SectionHead
        eyebrow="为什么值得信"
        title={
          <>
            我们给别人打分，
            <span className="text-blue">所以自己必须最透明</span>
          </>
        }
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {PRINCIPLES.map(([title, body]) => (
          <div key={title} className={cn("rounded-3xl p-6", glass)}>
            <h3 className="text-[17px] font-bold text-ink">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-mute">{body}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-xs">
        <Link href="/method" prefetch={false} className="font-medium text-blue no-underline">
          完整方法、公式和局限 →
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
  "disclosure": "判定由 AI 完成，尚未经人工校准",
  "claims": [ …每条都带原话、出处和存档链接… ]
}`
    : "{ … }";
  return (
    <section className="pt-24">
      <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Eyebrow>给 AI 用</Eyebrow>
          <h2 className="mt-3 text-[30px] leading-tight font-[800] tracking-tight text-ink sm:text-[40px]">
            让你的 Agent 在引用一句话之前，
            <span className="text-blue">先查说话的人</span>
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-mute">
            一次接口调用，拿到这个人在该领域的兑现率、区间、改期记录、说话时的利益关系，以及每一条能点回原文的依据。也可以直接贴一句新说法，它会识别人物和领域，并找出他以前说过的同一件事。
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink">
            <li className="flex gap-2">
              <span className="text-blue">●</span>HTTP：
              <code className="font-mono text-[13px]">GET /v1/prior</code>、<code className="font-mono text-[13px]">POST /v1/consult</code>
            </li>
            <li className="flex gap-2">
              <span className="text-blue">●</span>MCP：工具 <code className="font-mono text-[13px]">get_prior</code>，加进 AI 客户端即可用
            </li>
            <li className="flex gap-2">
              <span className="text-blue">●</span>可以查过去某一天：
              <code className="font-mono text-[13px]">as_of</code> 只用那天之前已知的信息
            </li>
          </ul>
        </div>
        <div className="overflow-hidden rounded-3xl bg-ink text-white shadow-[0_30px_70px_-35px_rgba(31,42,138,0.8)]">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-5 py-3">
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="ml-3 font-mono text-[11px] text-white/45">实时返回 · 库里的真实数据</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-6 text-white/90">
            <span className="text-white/45">$ curl </span>
            {`"/v1/prior?person=${example?.person_id ?? "musk"}&domain=${example?.domain ?? ""}"`}
            {"\n\n"}
            {response}
          </pre>
        </div>
      </div>
    </section>
  );
}

const ROADMAP: [string, string, string][] = [
  ["已上线", "逐字存档与核对、按领域兑现率、承诺与预测分开、利益关系、给 AI 的接口", "现在"],
  ["即将上线", "延迟系数：他的承诺通常晚多久兑现；可信度：立场前后是否一致、言行是否一致", "接下来"],
  ["规划中", "只增不改的公开日志，每天公布根哈希，任何人都能证明某句话在哪天被收录、之后没被改过", "之后"],
  ["规划中", "网站自己也做预测，并按同样的标准公开受审", "长期"],
];

export function VisionSection() {
  return (
    <section className="pt-24">
      <div className="relative overflow-hidden rounded-[32px] bg-blue-deep p-8 text-white sm:p-12">
        <div className="absolute -bottom-32 -left-20 size-96 rounded-full bg-blue/60 blur-3xl" />
        <div className="absolute -top-24 right-0 size-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-white/60 uppercase">愿景</p>
            <h2 className="mt-3 text-[30px] leading-tight font-[800] tracking-tight sm:text-[40px]">公众言论的公证处</h2>
            <p className="mt-4 text-[15px] leading-7 text-white/75">
              合成音视频越来越逼真之后，「他到底说过什么」会成为需要证明的事；越来越多的判断由 AI 代人做出，AI
              需要知道每个信息源过去有多准。我们想成为这两件事的公共底层：记录可以被任何人验证，分数可以被任何人复算。
            </p>
          </div>
          <ol className="space-y-3">
            {ROADMAP.map(([stage, body, when]) => (
              <li key={body} className="rounded-2xl border border-white/15 bg-white/[0.06] p-4 backdrop-blur-sm">
                <p className="flex items-center justify-between text-[11px] text-white/55">
                  <span className={stage === "已上线" ? "text-white" : undefined}>{stage}</span>
                  <span>{when}</span>
                </p>
                <p className="mt-1 text-sm leading-6 text-white/90">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
