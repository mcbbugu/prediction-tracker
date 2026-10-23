import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Icon } from "@/components/icon";
import { getJson } from "@/lib/api";

export const dynamic = "force-dynamic";

type ResolutionStats = {
  propositions: { resolver: string; n: number }[];
  proposition_total: number;
  deterministic: number;
  model: number;
  verdicts: { resolved_by: string; n: number }[];
};

const RESOLVER_LABEL: Record<string, string> = {
  sec_xbrl: "确定性 · SEC 申报",
  price: "确定性 · 股价",
  model: "模型",
};

type PipelineRow = {
  pipeline: string;
  date: string;
  discovery_recall: number | null;
  extraction_precision: number | null;
  verdict_agreement: number | null;
  verdict_wilson_low: number | null;
  kappa: number | null;
  deterministic_share: number | null;
  searches_per_claim: number | null;
  seconds_per_claim: number | null;
};

function pipelineHistory() {
  try {
    return readFileSync(join(process.cwd(), "data/eval/history.jsonl"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PipelineRow);
  } catch {
    return [];
  }
}

const pct = (value: number | null) => (value == null ? "—" : `${Math.round(value * 1000) / 10}%`);

export const metadata = { title: "方法" };

export default async function MethodPage() {
  const stats = await getJson<ResolutionStats>("/v1/method/resolution").catch(() => null);
  const history = pipelineHistory();
  const latest = history.at(-1);
  return (
    <article className="mx-auto max-w-[680px] pt-8">
      <p className="inline-flex items-center gap-1.5 text-sm text-mute">
        <Icon name="math" />
        方法
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">分数怎么来</h1>
      <p className="mt-4 text-mute">
        已兑现记 1，部分兑现记 0.5，未兑现记 0。「部分兑现」指结果明显少于承诺，但有和目标一致的实质成果；只看结果，不看努力。待定不进计算。近期的核对权重大一些：每条判定的权重从截止日起每 3 年减半，几年前说过又没兑现的话仍然算数。样本少的时候，用一个中性的起点（50 分）把分数拉向中间。把公式看成 Beta 后验，同时给出 80% 区间（第 10 到第 90 百分位）。只要同一领域有一条已判定的主张就出分，分数旁边总是写着 80% 区间和条数。条数越少，分数越被拉向 50、区间越宽：只有 1 条时大约是「56（25–85）」，这本身就是在说「还不确定」。一条都没有判定时才显示「样本不足」。
      </p>
      <p className="mt-3 text-mute">
        期限已过、但查不到能判定结果的可靠资料，记为「证据不足」：作废，不计分。作废的条数写在分数旁边，避免一个人靠把话说得含糊来躲开「未兑现」。
      </p>
      <p className="mt-3 text-mute">
        同一个承诺在不同时间反复重说、一再改期（例如连续几年都说「明年实现」），这些主张连成一串：每次重说仍各自判定，但整串 k 条合计只算 √k 条的分量（改期 10 次约等于 3.2 条）。反复失约仍然是证据，但不会让同一件事压过这个领域里的其他主张。
      </p>
      <p className="mt-8 text-2xl font-medium">S = 100 × (κS₀ + Σ wRE/√k) / (κ + Σ wR/√k)</p>
      <p className="mt-2 text-xs text-mute">E 是结果（1 / 0.5 / 0），w 是时间权重，k 是这条所在改期串的已判定条数（不在串里为 1），κ = 4，S₀ = 0.5。没有留下证据的已判定主张作废，不计分。公式版本 v1.3。</p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">综合分</h2>
      <p className="mt-3 text-mute">
        每个领域有一个综合分，由两项合成：兑现率（上面的公式，看带期限的预测和承诺有没有兑现）占 70%，可信度占 30%。可信度看的是建议和立场的一致性：同一话题前后有没有不加说明地翻转，劝别人做的自己有没有做。两项都按各自的 Beta 后验抽样相加，取均值和 80% 区间。
      </p>
      <p className="mt-3 text-mute">
        某一项还没有任何已判定的数据就不参与合成，页面会写明「目前只含兑现率」。综合分只在领域内合成，不同领域之间不平均。利益关系不进综合分，单独列出，并对比利益相关和无关主张各自的兑现率。
      </p>
      <p className="mt-4 text-xl font-medium">C = 0.7 × 兑现率 + 0.3 × 可信度</p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">承诺和预测</h2>
      <p className="mt-3 text-mute">
        兑现率不再把两类话合成一个数。承诺是结果在本人、或他说话当天任职、控股的机构控制之内，例如「我们明年交付这款芯片」，计靠谱度。预测是结果不在他控制之内，例如「2030 年这个行业会怎样」，计判断力。主体对不上本人、也不是他当时的机构，就记成预测。已经离职的机构同样记成预测。没有主体、规则判不了的，交给模型写一句理由；模型也拿不准就标「类别存疑」，两边都不计分。
      </p>
      <p className="mt-3 text-mute">
        页面上的「合并兑现率」把两类合在一起算，综合分用的是它。靠谱度和判断力用的仍是同一套兑现率公式，只是分开算。样本不足的一侧写「样本不足」，不拿另一侧的数字顶上。
      </p>
      <p className="mt-3 text-mute">
        延迟只看承诺，不看预测。同一件事改过期的，从第一次说的那天算到最后那个期限，整串只留一条。已经兑现的，用兑现证据的日期减去说话日，再除以当初答应的天数，得到延迟比。还没兑现或判了未兑现的，在今天截断，叫删失，不能当成「正好在今天失败」。Kaplan–Meier 曲线用这些删失数据估计延迟比的中位数和 80% 区间。一个人在某个领域不到 8 条时，按条数向同领域所有人的分布靠拢，并写明「样本少，参考同领域」。区间上沿到不了（大部分同类承诺至今没兑现）时，不编一个兑现日期。
      </p>
      <p className="mt-3 text-mute">
        可信度和兑现率用同一套算法：一致记 1，不一致记 0，越近的对照权越重，每 3 年权重减半。一个领域公开对照少于 5 条就不出分，页面只列例子。够 5 条以后，综合分才按兑现率 70%、可信度 30% 合在一起。这些判定目前由 AI 完成，还没有人逐条看过。
      </p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">旁证：改期与可检验度</h2>
      <p className="mt-3 text-mute">
        画像里还并排给出两项不打分的旁证。改期：同一件事后来再说时，期限往后推了，算一次改期；页面写明多少个承诺被改期、一共推迟几次、平均推迟多久。可检验度：期限已过的话里，有多少能查到结果、做出判定，判不了的作废。两项都只统计已经收录的主张，收录得越全越准。
      </p>
      <h2 id="eval" className="mt-12 text-xl font-semibold tracking-tight">现在这个阶段</h2>
      <p className="mt-3 text-mute">
        判定由 AI 完成，尚未经人工校准。
        {latest?.verdict_agreement != null
          ? ` 相对人工种子，当前流水线判定一致率 ${pct(latest.verdict_agreement)}，Wilson 下界 ${pct(latest.verdict_wilson_low)}。`
          : " 准确率评测中。"}
        AI 判定照常计分，页面和接口都会标明这一点。「自动收录 · 两个模型判定一致」只说明两个模型读同一份已存档证据后结论相同，不是有人独立核实过事实。
      </p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">流水线版本</h2>
      {history.length === 0 ? (
        <p className="mt-3 text-mute">还没有跑过评测。</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm text-mute">
          <thead>
            <tr>
              <th className="py-1 font-medium">版本</th>
              <th className="py-1 font-medium">发现</th>
              <th className="py-1 font-medium">抽取</th>
              <th className="py-1 font-medium">判定</th>
              <th className="py-1 font-medium">确定性</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={`${row.date}-${row.pipeline}`}>
                <td className="py-1 pr-3">{row.date}</td>
                <td className="py-1">{pct(row.discovery_recall)}</td>
                <td className="py-1">{pct(row.extraction_precision)}</td>
                <td className="py-1">{pct(row.verdict_agreement)}</td>
                <td className="py-1">{pct(row.deterministic_share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-mute">{latest ? latest.pipeline : ""}
      </p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">哪些判定不经过模型</h2>
      <p className="mt-3 text-mute">
        收录时就把原话写成一条命题：主体、指标、比较符、阈值和截止日。营收对得上已导入的 SEC 年报、股价对得上存档的日线时，由程序直接算，同一份数据永远得出同一个结论。转不成这种命题的，仍交给模型读存档原文。
        {stats
          ? ` 目前 ${stats.proposition_total} 条命题里，确定性判定 ${stats.deterministic} 条，模型判定 ${stats.model} 条。`
          : ""}
      </p>
      {stats && stats.propositions.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-mute">
          {stats.propositions.map((row) => (
            <li key={row.resolver}>
              {RESOLVER_LABEL[row.resolver] ?? row.resolver} {row.n} 条
              {stats.proposition_total ? `（${Math.round((row.n / stats.proposition_total) * 1000) / 10}%）` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <h2 className="mt-12 text-xl font-semibold tracking-tight">机器判定什么时候能自动公开</h2>
      <p className="mt-3 text-mute">
        按需分析搜到的人物和主张会标「自动收录 · 未经人工复核」：原话经过逐字核对后直接公开，但还没有人逐条看过。两个模型后来对同一条判定全部一致时，标签改为「自动收录 · 两个模型判定一致」。只有人工裁定过，标签才会去掉。AI 判定不等于人工复核。
      </p>
      <p className="mt-3 text-mute">
        到期核对由模型提出判定。模型的判定要先过校准：按模型给出的四类结论分层抽样（少见的「部分兑现」「证据不足」多抽），由人在看不到模型结论的情况下自己判，再统计两者的一致程度。至少标 100 条，一致率的 95% 区间下界不低于 90%，κ（扣除碰巧一致之后的一致程度）不低于 0.8，并且每一类都标够，AI 判定才自动公开。之后每天随机抽 5% 继续复核，最近 100 条复核的下界跌破 90% 就自动退回全部人审。
      </p>
      <p className="mt-3 text-mute">
        例外是按需分析：你在网站上搜一个库里还没有的人时，agent 找到的主张、到期判定和利益关系，只要原话通过逐字核对，就直接公开并标「自动收录 · 未经人工复核」，不等校准门槛，好让你立刻看到结果。发现错误可以随时提交反证。
      </p>
      <h2 className="mt-12 text-xl font-semibold tracking-tight">记录有误怎么办</h2>
      <p className="mt-3 text-mute">
        每条主张的详情页都可以提交反证：给一个公开出处，并说明哪里不对。提交的链接会被存档，并加入证据再判定一次。结论变了就更新，并标「有争议」；没变就公开写「已复核，结论不变」。理由写进这条主张的变更记录。
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
