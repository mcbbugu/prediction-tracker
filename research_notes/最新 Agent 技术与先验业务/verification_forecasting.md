# LLM 自动核查 / 预测兑现判定 / 预测者打分：2025–2026.10 现状笔记

> 方法说明：本笔记基于 2026-10-22 的网络搜索。WebFetch 工具当次不可用（模型错误），所以数字都来自搜索引擎返回的摘要和摘录，**没有逐篇打开原文核对**。凡是只出现在第三方/厂商博客里的数字都已注明。2025 年以前的工作标为【背景】。

---

## 1. LLM 事实核查流水线与基准（拆分主张 → 检索证据 → 出判定）

### Takeaway
在真实世界的开放主张上，端到端自动核查依然很弱：2025 年 AVeriTeC 第二届（只允许开源权重模型、单 GPU、每条主张 ≤1 分钟）冠军分数只有 33.17%；长文本事实性评测的主流指标已从 SAFE 转向 VeriScore 一类，但"抽取哪些主张"这一步本身就有明显误差。所以对「先验」来说，靠"模型判定 + 原文逐字校验 + 人工复核"把关是对的，不能直接信任模型给出的端到端判定。

### Cited Findings
- **AVeriTeC 第二届共享任务（FEVER 2025 workshop，2025 年 7 月，维也纳）**：限制条件是开源权重、单张 23GB GPU、每条主张 ≤1 分钟，证据只能取自预先建好的知识库。共收到 7 份提交，其中 6 份在测试集上超过 baseline。冠军 CTU AIC 的 AVeriTeC score 为 **33.17%**。评测从 Hungarian METEOR 改为基于 LLM 的 **Ev2R recall** — [ACL Anthology 2025.fever-1.15](https://aclanthology.org/2025.fever-1.15/)；[PDF](https://aclanthology.org/2025.fever-1.15.pdf)
- 【背景】第一届 AVeriTeC（2024）收到 21 份提交，18 份超过 baseline，冠军 TUDA_MAI 得分约 63%。由于换了测试集和指标，两届分数不能直接比较 — [arXiv 2410.23850](https://arxiv.org/pdf/2410.23850)；[ACL 2024.fever-1.1](https://aclanthology.org/2024.fever-1.1.pdf)
- 2025 年参赛方案示例 HerO 2（HUMANE 团队）：用 Qwen3-8B 做摘要、生成问题和改写答案，用 Qwen3-32B-AWQ 判定真伪 — [arXiv 2507.11004](https://arxiv.org/pdf/2507.11004)
- 多模态后续任务 AVerImaTeC（图文主张，结果公布于 2025-12-09）：第一名 HUMANE 判定准确率 0.5455，ADA-AGGR 0.5369，AIC CTU 0.3466 — [fever.ai/task.html](https://fever.ai/task.html)
- 【背景】FActScore、SAFE、VeriScore 三者的区别：FActScore 对原子主张计算精确率；SAFE 用 GPT-4 加搜索逐条核验；VeriScore 只抽取"可核验"的主张，再用 Google 搜索核验。VeriScore 作者批评 SAFE 的改写和相关性检查又慢又贵，还会误删可核验的主张 — [VeriScore arXiv 2406.19276](https://arxiv.org/pdf/2406.19276)
- 2025–26 年的论文普遍把 VeriScore 当主要指标（Chen et al. 2025b 证明它优于此前方法）— [Learning to Reason for Factuality, arXiv 2508.05618](https://arxiv.org/pdf/2508.05618)
- **Claimify（ACL 2025）**：在"抽取可核验主张"任务上，准确率 87.9%、macro-F1 83.7%；DnD 准确率 76.9%；VeriScore 的 macro-F1 只有 62.5% — [ACL 2025.acl-long.348](https://aclanthology.org/2025.acl-long.348.pdf)
- VeriFastScore（2025-05）把拆分和核验合成一步来提速。VeriScore 慢的原因举例：一段 14 句的回答会抽出 23 条主张。用 few-shot 提示 GPT-4o 去近似 VeriScore，Pearson 相关只有 0.33 — [arXiv 2505.16973](https://arxiv.org/pdf/2505.16973)
- VeriFact（2025）：SAFE 的去语境化步骤能减少"不完整事实"，但会改变原意，导致"遗漏事实"增加 — [arXiv 2505.09701](https://arxiv.org/pdf/2505.09701)
- ElementCheck（2026-08）的成本表：SAFE 平均约 94 条主张、约 125 次调用，Overall 51.6；VeriScore 平均约 34 条主张、约 45 次调用，Overall 47.6 — [arXiv 2608.26118](https://arxiv.org/html/2608.26118)
- **Google DeepMind FACTS Grounding**（2024-12 / 2025-01）：考察模型回答是否忠于最长 32k token 的给定文档。由 Gemini 1.5 Pro、GPT-4o、Claude 3.5 Sonnet 三个裁判打分，先剔除没有回应请求的答案，防止用含糊回答刷分。上线时 gemini-2.0-flash-exp 以 83.6% 排第一 — [DeepMind 博客](https://deepmind.google/blog/facts-grounding-a-new-benchmark-for-evaluating-the-factuality-of-large-language-models/)；[arXiv 2501.03200](https://arxiv.org/pdf/2501.03200)
- **FACTS Leaderboard 套件（2025-12）**：FACTS Multimodal 准确率为 Gemini 2.5 Pro 46.9%、Gemini 3 Pro 46.1%、GPT-5 44.1%、GPT-5.1 41.8%、Claude 4.5 Opus 39.2%、Grok 4 25.7%。Gemini 系偏召回（Coverage 高），GPT 系偏精确（No-Contradiction 高）— [arXiv 2512.10791](https://arxiv.org/pdf/2512.10791)
- 第三方统计：FACTS Grounding 上 Gemini 2.5 Pro Preview 06-05 得 0.878，Gemini 3 Pro 得 0.705 — [llm-stats](https://llm-stats.com/benchmarks/facts-grounding)。Kaggle 官方榜单显示"Updated October 13, 2026"，但抓到的文本是乱的，无法可靠地把排名和分数对上（**未核实**）— [Kaggle FACTS Grounding](https://www.kaggle.com/benchmarks/google/facts-grounding)
- 事实核查机构的实际用法：Full Fact AI 被 40 多家核查机构使用，覆盖英语、阿拉伯语、法语，30 多个国家。"claim matching"每天做约 1000 万次句子比对，只产出几十条真正的匹配。2025-05 上线两阶段生成式 AI 来排"值得核查度"。官方强调工具不是用来取代核查员的 — [Full Fact 博客 2025-02](https://fullfact.org/blog/2025/feb/how-ai-can-help-fact-checkers/)；[Poynter 2025](https://www.poynter.org/fact-checking/2025/the-uks-fact-checkers-are-sending-their-ai-to-help-americans-cover-elections/)

### Inferences
- 「先验」判定的是"某个有日期的预测是否兑现"，比 AVeriTeC 的开放主张更窄：主张已经给定，截止日期已知，证据通常是公开数据或新闻。所以准确率预期会远高于 33%。但难点会转移到两处：一是"部分兑现"的边界，二是检索到的证据是否覆盖截止日期前后。
- 主张拆分有可能改变原意（VeriFact 的发现）。对一条承诺做拆分时，应该保留原句，并且对每个子主张同样做逐字溯源检查。

### Gaps
- 没能打开 AVeriTeC 2025 的全文，拿不到各队的标签准确率和 Ev2R 人工一致率。
- 没找到 2026 年 FEVER 或 CheckThat! 共享任务的结果；FactCheck-Bench 的 2025–26 年新数字也没找到。
- Kaggle FACTS 榜单的最新排名（2026-10）无法可靠读取。

---

## 2. 多模型交叉验证、辩论、自洽性和 verifier：什么时候第二个模型有用

### Takeaway
单模型多次采样的不一致确实是错误信号，但"自洽的错误"（每次都错成同一个答案）不会随模型变大而减少。不同模型犯的自洽错误往往不一样，所以**跨模型分歧**是比自洽性更好的送人工信号。至于辩论能否超过简单的投票或集成，证据并不一致。

### Cited Findings
- **Too Consistent to Detect（EMNLP 2025）**：不一致的错误随模型规模增大明显减少，自洽错误的频率却保持不变甚至上升。不同 LLM 的自洽错误常常不同，因此论文提出跨模型探针，融合外部 verifier 的隐状态 — [ACL 2025.emnlp-main.238](https://aclanthology.org/2025.emnlp-main.238/)
- Complementing Self-Consistency with Cross-Model Disagreement（2026）：模型过度自信时，自洽性这个代理指标会失效；加入跨模型分歧可以改善 AUROC 和选择性预测，实验用 GPT-4o 和 Claude 3.7 Sonnet 在 SimpleQA 上做 — [arXiv 2604.17112](https://arxiv.org/pdf/2604.17112)
- 【背景】AFaCTA：GPT-4 在多条推理路径一致的样本上准确率 98.49，在不一致的样本上只有 74.64。这为"有分歧就送人工"提供了直接依据 — [arXiv 2402.11073](https://arxiv.org/pdf/2402.11073)
- **FutureSearch 自动判定预测题（2026 初）**：让 3 个 Gemini 3 Pro 智能体（其中一个用不同提示词）联网判定，三者不一致时调用 Opus 4.5 作为仲裁。1,499 题中有 131 题（约 8.7%）不一致。人工抽查 100 题，错了 4 题，错误率 4.9%（95% CI 1.6%–9.8%），即准确率约 95% — [arXiv 2601.22444](https://arxiv.org/abs/2601.22444)；[FutureSearch](https://futuresearch.ai/automating-forecasting-questions/)
- DebateCV（2025-07，被 WWW 2026 接收）：两个辩手加一个主持人做主张核验。零样本的主持人倾向于给中性判定，因此作者提出 Debate-SFT。第三方评论指出，摘要里没有给出数字 — [arXiv 2507.19090](https://arxiv.org/abs/2507.19090)；[Pith 评论](https://pith.science/paper/2507.19090)
- MAD-Fact（2025-10）：用多智能体辩论做长文本事实性评测，在中文数据集上做实验 — [arXiv 2510.22967](https://arxiv.org/abs/2510.22967)
- Tool-MAD（2026）：在辩论中加入工具和自适应检索来做事实核验 — [arXiv 2601.04742](https://arxiv.org/pdf/2601.04742)
- 怀疑的证据：在逻辑题上做的对照实验显示，辩论成败主要取决于底层模型的强弱，作者质疑辩论能否胜过简单的集成或多数投票 — [arXiv 2511.07784](https://arxiv.org/pdf/2511.07784)
- Multi-Agent Verification：用多个 verifier 扩展测试时计算量 — [arXiv 2502.20379](https://arxiv.org/pdf/2502.20379)

### Inferences
- 「先验」可以直接借用 FutureSearch 的模式：用 2–3 个不同厂商的模型独立判定；全部一致才进入自动通道，有分歧就送人工（参考值：约 9% 的题会分歧）；最后人工抽查 100 条，计算错误率的置信区间。
- 第二个模型必须来自**不同的模型家族**。同家族重复采样抓不到自洽错误。

### Gaps
- 没有找到专门针对"预测/承诺兑现判定"的多模型对比实验数据。DebateCV 和 MAD-Fact 的具体提升幅度，在摘要里也拿不到。

---

## 3. LLM-as-judge 的可靠性、偏差、校准，以及需要多少人工标注

### Takeaway
判断一个裁判模型是否可靠，要看经机会校正的一致性（Cohen's κ），不能只看原始一致率：原始一致率会把裁判的区分能力高估 33–41 个百分点。业界常用的门槛是 κ ≥ 0.6 可用、κ ≥ 0.8 强；校准集一般 100–300 条，长期金标集 200–500 条。少量人工标注可以用 PPI（prediction-powered inference）放大成带置信区间的估计。

### Cited Findings
- **Reliability without Validity（UC Berkeley，2026-06-17）**：评测 21 个裁判模型、118 次运行、约 54.1 万次判断。原始一致率比经机会校正的区分能力高估 **33–41 个百分点**，21 个模型无一例外。同一模型在不同基准上的排名最多变动 14 位。有两个已在生产中部署的裁判，重测信度 > 0.95，同时位置偏差 > 0.10，也就是"稳定地偏"。冗长偏差很小（< 0.011）— [arXiv 2606.19544](https://arxiv.org/abs/2606.19544)
- 业界做法（厂商博客，未经同行评审）：抽 100–300 条，由 2–3 名标注员标注，计算裁判与多数人标签之间的 κ；κ > 0.6 可上线，> 0.8 为强；长期金标集每个规则 200–500 条；高流量场景常用"LLM 裁判 + 5–10% 人工抽检"；每月复查，κ 跌破门槛就报警 — [FutureAGI 2026](https://futureagi.com/blog/llm-as-judge-best-practices-2026/)；[FutureAGI 人工 vs LLM 标注](https://futureagi.com/blog/human-vs-llm-annotation-2025/)
- 论文中的实际数字：SciIntBench 人工审核 144 条，人与人 κ = 0.764，人与裁判一致率 84.1–87.0%（κ 0.751–0.805）— [arXiv 2605.29468](https://arxiv.org/pdf/2605.29468)。另一篇论文用 Llama 3.3 70B 作裁判，对 320 条人工标签 κ = 0.67，而人与人只有 0.58 — [arXiv 2609.07662](https://arxiv.org/pdf/2609.07662)
- 立场与投票一致性的裁判（最接近「先验」里的言行一致性判定）：GPT 裁判与单个标注员的匹配率只有 0.728 ± 0.041。原因是隐含立场、部分证据、程序性语境都需要解读 — [arXiv 2511.17813](https://arxiv.org/pdf/2511.17813)
- One Token to Fool LLM-as-a-Judge（2025）：单个 token 之类的表面输入就能骗过裁判；Master-RM-7B 在 500 条样本上与人工的 κ 为 0.90 — [arXiv 2507.08794](https://arxiv.org/pdf/2507.08794)
- **PPI 方法族**：用少量人工标签纠正大量 LLM 标签的偏差，给出有效的置信区间。【背景】Angelopoulos et al., Science 2023；PPI++。2024–2026 的扩展包括：StratPPI（NeurIPS 2024，分层后区间明显变窄）、Bayesian PPI、NAACL 2025 Confidence-Driven Inference（按 LLM 置信度挑选要人工标的样本）、PRECISE（30 条人工标签 + Claude 判断，标准误从 4.45 降到 3.50，相对降低 21%）— [StratPPI](https://proceedings.neurips.cc/paper_files/paper/2024/file/c9fcd02e6445c7dfbad6986abee53d0d-Paper-Conference.pdf)；[Bayesian PPI](https://arxiv.org/pdf/2405.06034)；[NAACL 2025.naacl-long.179](https://aclanthology.org/2025.naacl-long.179.pdf)；[PRECISE](https://www.alphaxiv.org/abs/2606.05308)
- 用共形预测给单次裁判打分加区间（EMNLP 2025）— [ACL 2025.emnlp-main.569](https://aclanthology.org/2025.emnlp-main.569/)

### Inferences
- 「先验」的"100 条人工标签、一致率 ≥ 90% 才自动发布"有两个统计问题：
  - 100 条下观察到 90% 一致，95% 二项置信区间大约是 82–95%，下界远低于 90%。如果要求"下界 ≥ 90%"，需要几百条样本，或者在 100 条里观察到约 96% 以上的一致。
  - 应该同时报 κ（或按类别给出的召回/精确），因为四类判定分布不均衡（"已兑现"可能占大多数），只看原始一致率会高估。
- 应该分层抽样：按判定类别、领域、模型是否分歧来分层，"部分兑现"和"证据不足"要过采样。这正是 StratPPI 和主动采样的思路。

### Gaps
- 没有找到专门针对"兑现判定"任务的人与人 κ 基线；建议「先验」自己做双人标注来测。

---

## 4. 预测评估与预测者打分（ForecastBench、Metaculus、GJ），以及模糊/部分兑现怎么处理

### Takeaway
2026 年 LLM 在 ForecastBench 上已逼近超级预测者：顶尖 AI 与超预测者中位数的差距已不显著，但超预测者整体仍排第一。打分方面的共识是：用 proper scoring rule（Brier 或对数分）；按题目难度做调整；无法判定的题作废、不计分；样本少时 Brier 噪声极大。现有的名人预测追踪站对"晚兑现"和"部分兑现"的计分口径各不相同，同一个人（Musk）的命中率因此在 7% 到 24% 之间变动。

### Cited Findings
- **ForecastBench 方法**：最初用原始 Brier 排名，后来改为双向固定效应模型，把成绩分解为"预测者能力 + 题目难度"，以解决不同预测者答不同题的问题。新模型约 50 天后排名趋于稳定。2026-03 起改用 Brier Index（0–100，越高越好），ABI = 100×(1−√ABS) — [ForecastBench 方法 PDF](https://www.forecastbench.org/assets/pdfs/forecastbench_updated_methodology.pdf)；[Leaderboards](https://www.forecastbench.org/leaderboards/)；[Docs](https://www.forecastbench.org/docs/)；公式转引自 [arXiv 2604.18576](https://arxiv.org/html/2604.18576v1)
- FRI 2025-10：超预测者经难度调整后的 Brier 为 0.081，最好的 LLM（GPT-4.5）为 0.101。FRI 预测 LLM 将在 2026 年底与超预测者持平（95% CI 2025-12 至 2028-01），LLM 每年改进约 0.016 Brier — [FRI Substack](https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark)
- 引入 Brier Index 时：超预测者 0.086，最好的 LLM（Cassi ensemble、Grok 4.20 Preview）0.103；外推的持平时间改为 2027-05（95% CI 2026-04 至 2028-05）— [FRI Brier Index](https://forecastingresearch.substack.com/p/introducing-the-brier-index)
- 2026 年中第三方报告（非官方）：超预测者中位数 Overall BI 69.3，Gemini、Cassi、Foresight-v3 等已落入超预测者的置信区间，即"差异不显著"— [Lightning Rod](https://blog.lightningrod.ai/p/ai-reaches-human-superforecaster-range)。超预测者约 70.2，DeepMind 的"green tree"约 67.8 — [Parallect 2026-05](https://parallect.ai/reports/ai-superforecasters-parity-may-2026-fb32ac)。另有一个系统自报 ABI 71.0，超预测者为 70.9 — [arXiv 2604.18576](https://arxiv.org/html/2604.18576v5)
- Good Judgment 的批评：超预测者只在 2024 年中一次性回答了一组固定题，AI 却在不同的题上被评分，靠难度调整去弥合这个差异 — [Good Judgment](https://goodjudgment.com/what-forecastbench-doesnt-measure/)
- **Metaculus**：作废（Annulled）或模糊（Ambiguous）的题不计分。题目"欠规定"、即结果不符合判定标准的设定时，作废是允许的。Baseline score 是重新缩放后的对数分（对比 50% 或 1/N 的机会基线，完美 = +100，二元题最差 −897）；Peer score 与同题其他人比较，所有人的总和为零 — [Metaculus FAQ](https://www.metaculus.com/faq/)；[Scores FAQ](https://www.metaculus.com/help/scores-faq/)。历史作废率约 8%，二元题约 30% 判为"是"— [arXiv 2601.22444](https://arxiv.org/abs/2601.22444)
- Pitfalls in Evaluating LM Forecasters（2025-06）：平均 Brier 会偏向某些类型的技能；标签有噪声时，把概率截断（clamping）反而能拿到更好的对数分 — [arXiv 2506.00723](https://arxiv.org/pdf/2506.00723)
- 样本少时噪声大：每类不到 20 题时 Brier "极其嘈杂"— [arXiv 2507.04562](https://arxiv.org/html/2507.04562v3)。【背景】Brier 与 BSS 的解析标准误公式见 [Weather and Forecasting 2008](https://journals.ametsoc.org/view/journals/wefo/23/5/2007waf2007049_1.xml)
- Beta-Bernoulli 校准器：用 Beta 分布对齐人类的不确定性（与「先验」的 Beta 后验思路相近）— [arXiv 2605.27668](https://arxiv.org/pdf/2605.27668)
- **PolitiFact 承诺追踪**：只看可核验的结果，不看意图或努力（例如国会阻挠也判"Broken"）。评级有 Not Yet Rated、In the Works、Stalled（这两个是中间评级），以及 Compromise、Promise Kept、Promise Broken（这三个是最终评级）。Compromise 的定义是结果明显少于承诺，但仍是与目标一致的重要成果。评级可以反转。任期结束时，Trump 一任 53% Broken，Biden 34%，Obama 23%；MAGA-Meter 追踪 75 条承诺 — [PolitiFact 方法](https://politifact.com/article/2018/feb/12/principles-truth-o-meter-politifacts-methodology-i/)；[Biden 一周年](https://www.politifact.com/article/2022/jan/18/politifacts-biden-promise-tracker-one-year/)；[Obameter About](https://projects.tampabay.com/projects/2017/politifact/obameter/about/)；[Poynter MAGA-Meter](https://www.poynter.org/fact-checking/2025/politifact-maga-meter-donald-trump-campaign-promise-fact-checks/)
- **Musk 预测追踪站的口径差异**：
  - MuskOmeter：94 条，准时 100%、迟到 50% 计分，准确率 24%（自称是讽刺站）— [muskometer.com](https://www.muskometer.com/)
  - Clearer Thinking：只保留有明确截止且已过期的 43 条，人工核对，命中率 16.28% — [Clearer Thinking](https://www.clearerthinking.org/post/how-good-is-elon-musk-at-predicting-the-future-and-what-would-it-take-to-become-an-accurate-predict)
  - twoweeks.lol：443 条陈述合并为 336 条预测（重复承诺或改期的视为同一条预测的时间线），分为 missed 95、on time 46、late 59、partial 17、goalposts moved 125 等，由 bot 每天复核 — [twoweeks.lol](https://twoweeks.lol/)
  - Tesorb：只按具体时限判，命中率约 7% — [Tesorb](https://tesorb.com/elon-musk-predictions-tracker/)
  - Avow：给多个名人打 −100 到 +100 的分，Musk 有 177 条已评预测，得分 −21 — [avow.ai](https://avow.ai/)
  - Wikipedia 的自动驾驶预测列表 — [Wikipedia](https://en.wikipedia.org/wiki/List_of_predictions_for_autonomous_Tesla_vehicles_by_Elon_Musk)

### Inferences
- 「先验」的 Beta 后验（3 年半衰期、80% 区间）与这些做法方向一致，但有几点值得补：
  - "部分兑现"应该明确对应一个分值（例如 0.5，或者 PolitiFact 式的 Compromise），并公开说明，因为不同口径会让同一个人的命中率在 7–24% 之间变动。
  - "证据不足"类似 Metaculus 的作废，应该不计分，并且公开作废率（Metaculus 约 8%）。
  - 重复承诺和改期（moved goalposts）应该像 twoweeks.lol 那样合并成一条带时间线的预测，避免同一件事被重复计分。
  - 不同人面对的题目难度差别很大，可以考虑 ForecastBench 式的难度调整。

### Gaps
- 没能拿到 ForecastBench 2026-10 当下的官方排名数字（只有第三方的 2026 年中数据）。
- 没有找到 PunditTracker 的原始方法，也没找到 Good Judgment 关于"预测者技能持久性和样本量"的最新文档。

---

## 5. 引用溯源检查、言行一致性判定，以及核查智能体的提示注入风险

### Takeaway
现在的模型链接有效率很高，但"引文是否真的支持主张"只有大约 40–77%。所以「先验」用代码逐字比对存档原文是必要的。另外，核查智能体面对的主要威胁不只是隐藏的指令，还有"用内容攻击"：有偏或虚假的网页本身就会误导判定，传统的注入防御对此无效。

### Cited Findings
- Cited but Not Verified（2026-05）：14 个模型的链接有效率 > 94%、相关性 > 80%，但事实准确率只有 39–77%；工具调用次数从 2 增加到 150 时，Fact Check 准确率平均下降约 42% — [arXiv 2605.06635](https://arxiv.org/pdf/2605.06635)
- SourceCheckup（Nature Communications 2025，医学领域）：50–90% 的回答没有被自己的引用完全支持；带网页搜索的 GPT-4o 只有 55% 被完全支持 — [Nature Comms](https://www.nature.com/articles/s41467-025-58551-6)
- CiteGuard：在 CiteME 上最高 68.1%，人类基线为 69.2% — [arXiv 2510.17853](https://arxiv.org/pdf/2510.17853)。做引用核验是否需要前沿模型，见 [arXiv 2607.08700](https://arxiv.org/pdf/2607.08700)
- **Attacks by Content（EMNLP 2025）**：攻击者不需要注入指令，只要提供有偏、残缺或虚假的信息，就能误导检索增强的智能体，而现有的注入检测对此无效。论文建议的防御是让智能体主动寻找更多证据来支持或反驳，再比较可信度，也就是把自动事实核查本身当作智能体的"认知安全"— [arXiv 2510.11238](https://arxiv.org/html/2510.11238)；[ACL 2025.emnlp-main.431](https://aclanthology.org/2025.emnlp-main.431.pdf)
- 真实案例：Unit 42 在 2025-12 报告了野外的间接提示注入，目标是让 AI 广告审核系统放行诈骗广告，即攻击核查或审核类智能体 — [Unit 42](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/)
- 防御方面的相关工作：WebSentinel（2026）[arXiv 2602.03792](https://arxiv.org/pdf/2602.03792)；WARD [arXiv 2605.15030](https://arxiv.org/pdf/2605.15030)；CleanBase（检测 RAG 库中的恶意文档）[arXiv 2605.00460](https://arxiv.org/pdf/2605.00460)
- **言行一致性**：没有公开的标注基准。Cal Poly 的论文对齐了加州议员的新闻稿、听证会发言和投票，用 NLI 和 LLM 做立场检测；因为缺少标注数据，只能用 ParlVote 的投票结果作为代理 — [Cal Poly thesis](https://digitalcommons.calpoly.edu/cgi/viewcontent.cgi?article=5061&context=theses)。立场与投票一致性的 GPT 裁判匹配率为 0.728 — [arXiv 2511.17813](https://arxiv.org/pdf/2511.17813)。UNBench 收录了联合国安理会 17,430 条投票和 7,394 条发言 — [arXiv 2502.14122](https://arxiv.org/html/2502.14122v1)

### Inferences
- 言行一致性比兑现判定更主观（裁判匹配率约 0.73），不适合用 90% 的门槛自动发布，应该默认交给人工复核。
- 智能体抓取的网页内容一律当作数据。判定理由只能引用经过逐字校验的存档原文。对"孤证"（只有单一来源支持的判定）要求至少两个独立来源；在别的 AI 查询「先验」先验的接口里，也应该标明哪些判定是自动发布的、哪些是人工复核过的。

### Gaps
- 没有找到"逐字引语核验（quote verification）"的专门基准；也没找到专门针对预测追踪类应用的注入攻击实测数据。
