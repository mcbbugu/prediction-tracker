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
        已兑现记 1，部分兑现记 0.5，未兑现记 0。「部分兑现」指结果明显少于承诺，但有和目标一致的实质成果；只看结果，不看努力。待定不进计算。近期的核对权重大一些：每条判定的权重从截止日起每 3 年减半，几年前说过又没兑现的话仍然算数。样本少的时候用一个温和的先验把分数拉向中间。把公式看成 Beta 后验，同时给出 80% 区间（第 10 到第 90 百分位）。只要同一领域有一条已判定的主张就出分，分数旁边总是写着 80% 区间和条数。条数越少，分数越被拉向 50、区间越宽：只有 1 条时大约是「56（25–85）」，这本身就是在说「还不确定」。一条都没有判定时才显示「样本不足」。
      </p>
      <p className="mt-3 text-mute">
        期限已过、但查不到能判定结果的可靠资料，记为「证据不足」：作废，不计分。作废的条数写在分数旁边，避免一个人靠把话说得含糊来躲开「未兑现」。
      </p>
      <p className="mt-3 text-mute">
        同一个承诺在不同时间反复重说、一再改期（例如连续几年都说「明年实现」），这些主张连成一串：每次重说仍各自判定，但整串 k 条合计只算 √k 条的分量（改期 10 次约等于 3.2 条）。反复失约仍然是证据，但不会让同一件事压过这个领域里的其他主张。
      </p>
      <p className="mt-8 text-2xl font-medium">S = 100 × (κS₀ + Σ wRE/√k) / (κ + Σ wR/√k)</p>
      <p className="mt-2 text-xs text-mute">E 是结果（1 / 0.5 / 0），w 是时间权重，R 是证据可靠度（有证据 1，没有 0.5），k 是这条所在改期串的已判定条数（不在串里为 1），κ = 4，S₀ = 0.5。公式版本 v1.3。</p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">综合分</h2>
      <p className="mt-3 text-mute">
        每个领域有一个综合分，由两项合成：兑现率（上面的公式，看带期限的预测和承诺有没有兑现）占 70%，可信度占 30%。可信度看的是建议和立场的一致性：同一话题前后有没有不加说明地翻转，劝别人做的自己有没有做。两项都按各自的 Beta 后验抽样相加，取均值和 80% 区间。
      </p>
      <p className="mt-3 text-mute">
        某一项还没有任何已判定的数据就不参与合成，页面会写明「目前只含兑现率」。综合分只在领域内合成，不同领域之间不平均。利益关系不进综合分，单独列出，并对比利益相关和无关主张各自的兑现率。
      </p>
      <p className="mt-4 text-xl font-medium">C = 0.7 × 兑现率 + 0.3 × 可信度</p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">机器判定什么时候能自动公开</h2>
      <p className="mt-3 text-mute">
        到期核对由模型提出判定。模型的判定要先过校准：按模型给出的四类结论分层抽样（少见的「部分兑现」「证据不足」多抽），由人在看不到模型结论的情况下自己判，再统计两者的一致程度。至少标 100 条，一致率的 95% 区间下界不低于 90%，κ（扣除碰巧一致之后的一致程度）不低于 0.8，并且每一类都标够，机器判定才自动公开、标「机器核对」。之后每天随机抽 5% 继续复核，最近 100 条复核的下界跌破 90% 就自动退回全部人审。
      </p>
      <ul className="mt-8 space-y-3 text-sm leading-7 text-mute">
        <li>只收有原话、有链接、有明确截止日的科技人物预测。</li>
        <li>政府与政治人物不收录。</li>
        <li>模型可以提案，发布由人完成。查不到就保持待定，不编造。</li>
        <li>综合分只在单个领域内成立，不是人品总分，也不是这个人以后说真话的概率。</li>
      </ul>
    </article>
  );
}
