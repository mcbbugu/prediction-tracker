import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

export default function MethodPage() {
  return (
    <article className="mx-auto max-w-[680px] pt-8">
      <p className="inline-flex items-center gap-1.5 text-sm text-mute">
        <Icon name="math" />
        方法
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">分数怎么来</h1>
      <p className="mt-4 text-mute">
        已兑现记 1，部分兑现记 0.5，未兑现记 0。待定和证据不足不进计算。近期的核对权重大，半衰期 180 天。样本少的时候用一个温和的先验把分数拉向中间。把公式看成 Beta 后验，同时给出 80% 区间（第 10 到第 90 百分位）。同一领域已判定不满 3 条显示「样本不足」；3 到 7 条只显示区间，例如「30–60（3 条）」；满 8 条才出现数字，并附上区间。
      </p>
      <p className="mt-8 text-2xl font-medium">S = 100 × (κS₀ + Σ wRE) / (κ + Σ wR)</p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">综合分</h2>
      <p className="mt-3 text-mute">
        每个领域有一个综合分，由两项合成：兑现率（上面的公式，看带期限的预测和承诺有没有兑现）占 70%，可信度占 30%。可信度看的是建议和立场的一致性：同一话题前后有没有不加说明地翻转，劝别人做的自己有没有做。两项都按各自的 Beta 后验抽样相加，取均值和 80% 区间。
      </p>
      <p className="mt-3 text-mute">
        某一项不满 3 条就不参与合成，页面会写明「目前只含兑现率」。每一项都满 8 条才出综合分数字，否则只给区间。综合分只在领域内合成，不同领域之间不平均。利益关系不进综合分，单独列出，并对比利益相关和无关主张各自的兑现率。
      </p>
      <p className="mt-4 text-xl font-medium">C = 0.7 × 兑现率 + 0.3 × 可信度</p>
      <ul className="mt-8 space-y-3 text-sm leading-7 text-mute">
        <li>只收有原话、有链接、有明确截止日的科技人物预测。</li>
        <li>政府与政治人物不收录。</li>
        <li>模型可以提案，发布由人完成。查不到就保持待定，不编造。</li>
        <li>综合分只在单个领域内成立，不是人品总分，也不是这个人以后说真话的概率。</li>
      </ul>
    </article>
  );
}
