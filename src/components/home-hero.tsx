"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/beui/motion/card";
import { SITE } from "@/lib/terms";

const SAMPLES = ["马斯克 2025 年底完全无人驾驶", "黄仁勋", "梁文锋"];

const CAPABILITIES = [
  {
    step: "01",
    title: "按需核查",
    body: "给一个名字，或贴一句待采信的话。库里有就直接给分，没有就现场去公开资料里找他带期限的预测、头像和利益关系，做完打开档案。",
  },
  {
    step: "02",
    title: "按领域的兑现率与利益关系",
    body: "兑现率按领域分开算，不打跨领域的人品总分。说话当天他在哪些机构任职、持股，会并排标在原话旁边。",
  },
  {
    step: "03",
    title: "给 Agent 直接调用",
    body: "你的 Agent 在推理或写报告前调一次 POST /v1/consult 或 MCP get_prior，拿到这个人在该领域的兑现率、80% 区间、改期记录和能点回的原话。",
  },
];

const STANDARDS = [
  ["原话逐字对上", "程序自己打开网页并留存哈希。原话和证据句必须逐字出现在存档正文里，模型复述的一律丢弃。"],
  ["按领域分开", "芯片可以是高分，时间表可以很低。不同领域不平均成一个数。"],
  ["小样本给宽区间", "用 Beta 后验和 80% 区间表达不确定性，时间权重每 3 年减半；同一承诺反复改期按 √k 折算。"],
  ["利益关系单列", "任职、持股、商业往来不进综合分，单独对照利益相关与无关时的兑现率。"],
];

export type HeroExample = { person: string; domain: string; value: number; low: number | null; high: number | null; n: number; role: string | null };

export function HomeHero({ total, scored, example }: { total: number; scored: number; example: HeroExample | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function submit(value: string) {
    const clean = value.trim();
    if (!clean) return;
    router.push(`/search?q=${encodeURIComponent(clean)}`);
  }

  return (
    <div className="pt-8 pb-16 sm:pt-12">
      <div className="mx-auto max-w-[780px] text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-white/80 px-3.5 py-1 text-xs font-medium text-blue backdrop-blur-md">
          先验 · {SITE.tagline}
        </p>
        <h1 className="mt-5 text-[36px] leading-[1.12] font-[900] tracking-tight text-ink sm:text-[52px]">
          在相信一句话之前，先查查说话的人以前准不准
        </h1>
        <p className="mx-auto mt-4 max-w-[40em] text-base leading-7 text-ink/75">
          人和模型每天都在读别人的预测和承诺，却很少知道说话的人过去兑现了多少。这里把公众人物带期限的话逐句对回原文，到期核对结果，按领域算出兑现率，并标出他说话时的利益关系。
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(query);
          }}
          className="mx-auto mt-7 flex max-w-[560px] items-center gap-2 rounded-2xl border border-white/90 bg-white/90 p-2 shadow-[0_22px_50px_-28px_rgba(31,42,138,0.45)] backdrop-blur-md"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入人名，或贴一句待采信的话…"
            aria-label="输入人名，或贴一句待采信的话"
            className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-mute focus:outline-none"
          />
          <button
            type="submit"
            className="h-11 shrink-0 cursor-pointer rounded-xl bg-blue px-5 text-sm font-medium text-white transition-colors hover:bg-blue-deep"
          >
            查一个人
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-mute">
          <span>试试：</span>
          {SAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => submit(sample)}
              className="cursor-pointer rounded-full border border-black/[0.07] bg-white/75 px-3 py-1 text-ink/80 transition-colors hover:border-blue/30 hover:text-blue"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 text-center">
        <p className="text-xs font-medium tracking-wide text-blue">核心功能</p>
        <h2 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">一句话进去，这个人过去的兑现记录出来</h2>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {CAPABILITIES.map((item) => (
          <Card
            key={item.step}
            size="compact"
            className="border-white/80 bg-white/85 text-center shadow-[0_18px_40px_-30px_rgba(31,42,138,0.45)] backdrop-blur-md"
          >
            <CardHeader className="justify-items-center">
              <CardDescription className="display-num text-xs font-semibold text-blue">{item.step}</CardDescription>
              <CardTitle className="text-[17px]">{item.title}</CardTitle>
              <CardDescription className="pt-1 text-sm leading-6">{item.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="mt-12 text-center">
        <p className="text-xs font-medium tracking-wide text-blue">采用的标准</p>
        <h2 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">不靠模型印象打分，每一条都能点回原文</h2>
        <p className="mt-2 text-xs text-mute">
          <Link href="/method" prefetch={false} className="font-medium text-blue no-underline">
            完整方法与公式 →
          </Link>
        </p>
      </div>
      <div className="mt-6 grid gap-6 rounded-3xl border border-white/85 bg-white/85 p-6 shadow-[0_20px_48px_-32px_rgba(31,42,138,0.45)] backdrop-blur-md sm:p-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <dl className="grid gap-4 sm:grid-cols-2">
          {STANDARDS.map(([title, body]) => (
            <div key={title} className="rounded-2xl bg-paper/75 p-4">
              <dt className="text-sm font-semibold text-ink">{title}</dt>
              <dd className="mt-1 text-xs leading-5 text-mute">{body}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded-2xl bg-ink p-5 text-xs leading-6 text-white/85">
          <div className="flex items-center justify-between text-[11px] text-white/50">
            <span>Agent 决策调用 · POST /v1/consult</span>
            <span className="num">已收录 {total} 位人物 · {scored} 位有分数</span>
          </div>
          <pre className="mt-3 overflow-x-auto font-mono text-[12px] leading-6 text-white/90">
            {example
              ? `Input   "${example.person}说的一句关于${example.domain}的新说法"
Record  ${example.domain} · ${example.value.toFixed(1)}${example.low != null ? `（80% 区间 ${example.low}–${example.high}` : "（"} · ${example.n} 条已判定）${example.role ? `
Note    利益相关：说话时任 ${example.role}` : ""}
Action  按这个兑现率调低或调高采信程度，要求外部证据后再引用`
              : "还没有足够的已判定主张来展示示例。"}
          </pre>
          <p className="mt-2 text-[11px] text-white/45">以上是当前库里的真实数据，随核对结果更新。</p>
        </div>
      </div>
    </div>
  );
}
