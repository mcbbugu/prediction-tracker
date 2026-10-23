"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TextReveal } from "@/components/beui/motion/text-reveal";
import { SITE } from "@/lib/terms";

const SAMPLES = ["马斯克 2025 年底完全无人驾驶", "黄仁勋", "梁文锋"];

// First screen: the claim, the search box, and nothing else competing for attention.
export function HomeHero() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function submit(value: string) {
    const clean = value.trim();
    if (!clean) return;
    router.push(`/search?q=${encodeURIComponent(clean)}`);
  }

  return (
    <div className="relative pt-10 pb-10 sm:pt-16">
      <div className="mx-auto max-w-[880px] text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-white/80 px-3.5 py-1 text-xs font-medium text-blue backdrop-blur-md">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue/60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-blue" />
          </span>
          {SITE.name} · {SITE.tagline}
        </p>
        <h1 className="mt-6 text-[40px] leading-[1.08] font-[900] tracking-tight text-ink sm:text-[64px]">
          <TextReveal text="说过的话，" split="char" stagger={0.035} className="block" />
          <TextReveal text="时间会一句句核对。" split="char" stagger={0.035} delay={0.35} className="block text-blue" />
        </h1>
        <p className="mx-auto mt-6 max-w-[38em] text-[17px] leading-8 text-ink/75">
          公众人物每天都在许诺未来，几乎没人回头记账。我们把他们带期限的原话逐字存档，到期后对照结果，按领域算出兑现率，并标出说话那天他的钱在哪里。
          <span className="text-ink">在相信一句话之前，先看说话的人以前准不准。</span>
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(query);
          }}
          className="mx-auto mt-8 flex max-w-[600px] items-center gap-2 rounded-2xl border border-white/90 bg-white/90 p-2 shadow-[0_28px_60px_-30px_rgba(31,42,138,0.55)] ring-1 ring-blue/10 backdrop-blur-md"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入人名，或贴一句话…"
            aria-label="输入人名，或贴一句你正准备相信的话"
            className="h-12 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-mute focus:outline-none"
          />
          <button
            type="submit"
            className="h-12 shrink-0 cursor-pointer rounded-xl bg-blue px-6 text-sm font-medium text-white transition-colors hover:bg-blue-deep"
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
          <span className="hidden sm:inline">· 库里没有的人，会现场去公开资料里查</span>
        </div>
      </div>
    </div>
  );
}
