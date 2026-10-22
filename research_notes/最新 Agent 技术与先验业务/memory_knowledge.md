# Agent 记忆与知识管理（截至 2026-10）：溯源、时间感知、新鲜度

> 方法说明：本轮 WebFetch 工具报错（模型不可用），所有发现来自 WebSearch 结果摘要及其指向的页面；未能逐字核对原文的地方已标注"未核原文"。基准分数一律注明报告方（厂商自报 / 第三方）。2025 年以前的工作标为"背景"。

## 1. 分层 Agent 记忆架构与产品（2025–2026）及基准成绩

### Takeaway
2026 年主流产品已从"向量库存聊天片段"转向"抽取 → 追加式存储 → 多路融合检索 + 后台整理（sleep-time / Dreaming）"，并普遍加上版本/修订记录；但 LongMemEval/LoCoMo 分数几乎全部是厂商自报、口径不一（QA 准确率 vs 检索召回、评判模型不同），不能当作独立排名。对「先验」而言，这些系统解决的是"关于用户的个性化记忆"，不是"可审计的公共事实库"，可借鉴的是它们的时间与修订机制，而非整套产品。

### Cited Findings
**Letta（前 MemGPT，MemGPT 论文 2023 为背景）**
- 核心记忆由带 label 的 memory block 组成，每个 block 单独存库、有 block_id；每次调用 LLM 时从数据库状态"编译"出上下文窗口；多个 agent 可共享 block，sleep-time agent 正是通过共享 block 在后台改写主 agent 的记忆 — [Letta: Memory Blocks](https://www.letta.com/blog/memory-blocks/)
- Sleep-time compute 论文（2025-04，arXiv 2504.13171）：利用交互间隙预先处理信息、重组记忆状态 — [arXiv 2504.13171](https://arxiv.org/pdf/2504.13171)
- 2026-02 发布 Context Repositories（MemFS）：把记忆同步为 git 管理的文件系统，sleep-time 进程在 git worktree 中工作再自动合并，所有上下文（skills、prompts）都被 git 追踪 — [Letta: Context Repositories](https://www.letta.com/blog/context-repositories/)
- 2025-12 Letta Code、2026-01 Conversations API（一个 agent 跨多会话共享记忆）— [Learn AI wiki: Letta](https://ai.miraheze.org/wiki/Letta)（二手）
- Letta 的 LongMemEval 分数说法冲突：Atlan 列 83.2%，AutoMem 称 Letta 未发布标准化 LoCoMo/LongMemEval 分数 — [Atlan](https://atlan.com/know/mem0-alternatives/)；与 [AutoMem](https://automem.ai/blog/agent-memory-in-2026-an-honest-comparison-of-mem0-zep-letta-and-the-rest) 矛盾

**Mem0**
- 2026-04 发布"token-efficient memory algorithm"：单次、只追加（ADD-only）抽取，抽取管线从不覆盖或删除旧记忆；检索并行融合语义相似、关键词、实体匹配。自报 LoCoMo 91.6、LongMemEval 93.4（旧算法 LongMemEval 67.8），平均每次检索 6,787 tokens（<7K）— [Mem0 博客](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm)；[Mem0 迁移文档](https://docs.mem0.ai/migration/platform-v2-to-v3)（厂商自报）
- 2026-05 更新加入 Temporal Reasoning 与 Memory Decay：自报 LoCoMo 92.5、LongMemEval 94.4；LongMemEval 时间推理子项 93.2→97.0，但 knowledge-update 子项退步 2.6 分 — [Mem0: 现已具备时间推理](https://mem0.ai/blog/the-token-efficient-memory-algorithm-now-has-temporal-reasoning)（厂商自报，未核原文）
- Mem0 自己的对比承认：Zep 每次检索约 1.6K tokens，Mem0 约 6.9K — [Mem0: Zep vs Mem0](https://mem0.ai/blog/zep-vs-mem0-which-ai-memory-layer-should-you-choose)
- 独立测试 Mem0 开源版 LongMemEval 仅 32.4%，而托管平台自报 93.4% — [DEV: 2026 独立基准](https://dev.to/everest_an/-i-benchmarked-ai-agent-memory-in-2026-and-the-numbers-tell-a-different-story-than-the-marketing-2ae4)（个人博客，样本与方法需谨慎）
- 2025 年 Mem0 原论文（arXiv 2504.19413，背景）常被引用为 LongMemEval ~49%，该数字来自 Zep 2025 博客而非 Mem0 自报 — [MemPalace 批判论文 arXiv 2604.21284](https://arxiv.org/html/2604.21284v1)

**Zep / Graphiti**
- Zep 论文（2025-01-20，arXiv 2501.13956）：DMR 94.8% vs MemGPT 93.4%；LongMemEval 上相对全上下文基线准确率最高 +18.5%、延迟 -90%；上下文从约 115K tokens 降到约 1.6K — [arXiv 2501.13956](https://arxiv.org/abs/2501.13956)（厂商自报）
- LongMemEval：全上下文 55.4/60.2 vs Zep 63.8/71.2（gpt-4o-mini / gpt-4o）；时间推理子项 45.1%→62.4%，单会话助手类略降 — [Zep 论文 PDF](https://arxiv.org/pdf/2501.13956)；[Signals 摘要 2026-07](https://signals.aktagon.com/articles/2026/07/zep-a-temporal-knowledge-graph-architecture-for-agent-memory/)

**Anthropic**
- Memory tool（`memory_20250818`）2025-09 以 beta 发布，客户端执行——存储后端由开发者自己实现（文件、数据库、加密文件等）；Anthropic 内部评估：memory + context editing 在 agentic search 上提升 39%，100 轮 web search 测试 token 降 84%（厂商自报）— [Leonie Monigatti: Exploring Anthropic's Memory Tool](https://www.leoniemonigatti.com/blog/claude-memory-tool.html)；[Thomas Wiegold 指南](https://thomas-wiegold.com/blog/claude-api-memory-tool-guide/)
- 2026-02 文档 diff 显示示例去掉 beta header，但页面仍写"currently in beta"，GA 状态未确认 — [文档监控 diff](http://www.chenboyuan.com/claude-code-doc-monitor/2026/02/17/anthropic-api/agents-and-tools/tool-use/memory-tool.html)
- Context editing（`clear_tool_uses_20250919`、`clear_thinking_20251015`）与 2025-11 compaction；2026-05 Managed Agents 推出 "Dreaming" 研究预览，在会话间合并重复、删除陈旧记忆 — [Suprmind 汇总](https://suprmind.ai/hub/claude/features/)（二手，未核官方原文）

**OpenAI**
- 2025-04-10 拆分为 saved memories 与 reference chat history — [TechCrunch](https://techcrunch.com/2025/04/10/openai-updates-chatgpt-to-reference-your-other-chats/)
- 2026-06-04 起推出 "Dreaming"：后台从历史对话合成可编辑的画像摘要并随时间修订，例如把"你7月要去新加坡"改写为"你在2026年7月去过新加坡"；旧 saved memories 被标为 legacy — [OpenAI: Dreaming](https://openai.com/index/chatgpt-memory-dreaming/)
- 据 Mem0 对该文的解读：OpenAI 内部事实回忆评估 41.5%（2024）→82.8%（2026），时间敏感准确率 75.1% — [Mem0 on X](https://x.com/mem0ai/article/2071990201531118063)（二手转述 OpenAI 自报）

**Google**
- Vertex AI Agent Engine Memory Bank 2025-07-08 预览；2025-10 增加记忆 TTL、自定义 topic、few-shot 抽取示例 — [Google 开发者论坛](https://discuss.google.dev/t/announcing-customization-features-for-vertex-ai-memory-bank/261941)；[Vertex AI 发布说明](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes)
- Memory Revisions（约 2025-11 预览）：每次创建/更新/删除都生成不可变快照，支持 RollbackMemory、删除后 48 小时可恢复 — [Google 开发者论坛: Memory Revisions](https://discuss.google.dev/t/vertex-ai-agent-engine-introduced-memory-revisions/285496)
- 2026-01-28 起 Sessions / Memory Bank 开始计费 — [Vertex AI 发布说明](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes)

**基准本身与可信度**
- LongMemEval（arXiv 2410.10813，背景）：500 题，五类能力；其中 knowledge-update 78 题、temporal-reasoning 133 题；LongMemEval_S 每题约 115K tokens 历史 — [arXiv 2410.10813](https://arxiv.org/pdf/2410.10813)
- 2026 年无统一排行榜，多数分数为厂商自报，版本、评判模型、指标各异；MemPalace 的 96.6/98.4% 是检索 Recall@5，不能与 QA 准确率比较 — [Atlan](https://atlan.com/know/mem0-alternatives/)；[arXiv 2604.21284](https://arxiv.org/html/2604.21284v1)
- LoCoMo 对话仅约 26K tokens，在 Mem0 自己的表里全上下文胜过所有工具；AutoMem 97% 情况下能检索到正确会话但只有 87% 答对 — [AutoMem 对比](https://automem.ai/blog/agent-memory-in-2026-an-honest-comparison-of-mem0-zep-letta-and-the-rest)
- Datapace（2026-10）小样本测试：25 题与 50 题时排名翻转 — [Datapace](https://datapace.ai/blog/ai-agent-memory-tools-2026)
- 一项 2025 研究中检索器在"矛盾消解"类题目上仅 0.037（dense，100K 长度）— [arXiv 2510.27246](https://arxiv.org/pdf/2510.27246)

### Inferences
- 行业共识正在收敛到三件事：追加而非覆盖（Mem0 ADD-only、Google Memory Revisions、Letta git）、后台整理（sleep-time、Dreaming）、时间改写（OpenAI 把将来时改成过去时）。「先验」的"冻结证据"路线与此方向一致，且更严格（要求逐字引文与存档）。
- 这些产品的"整理/改写"会覆盖原始措辞——这正是「先验」不能直接采用它们作为主存储的原因：预测判定需要原话的冻结版本。可把它们当作调用方 agent 的记忆层，「先验」作为其外部的权威事实源（consult API / MCP）。
- knowledge-update 与矛盾消解是全行业的薄弱项（Mem0 加时间推理后该项反而退步），说明"什么时候为真"最好由显式数据模型保证，而不是靠 LLM 检索。

### Gaps
- 没找到 2026 年针对 Mem0/Zep/Letta 的权威第三方 LongMemEval 复现；LongMemEval-V2 似乎已出现（被 arXiv 2609.20045 引用），未查到具体内容。
- LangMem（LangChain）2026 年的状态与基准未找到可靠来源。
- Anthropic memory tool 是否 GA、Dreaming 的官方细节未能核对官方文档。

## 2. 时态 / 双时态知识图谱：Graphiti 等如何回答"T 时刻什么为真"、如何处理矛盾

### Takeaway
Graphiti 在每条事实边上记录两条时间线：现实有效时间（valid_at / invalid_at）与数据库事务时间（created_at / expired_at）；新事实与旧事实冲突时把旧边"作废"（设置 invalid_at 和 expired_at）而不删除。2026 年的学术工作（TOKI、Operon）把同一思路形式化为"主体+谓词相同、客体不同、有效期重叠 = 矛盾"，并在追加式存储上做时点查询。Postgres 18 已原生支持有效时间约束，但事务时间仍需自建。

### Cited Findings
- Graphiti 四个时间戳：valid_at/invalid_at 表示关系在现实中开始/结束为真（由 LLM 在处理 episode 时抽取，可为绝对日期或"2年前"这类相对日期）；created_at 为入库时间，expired_at 为数据库层面失效时间 — [Zep 博客: Beyond Static Graphs](https://www.getzep.com/blog/beyond-static-knowledge-graphs/)；[Graphiti 双时态模型文档](https://mintlify.wiki/getzep/graphiti/concepts/temporal-model)
- 失效逻辑：用 LLM 把新边与语义相关的已有边比较找矛盾；若时间重叠，把旧边 t_invalid 设为新边的 t_valid；新信息总是优先；代码 `edge.invalid_at = resolved_edge.valid_at; edge.expired_at = ... utc_now()` — [arXiv 2501.13956](https://arxiv.org/pdf/2501.13956)；[Graphiti 研究笔记](https://lin-guanguo.github.io/llm-memory-research/graphiti.research/)
- 文档示例："Alice 是 CEO"（valid_at 2023-01-01）之后得知"Bob 于 2024-01-01 成为 CEO"→ Alice 的边 invalid_at=2024-01-01（任期结束），expired_at=2025-03-15（系统得知的时间）— [Graphiti 双时态模型](https://mintlify.wiki/getzep/graphiti/concepts/temporal-model)
- Episode 可乱序到达，按 valid_at 排序决定失效哪条边；新 episode 可修正已有边的 valid_at（"7月买 iPhone"→"其实是8月"）— [Zep 博客](https://www.getzep.com/blog/beyond-static-knowledge-graphs/)
- 已知缺陷：Graphiti 0.30.1 中若抽取出"将来的" invalid_at，边会在入库时就被设为 expired（issue #2012，2026-10 前后提出）——即把"将于某日失效"误当成"已失效" — [GitHub issue #2012](https://github.com/getzep/graphiti/issues/2012)
- 据第三方比较，自动把事实标为过时的双时态有效窗口只有 Zep/Graphiti 实现，Mem0、Letta、LangMem 存时间戳但不自动标记过时 — [Medium 对比](https://medium.com/@wasowski.jarek/i-compared-5-ai-agent-memory-systems-across-6-dimensions-none-wins-6a658335ed0a)（二手；注意 Mem0 2026-05 已加时间推理/衰减）
- TOKI（arXiv 2606.06240）：面向 agent 持久记忆的双时态算子代数；定义矛盾为主体与谓词相同、客体不同且有效时间段重叠 — [arXiv 2606.06240](https://arxiv.org/pdf/2606.06240)
- Operon（arXiv 2607.04240）：追加式双时态事实库，事实为不可变对象，更正=关闭旧记录+追加新记录，时点查询是纯过滤；每条事实含 主体/谓词/值、有效时间区间、记录时间区间、来源、置信度、标签、可选 supersedes 指针 — [arXiv 2607.04240](https://arxiv.org/pdf/2607.04240)
- Postgres 18：PRIMARY KEY / UNIQUE 支持 `WITHOUT OVERLAPS`（最后一列为 range 类型，需 btree_gist，用 GiST 索引），外键支持 `PERIOD`（要求引用方时间段被被引用方有效期完全包含）；Postgres 19 增加 `UPDATE/DELETE ... FOR PORTION OF`；事务时间（系统版本化）仍无原生支持 — [PostgreSQL 特性矩阵](https://www.postgresql.org/about/featurematrix/detail/temporal-constraints)；[Neon](https://neon.com/postgresql/18/temporal-constraints)；[Aiven](https://aiven.io/blog/exploring-how-postgresql-18-conquered-time-with-temporal-constraints)；[Xata](https://xata.io/blog/postgres-as-a-temporal-db)

### Inferences
- 「先验」的产品规则"按发言当日有效的关系判断利益"就是一个有效时间（valid time）时点查询：`WHERE relationship.valid_period @> claim.said_at`。仅此不够——还需事务时间回答"我们在判定当时知道这段关系吗"（例如持仓是事后才披露的）。建议：关系表 = `valid_period tstzrange`（现实）+ `recorded_at / superseded_at`（我们何时知道/何时被更正），后者用追加 + supersedes 指针实现，与 Operon 的设计一致。
- Postgres 18 `WITHOUT OVERLAPS` 可直接防止同一人同一职位出现重叠任期的录入错误；但"同时担任多家公司董事"等合法重叠需要把公司放进主键。
- Graphiti issue #2012 提醒：必须区分"已知结束日期"、"预计结束日期"（如任期到期、合同到期）、"未知"。建议 end 字段配一个 end_kind（actual / scheduled / unknown）。
- Graphiti 用 LLM 自动判矛盾并作废旧边，适合聊天记忆；对「先验」这类需要人工审核的金融关系，作废动作应作为待审事件，而非由 LLM 直接生效。

### Gaps
- 未找到在 Postgres 上实现 Graphiti 式双时态的生产案例（Graphiti 主要后端为 Neo4j/FalkorDB 等图库）。
- TOKI、Operon 为 2026 年 arXiv 预印本，未见同行评审或生产采用。

## 3. 携带溯源的知识库：GraphRAG、LightRAG、带引用的 KG、W3C PROV、ClaimReview

### Takeaway
GraphRAG 类系统在 2025–2026 年加强了"实体/关系 → 原始 chunk"的链接（LightRAG 2025-03 加入引用），但它们的溯源停留在"来自哪段文本"，没有时间有效性，也没有逐字引文的冻结要求。学术界 2025–2026 出现了一批"主张–证据追踪图"工作（PROV-AGENT、LEDGER、Isnad-Rijal 框架），基本都映射到 W3C PROV-DM。ClaimReview 仍是有效的 schema.org 词汇，但 Google 已于 2025-06 停止展示其富结果。

### Cited Findings
- LightRAG：2025-03 加入引用功能，实现来源归属与文档可追溯；实体与关系链接回原始 chunk 与文件；支持增量更新（EMNLP 2025）— [HKUDS/LightRAG](https://github.com/hkuds/lightrag)；[DEV: LightRAG vs GraphRAG 2026](https://dev.to/jangwook_kim_e31e7291ad98/lightrag-vs-microsoft-graphrag-in-2026-the-costs-we-could-verify-and-the-benchmark-numbers-we-5bci)
- Microsoft GraphRAG：local search 结合图记录与源文本，global search 对社区报告做 map-reduce；LazyGraphRAG 推迟 LLM 工作至查询时，微软自报索引成本为完整 GraphRAG 的 0.1%；检索结果中未见 GraphRAG 专门的引用特性 — [DEV 对比](https://dev.to/jangwook_kim_e31e7291ad98/lightrag-vs-microsoft-graphrag-in-2026-the-costs-we-could-verify-and-the-benchmark-numbers-we-5bci)
- "When to use Graphs in RAG" 基准：HippoRAG2、Fast-GraphRAG、MS-GraphRAG、LightRAG、LazyGraphRAG 排名随任务变化，带重排的普通 RAG 依然有竞争力 — [arXiv 2506.05690](https://arxiv.org/html/2506.05690v3)
- LineageRAG（2026）：为每个"证据需求"保留需求–段落溯源并据此把结论落地到源文本 — [arXiv 2608.16004](https://arxiv.org/pdf/2608.16004)
- PROV-AGENT（ORNL，arXiv 2508.02866，IEEE eScience 2025）：扩展 W3C PROV，借助 MCP 把 agent 的 prompt、响应、决策纳入端到端工作流溯源 — [ResearchGate: PROV-AGENT](https://www.researchgate.net/publication/394321957_PROV-AGENT_Unified_Provenance_for_Tracking_AI_Agent_Interactions_in_Agentic_Workflows)
- 后续工作把每次工具调用记录为 prov:Activity 子类，参数记为 prov:used，结果记为 prov:generated — [arXiv 2509.13978](https://arxiv.org/html/2509.13978)
- 2026 综述"From Agent Traces to Trust"：类型化关系包括 support、derive、depend-on、contradict、invalidate、update、use、generate；附录给出到 W3C PROV-DM 的映射 — [arXiv 2606.04990](https://arxiv.org/html/2606.04990v4)
- LEDGER（2026）：面向审计 LLM agent 的"主张→证据"追踪图 — [arXiv 2608.18398](https://arxiv.org/pdf/2608.18398)
- Isnad-Rijal 框架（2026）：在编译型 LLM 知识库中，每条主张都是多步 agent 管线的产物，因此主张级信任既更重要也更可处理（借用圣训学的"传述链+传述人评级"）— [arXiv 2607.24117](https://arxiv.org/pdf/2607.24117)
- NovaFabric（2026）：防篡改、可重放的 agent 运行证据 — [arXiv 2609.12582](https://arxiv.org/pdf/2609.12582)
- ClaimReview：Google 于 2025-06-12 宣布停用包括 Claim Review 在内的 7 种结构化数据富结果；schema.org 类型本身仍有效；ClaimReview 创建者之一 Glenn Kessler 希望其在生成式 AI/LLM 方面有未来用途 — [Poynter/IFCN](https://www.poynter.org/ifcn/2025/google-claimreview-fact-checks-snippets-removed/)；[News Literacy Project](https://newslit.org/news-and-research/how-to-find-better-search-results-as-ai-summaries-take-over-and-google-ends-claimreview-fact-checking-program/)；[Patrick Stox 停用时间线](https://patrickstox.com/technical-seo/on-page/structured-data/schema-deprecations/)

### Inferences
- 「先验」的"每条事实带存档来源 + 逐字引文"比 GraphRAG/LightRAG 的 chunk 级溯源更严格，是差异化卖点；可在 consult API 输出中用 PROV 词汇（wasDerivedFrom / wasGeneratedBy / wasAttributedTo / generatedAtTime）表达，便于其他 agent 机器读取。
- 判定（verdict）本身也应作为 prov:Entity，记录它由哪个评分版本（score.ts 版本号）、哪个人工审核、使用了哪些证据生成——与 2026 综述的 support/contradict/invalidate 关系类型对齐即可。
- ClaimReview 已失去 Google 展示价值，但作为对外 JSON-LD 词汇（claimReviewed、itemReviewed.author、datePublished、reviewRating）仍可零成本兼容，适合给每条预测判定页加，主要面向 LLM 爬取而非 SEO。

### Gaps
- 未找到把 W3C PROV 用于"公众人物主张库"的生产案例。
- Microsoft GraphRAG 2026 年是否新增显式引用/时间支持，未能确认。

## 4. 缓存与新鲜度：语义缓存、TTL、as-of 时间戳、失效触发、存与取的决策

### Takeaway
2026 年工程界共识是：单靠 TTL 不够，需"TTL 兜底 + 版本键（prompt/模型/评分版本）+ 内容变更事件触发失效"三层；研究（FreshCache、CacheSense）进一步按来源内容变化选择性失效，并发现大部分检测到的内容变化并不影响答案。对金融披露这类有明确发布事件的数据，事件触发（如 SEC 新文件）比 TTL 更合适。

### Cited Findings
- 语义缓存会放大陈旧：相似度高会掩盖过时内容，且一次错误回答会被所有相似查询复用、"不会衰减而是累积" — [TianPan.co 2026-04](https://tianpan.co/blog/2026/04/20/cache-invalidation-ai-semantic-rag)
- 分层失效：TTL 是底线；prompt_version 在部署时触发失效；显式失效作为运维逃生口；查找时同时校验 TTL 与版本 — [FutureAGI 2026 指南](https://futureagi.com/blog/what-is-semantic-caching-llms-2026/)
- 事件驱动失效：知识库重新导入时，失效所有引用了变更 chunk 的缓存条目；TTL 与事件结合既限定时间上的陈旧，又能对内容变化做出反应；示例 TTL：语义 6h、检索 1h — [Barking Iguana](https://barkingiguana.com/writing/caching-llm-responses-without-stale-answers/)
- 建议 TTL 参考值：常青文档 7–30 天、产品价格 24 小时、新闻事件 1–4 小时、用户个性化回答仅会话内或不缓存 — [myengineeringpath.dev](https://myengineeringpath.dev/genai-engineer/llm-caching/)
- "有界陈旧"是多数生产 RAG 的正确模型，用文档库的 CDC 流在文档更新时发事件失效引用它的检索缓存；分层缓存：静态层（离线审核的问答，高相似阈值、长 TTL）与动态层（新内容，激进淘汰）— [Martinuke0 2026-03](https://martinuke0.github.io/posts/2026-03-12-optimizing-semantic-cache-strategies-to-reduce-latency-and-costs-in-production-rag-pipelines/)
- TTL 不保证正确性，只限制陈旧的"爆炸半径" — [PyImageSearch 2026-05](https://pyimagesearch.com/2026/05/04/semantic-caching-for-llms-ttls-confidence-and-cache-safety/)
- FreshCache（arXiv 2607.04281，开放网络 RAG）：MLP 版节省 97% 搜索 API 调用，基于哈希判定的陈旧错误率 0.1%；对比 SemanticTTL（14.9% 陈旧，节省 72%）、vCache（7.2%，47%）、SCALM（5.2%，96%）；仅 34.3% 的检测到的内容变化真正影响答案正确性（作者自报）— [arXiv 2607.04281](https://arxiv.org/pdf/2607.04281)
- CacheSense：监控知识库文档级变化，只失效与变更内容嵌入相似度高的缓存条目，并把条目标为 fresh / at-risk / expired 三级 — [ResearchGate: CacheSense](https://www.researchgate.net/publication/404941448_CacheSense_Freshness-Aware_Semantic_Caching_with_Selective_Invalidation_for_LLM-Serving_Backends)
- Google Memory Bank 支持给记忆设置 TTL — [Google 开发者论坛](https://discuss.google.dev/t/announcing-customization-features-for-vertex-ai-memory-bank/261941)
- OpenAI Dreaming 会随时间改写记忆的时态（将来→过去），即"按时间自动刷新"的一种形式 — [OpenAI](https://openai.com/index/chatgpt-memory-dreaming/)
- SEC 失效触发源：`data.sec.gov/submissions/CIK##########.json` 随提交实时更新；EDGAR Atom 最新文件流可按表单类型（如 8-K）或公司过滤，但不含 8-K item 代码；XBRL API 覆盖 10-Q/10-K/8-K/20-F 等；efts.sec.gov 全文检索；商业服务 sec-api.io 提供发布后约 300ms 的 websocket 流 — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)；[EdgarScout RSS](https://edgarscout.com/rss-feed/)；[sec-api.io](https://sec-api.io/)

### Inferences
- 「先验」"冻结证据、实时取背景"可落成三档：
  1. **永久冻结**（无 TTL，只追加更正）：主张原文与存档、截止日判定、利益关系区间、人工审核标签、评分版本。
  2. **事件失效的半持久缓存**：公司收入地区结构、主要客户/供应商——数据来自 10-K/10-Q/20-F，自然的失效触发是"该 CIK 出现新的 10-K/10-Q/8-K"（监听 submissions JSON 或 Atom 流），TTL 仅作兜底（如 100 天，约等于一个季度）。
  3. **短 TTL 实时取**：最新新闻、股价、近期言论——小时级 TTL 或不缓存，响应必须带 as_of 与 source_url。
- 判断"某条背景是否影响判定"：FreshCache 发现仅约三分之一的内容变化影响答案，暗示可在变更时只对"引用了该数据的判定"重算，而非全量重算——需要维护"判定 → 使用了哪些背景快照"的依赖边（即第 3 节的 prov:used）。
- 关键规则：凡是参与了判定的背景数据，即使原本属于"实时取"类，也要在判定时快照冻结（带 as_of），否则判定不可复现。即"实时取"只用于展示，不用于已落地的判定。
- 缓存键应含评分公式版本（对应 score.ts 版本号），公式一变即失效所有派生分数缓存，与 FutureAGI 的 prompt_version 思路一致。

### Gaps
- 未找到公开描述"何时持久化 vs 何时重新检索"的成熟决策框架的生产工程博客；以上分档为推断。
- 非美国公司（港股、A 股）披露的实时事件源未调研。

## 5. 事件溯源 / 追加式审计日志用于 AI 生成事实；派生分数版本化

### Takeaway
2026 年多篇预印本把事件溯源（append-only 日志 + 确定性投影 + supersedes 指针）当作 agent 记忆与审计的骨架；主流产品也在向不可变修订靠拢（Google Memory Revisions、Letta git、Mem0 ADD-only）。共同警告：如果 agent 自己写日志，日志会固化幻觉，需外部可验证的落地（对「先验」即存档原文与人工审核）。

### Cited Findings
- ESAA（arXiv 2602.23193）：agent 只输出结构化意图（校验过的 JSON），确定性编排器校验后写入追加式日志，再投影成可验证的物化视图；引用 CQRS（读写模型分离）以满足审计可追溯要求 — [arXiv 2602.23193](https://arxiv.org/html/2602.23193v1)
- PROJECTMEM（arXiv 2606.12329）：类型化事件（issue/attempt/fix/decision/note）追加式日志，确定性投影摘要；决策事件可带 supersedes 字段指向被取代的事件；不使用向量库 — [arXiv 2606.12329](https://arxiv.org/html/2606.12329)
- Springdrift（arXiv 2604.04660）：全部运行时状态可从追加式 JSONL 重放重建，任何事实可追溯到产生它的周期 — [arXiv 2604.04660](https://arxiv.org/pdf/2604.04660)
- "The Log Is the Agent"（Yohei Nakajima，2026-05）及评论：若 agent 自己写日志，会把幻觉编码进去，可靠性需要外部可验证、确定性的落地 — [llmtracker.de](https://llmtracker.de/en/news/the-log-is-the-agent-why-event-sourcing-might-be-the-real-backbone-of-autonomous)；[mdflow.cz](https://mdflow.cz/blog/event-sourced-agents)
- "Outcome ledger"：借鉴金融事件溯源，更正是新事件，历史永不覆盖 — [Daice Labs](https://daicelabs.com/insight/what-ai-cannot-remember-cannot-be-fixed)
- Operon：更正 = 关闭旧记录 + 追加新记录，带 supersedes 指针与来源字段 — [arXiv 2607.04240](https://arxiv.org/pdf/2607.04240)
- Google Memory Revisions：每次 create/update/delete 生成不可变快照，可回滚 — [Google 开发者论坛](https://discuss.google.dev/t/vertex-ai-agent-engine-introduced-memory-revisions/285496)
- Letta Context Repositories：用 git 对记忆做版本与合并 — [Letta](https://www.letta.com/blog/context-repositories/)
- Mem0 2026 算法抽取管线只追加、不覆盖、不删除 — [Mem0 迁移文档](https://docs.mem0.ai/migration/platform-v2-to-v3)

### Inferences
- Postgres 落地建议：`fact_events`（追加式，含 event_type、payload、source_archive_id、quote、actor=agent/human、recorded_at、supersedes_event_id）作为唯一写入口；`claims`、`relationships`、`verdicts` 作为投影表（可重建）。人工审核标签是事件而非字段更新。
- 派生分数版本化：`scores(person_id, domain, formula_version, computed_at, input_event_watermark, value)`——存"用哪版公式、基于截至哪条事件的输入"算出；公式升级时并存新旧版本而非覆盖，consult API 返回时注明 formula_version。这与项目既有规则（评分逻辑一变，score.ts 版本号同步）契合。
- 对外暴露"as-of 查询"：consult API 可接受 `as_of`（事务时间）参数，回答"在某日我们会给出什么结论"，用于调用方审计——这是 Graphiti 式双时态在产品层的直接价值。
- AI 抽取的事实（agent 写入）与人工确认的事实应在事件中区分 actor，且 AI 事件默认状态为待审，避免"日志固化幻觉"。

### Gaps
- 上述事件溯源论文多为 2026 年预印本，面向编码 agent，未见用于公共事实库的案例。
- 未找到 Postgres 生产级"事务时间"自动版本化方案的权威比较（如 temporal_tables 扩展、触发器方案在 2026 年的维护状态）。
