# 证据冻结、背景实时：把先验做成 agent 的可信事实源

截至 2026 年 10 月，agent 技术有两个变化最值得先验关注。第一，基础设施变成了「协议」：MCP 2026-07-28 版改为无状态、远程优先，长任务改由扩展承担；编排的共识是「单个写者，加只读、上下文隔离的子 agent」；持久执行已经成了标配。第二，所有做记忆、检索、核查的系统都撞在同一个短板上，就是没法可靠回答「这件事在 T 时刻是否为真，依据是哪段原文」。记忆产品在往追加写入、双时态、修订快照的方向走，但溯源只追到文本块（chunk）。端到端的自动核查在开放主张上依然很弱（AVeriTeC 2025 冠军 33.17%）。模型给的引用链接九成以上能打开，可是真正支持论断的只有 39–77%。所以先验现在的做法，即逐字比对存档原文、只追加的事件、版本化的分数，正好补在行业缺口上，方向是对的，不需要换路线。需要做的是三件事。一是把「证据冻结，背景实时」落成可执行的三档数据模型，并加上事务时间。二是把 consult 从查库接口升级成一个符合 MCP 新规范的「分层 agent」：默认零模型调用，慢核查走任务句柄。三是修好运营可靠性，包括熔断、抓取回退链、用结构化数据替代爬取，并把校准门槛改成置信区间下界加 κ。本报告背后的调研有个限制：研究员的网页抓取工具多数时候失败，大量数字来自搜索摘要和第三方转述。下文凡是厂商自报、二手或未核原文的数字都单独标出，做决策前应回到原始页面核对。

## 协议无状态化，编排收敛到「单写者」

**MCP 现行版本是 2026-07-28，相对 2025-11-25 有破坏性变更**。去掉了 `initialize` 握手和 `Mcp-Session-Id`，每个请求在 `_meta` 里自带协议版本和能力声明。新增必须实现的 `server/discover`。server 主动发起的 elicitation 和 sampling 改成 Multi Round-Trip Requests，即返回 `resultType:"input_required"`，由客户端带着补充输入重发。Tasks 移出核心，成为官方扩展 `io.modelcontextprotocol/tasks`（用 `tasks/get` 轮询，server 可以不经对方 opt-in 直接返回任务句柄）。Roots、Sampling、Logging 和 HTTP+SSE 传输被废弃。以上来自研究员唯一完整读到的官方原文 ([Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog))。对数据源型服务影响最大的几条是：`inputSchema`/`outputSchema` 放开到完整 JSON Schema 2020-12，`structuredContent` 可以是任意 JSON；`tools/list` 必须带 `ttlMs` 和 `cacheScope`；工具按确定性顺序返回，官方给出的理由是提高调用方 prompt cache 的命中率；`_meta` 支持 OTel traceparent ([Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog))。生态规模方面，第三方根据 Registry 公开 API 统计，**2026-10-14 有约 4.3 万个活跃 server，当月新发布的 server 中 78% 是远程的**，不过 62% 发布后再没更新过 ([DevToolHub](https://devtoolhub.com/mcp-registry-by-the-numbers/)，第三方统计)。A2A v1.0 已稳定并归 Linux Foundation 管理，Linux Foundation 称有 150+ 个组织支持 ([LF 新闻稿](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year))。但 A2A 解决的是 agent 之间的任务委派，先验的角色是被查询的数据源，MCP 已经够用。

框架层在收敛到同一组原语：agent loop、工具、子 agent 或 handoff、托管运行时。各厂商开始把 harness 本身做成托管服务。OpenAI 的 Agents API 于 2026-09-10 公测，后台模式支持 `background:true` 加 webhook ([OpenAI Changelog](https://developers.openai.com/api/docs/changelog)；[Background](https://developers.openai.com/api/docs/guides/background))。Claude Managed Agents 按每会话小时 $0.08 收费，10 月新增的 dynamic workflows 最多可以跑 1,000 个 agent，这两条都是二手来源 ([agent37](https://www.agent37.com/blog/claude-managed-agents-pricing))。多 agent 的结论很明确，**多 agent 的 token 消耗约为聊天的 15 倍**（Anthropic 2025，背景资料）([Simon Willison 摘要](https://simonwillison.net/2025/Jun/14/multi-agent-research-system/))。Cognition 在 2026-04 的总结是：真正能用的多 agent 系统范围都很窄，多个 agent 贡献智能，写操作保持单线程；并行写入的 swarm 仍然不行 ([Cognition](https://cognition.com/blog/multi-agents-working))。上下文方面，「把工具写成代码、按需加载」在 Anthropic 的示例里省了 98.7% 的 token，第三方实测是 75.5% ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp)；[Shevchenko](https://gregshevchenko.com/research/mcp-stack-token-economy/))。一套重型 MCP 配置启动时就占约 6.6 万 token ([particula](https://particula.tech/blog/code-execution-mcp-token-reduction-pattern)，第三方)。结论是先验的 consult 应该只暴露很少的工具，返回 ID 加摘要，原文按需取。

长时运行方面，**持久执行已经是生产 agent 的标配**。可选方案有 Temporal（4 个服务加数据库）、Restate 和 Inngest（单个二进制）、DBOS（一个库加 Postgres，工作流状态和业务数据在同一事务里提交）([Cadenya](https://cadenya.com/other-content/durable-execution-for-ai-agents)；[hackernoon](https://hackernoon.com/durable-execution-for-ai-agents-langgraph-dbos-inngest-and-temporal-compared))。先验已经有 Postgres 的 jobs 队列、跨进程限速和 AFP 预算，最省事的做法是照 DBOS 的思路，把每次模型或工具调用记成一个 step，崩溃后从最后一个 step 恢复，不必引入 Temporal。

国内生态对先验很实用。**方舟的内置 web_search、知识库检索、hosted MCP 和 remote MCP 都只能通过 Responses API 使用，Chat API 不支持**。remote MCP 走 Streamable HTTP，可以和自定义函数、web search 混用 ([方舟工具调用](https://www.volcengine.com/docs/82379/1958524))。「豆包搜索 Custom 版」用 `sources:["doubao"]` 启用 ([方舟 Web Search](https://docs.volcengine.com/docs/ark/web-search?lang=zh))。另有二手报道称，2026-07-28 开放的豆包搜索服务可以返回原网页 Markdown，每月 500 次免费 ([51allai](https://51allai.com/posts/2026/07/doubao-search-service/)，二手，未核原文)。如果属实，它能直接作为逐字比对的存档输入。

## 记忆系统走向追加加时间，但溯源只到文本块

2026 年的主流记忆产品已经不再是「向量库存聊天片段」，而是「抽取、只追加存储、多路融合检索、后台整理」。Mem0 的 2026-04 算法只做 ADD，从不覆盖或删除旧记忆 ([Mem0 迁移文档](https://docs.mem0.ai/migration/platform-v2-to-v3))。Google Memory Bank 的 Memory Revisions 对每次增删改都生成不可变快照，可以回滚 ([Google 开发者论坛](https://discuss.google.dev/t/vertex-ai-agent-engine-introduced-memory-revisions/285496))。Letta 把记忆放进 git 管理的文件系统 ([Letta](https://www.letta.com/blog/context-repositories/))。OpenAI 的 Dreaming 会在后台把「你 7 月要去新加坡」改写成「你在 2026 年 7 月去过新加坡」([OpenAI](https://openai.com/index/chatgpt-memory-dreaming/))。基准分数需要非常谨慎地看。Mem0 自报 LongMemEval 93.4–94.4 ([Mem0](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm)，厂商自报)，一份个人独立测试中它的开源版只有 32.4% ([DEV](https://dev.to/everest_an/-i-benchmarked-ai-agent-memory-in-2026-and-the-numbers-tell-a-different-story-than-the-marketing-2ae4)，个人博客)。MemPalace 的 96.6% 是检索召回率，不是问答准确率 ([arXiv 2604.21284](https://arxiv.org/html/2604.21284v1))。另一个信号对先验更关键：**Mem0 加上时间推理之后，knowledge-update 子项反而下降了 2.6 分** ([Mem0](https://mem0.ai/blog/the-token-efficient-memory-algorithm-now-has-temporal-reasoning)，厂商自报)。有研究测得检索器在「矛盾消解」类题目上只有 0.037 ([arXiv 2510.27246](https://arxiv.org/pdf/2510.27246))。可见「什么时候为真」不能靠 LLM 检索来保证，必须由显式数据模型保证。这些产品的「整理」和「改写」还会改动原始措辞，而预测判定恰恰需要原话的冻结版本。所以它们适合做调用方 agent 的记忆层，先验应当是这一层之外的权威事实源。

时间建模已经有成熟的参照。**Graphiti 给每条事实边记四个时间戳**：现实中的有效期 valid_at/invalid_at，以及入库和失效的事务时间 created_at/expired_at。遇到冲突时把旧边作废，不删除。官方例子是：Alice 的 CEO 任期 invalid_at=2024-01-01，系统直到 2025-03-15 才得知（expired_at）([Graphiti 双时态模型](https://mintlify.wiki/getzep/graphiti/concepts/temporal-model)；[arXiv 2501.13956](https://arxiv.org/pdf/2501.13956))。这里有一个直接可借鉴的教训：Graphiti 0.30.1 会把「预计将于某日结束」的边在入库时就当成已失效 ([issue #2012](https://github.com/getzep/graphiti/issues/2012))。2026 年的预印本 Operon 把同样的思路落成追加式事实库：更正等于关闭旧记录加追加新记录，带 supersedes 指针、来源和置信度 ([arXiv 2607.04240](https://arxiv.org/pdf/2607.04240))。TOKI 把「矛盾」形式化为主体和谓词相同、客体不同、有效期重叠 ([arXiv 2606.06240](https://arxiv.org/pdf/2606.06240))，这两篇都是未经同行评审的预印本。工程上，**Postgres 18 的主键和唯一约束已支持 `WITHOUT OVERLAPS`，外键支持 `PERIOD`，但事务时间（系统版本化）仍需自建** ([PostgreSQL 特性矩阵](https://www.postgresql.org/about/featurematrix/detail/temporal-constraints)；[Neon](https://neon.com/postgresql/18/temporal-constraints))。

溯源方面，LightRAG 在 2025-03 加入了把实体和关系链接回原始 chunk 的引用功能 ([LightRAG](https://github.com/hkuds/lightrag))，但没有时间有效性，也不要求逐字冻结。学术界的「主张–证据」追踪图（PROV-AGENT、LEDGER、2026 年的综述）都映射到 W3C PROV-DM，关系类型包括 support、contradict、invalidate、update ([arXiv 2606.04990](https://arxiv.org/html/2606.04990v4)；[arXiv 2608.18398](https://arxiv.org/pdf/2608.18398))。ClaimReview 的 schema.org 词汇仍然有效，但 Google 已于 2025-06 停止展示它的富结果 ([Poynter](https://www.poynter.org/ifcn/2025/google-claimreview-fact-checks-snippets-removed/))，现在主要价值是给 LLM 爬虫读。事件溯源这边，ESAA 让 agent 只输出校验过的结构化意图，由确定性的编排器写入追加日志再投影出视图 ([arXiv 2602.23193](https://arxiv.org/html/2602.23193v1))。业内的共同警告是：**如果 agent 自己写日志，日志会把幻觉固化进去**，必须有外部可验证的落地 ([mdflow.cz](https://mdflow.cz/blog/event-sourced-agents))。先验的 claim_events 加代码校验原文，正是这种外部落地。

缓存和新鲜度的工程共识是**三层失效：TTL 兜底，加版本键（prompt、模型、公式版本），加内容变更事件** ([FutureAGI](https://futureagi.com/blog/what-is-semantic-caching-llms-2026/)；[Barking Iguana](https://barkingiguana.com/writing/caching-llm-responses-without-stale-answers/))。TTL 只能限制陈旧的影响范围，不能保证正确 ([PyImageSearch](https://pyimagesearch.com/2026/05/04/semantic-caching-for-llms-ttls-confidence-and-cache-safety/))。语义缓存会把一次错误回答扩散给所有相似查询 ([TianPan](https://tianpan.co/blog/2026/04/20/cache-invalidation-ai-semantic-rag))。FreshCache 自报**只有 34.3% 的内容变化真正影响答案**，按哈希判定选择性失效，可以省 97% 的搜索调用 ([arXiv 2607.04281](https://arxiv.org/pdf/2607.04281)，作者自报)。对先验的含义是：维护「判定用到了哪些背景快照」这条依赖边，数据一变只重算受影响的判定。

## 搜索已经饱和，瓶颈在抓取和存档

Deep research 已经从聊天产品里的功能变成按任务付费的 API agent，架构基本统一为「规划器、并行子搜索、汇总、独立的引用核验步骤」([ByteByteGo](https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent)，二手)。但两大成品都不适合直接嵌进先验的流水线。**Gemini Deep Research API 不支持自定义 function calling，也不支持 structured output**，标准版单任务约 $1–3，Max 版约 $3–7 ([Google AI docs](https://ai.google.dev/gemini-api/docs/deep-research))。OpenAI 的 `o3-deep-research` 已于 2026-07-23 下线，替代方案是 GPT-5.6 加工具 ([OpenAI docs](https://developers.openai.com/api/docs/guides/deep-research))。BrowseComp 头部分数在 89–92.5% 之间，几个榜单互不一致，多为厂商自报，研究员没有逐一核对原页 ([BenchLM](https://benchlm.ai/benchmarks/browsecomp)；[Steel](https://leaderboard.steel.dev/leaderboards/browsecomp/)；[OpenRouter](https://openrouter.ai/benchmarks/browsecomp))。基准接近饱和，换模型的边际收益有限。另一条更说明问题：AgentDisCo 论文因为被引网页随时间 404 而放弃了 FACT 引用指标 ([arXiv 2605.11732](https://arxiv.org/pdf/2605.11732))。这和先验遇到的「搜索结果链接打不开」是同一个问题，结论也一样：引用必须当场存档。

搜索 API 的价格集中在 **$1–10/千次**。下表来自研究员抓到的价格页或搜索摘要，供选型时比较，需到官方页核实：

| 服务 | 价格（2026-10） | 特点 | 来源可信度 |
|---|---|---|---|
| 火山方舟联网内容插件 | 每月前 2 万次免费，之后 4 元/千次（垂类 6 元）；一轮可能并发多个关键词、多次计费，可用 `max_keyword` 限制 | 国内直连，最便宜 | 搜索摘要，原页 JS 渲染未抓到 ([计费](https://www.volcengine.com/docs/82379/1338550)) |
| Exa | Search 起价 $4/千次，Contents $1/千页 | 返回正文，可 livecrawl | 官方价格页 ([Exa](https://exa.ai/pricing))；第三方称 3 月已涨价 |
| Parallel | Search $0.001–0.005/次，Extract $0.001/次 | 压缩摘录，Task API 带 citations | 官方价格页 ([Parallel](https://parallel.ai/pricing)) |
| Perplexity Search | $5/千次（Fast $1） | 失败请求不计费 | 官方价格页 ([Perplexity](https://docs.perplexity.ai/getting-started/pricing)) |
| Brave | 约 $5/千次 | 自有索引，延迟 669ms | 厂商引用第三方测试 ([Brave](https://brave.com/search/api/)) |
| Claude web_search | $10/千次 | 域名白名单和黑名单 | 官方文档 ([Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)) |

质量排名只有竞品博客转引的 Artificial Analysis 指数（Parallel 75、Exa 74、Tavily 66）([fastcrw](https://fastcrw.com/blog/web-search-api-pricing-2026)，未核原页)。从国内访问海外 API 的稳定性，没有找到任何可靠资料。

抓取层，Jina Reader（在 URL 前加 `r.jina.ai` 转成 Markdown，可选浏览器引擎和 OCR）([Jina](https://jina.ai/reader/)) 和 Firecrawl（1 credit 抓一页，没返回结果的抓取不计费）([Firecrawl](https://www.firecrawl.dev/pricing)) 能处理 JS 渲染的页面。Claude 的 web_fetch 文档明确写了不渲染 JS ([Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool))。云浏览器 Browserbase 超出套餐后约 $0.10–0.12/浏览器小时，付费档自带验证码处理 ([Browserbase](https://www.browserbase.com/pricing))。自动过验证码可能违反目标网站的服务条款，先验不应启用。浏览器 agent 在 Online-Mind2Web 上自报 97–98% ([Yutori](https://yutori.com/leaderboards/online-mind2web)；[Browser Use](https://browser-use.com/posts/online-mind2web-benchmark))，但 Steel 指出各家评审口径不同，不能横比 ([Steel](https://leaderboard.steel.dev/leaderboards/online-mind2web/))。先验的任务是「打开页面拿到原文」，只有登录或翻页时才用得上浏览器 agent。

存档方面，**Wayback 的 Save Page Now（SPN2）是首选的第三方中立存档**，但限流很严：429 提示要求每分钟不超过 15 次，超限可能被封 IP，wayback 库在 2026-06 把 CDX 查询的默认速率降到 24 次/分 ([spn-scripts](https://github.com/overcast07/wayback-machine-spn-scripts)；[wayback docs](https://wayback.readthedocs.io/en/latest/usage.html))。SPN2 的并发和日限额只找到一份 4.5 年前的非官方副本。**archive.today 在 2026-02 被英文 Wikipedia 拉黑，理由之一是篡改已存档页面的内容** ([Heise](https://www.heise.de/en/news/Hundreds-of-thousands-of-links-Wikipedia-bans-Archive-today-after-cyberattack-11185344.html))，不应再作为证据来源。

对先验的机构敞口问题，最重要的发现是**这部分数据不必爬**。SEC 的 data.sec.gov API 免费、无需 key，submissions 延迟通常不到 1 秒，XBRL 不到 1 分钟 ([SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces))。访问上限是 10 次/秒，必须带包含邮箱的 User-Agent ([tldrfiling](https://tldrfiling.com/blog/sec-edgar-api-rate-limits-best-practices))。要注意 companyfacts 和 frames 只有无维度的事实，分地区收入要从 Financial Statement & Notes 数据集的 DIM 表（如 `StatementGeographicalAxis`）或单份 filing 的 XBRL 里取 ([SEC FSN](https://www.sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets))。各公司用的收入 tag 也不统一，要依次试 2–3 个候选 ([dev.to](https://dev.to/northpine-studio/revenue-by-year-from-sec-edgar-in-python-three-traps-in-the-xbrl-api-3goh))。XBRL 事实自带单位和 taxonomy，正好对上「单位丢失、分类错误」这两类死数据。供应商和大客户集中度只出现在 10-K 正文里，这部分仍需全文检索加逐字校验。

## 核查仍需人兜底，90% 门槛在统计上不够

在开放主张上，端到端自动核查依然很弱。**AVeriTeC 2025 冠军只有 33.17%**（限开源模型、单 GPU、每条 ≤1 分钟）([ACL Anthology](https://aclanthology.org/2025.fever-1.15/))。引用质量是更直接的警报：14 个模型的链接有效率 >94%，**事实准确率只有 39–77%**，工具调用次数从 2 增加到 150 时，准确率平均下降约 42% ([arXiv 2605.06635](https://arxiv.org/pdf/2605.06635))。医学领域里，带搜索的 GPT-4o 只有 55% 的回答被自己的引用完全支持 ([Nature Comms](https://www.nature.com/articles/s41467-025-58551-6))。先验用代码比对存档原文，是对这个问题最便宜、最硬的防线。主张拆分还有一个风险，去语境化会改变原意、增加遗漏 ([arXiv 2505.09701](https://arxiv.org/pdf/2505.09701))，所以拆分后的子主张也要逐条做逐字溯源检查。

第二个模型有没有用，取决于它是不是**另一个模型家族**。EMNLP 2025 的研究发现，自洽的错误不随模型变大而减少，而不同 LLM 的自洽错误往往不一样 ([ACL 2025.emnlp-main.238](https://aclanthology.org/2025.emnlp-main.238/))，因此跨模型分歧比同模型多次采样更适合当「送人工」的信号 ([arXiv 2604.17112](https://arxiv.org/pdf/2604.17112))。最接近先验场景的实证来自 FutureSearch 的预测题判定：3 个联网 agent 独立判定，不一致时由另一家族的模型仲裁，**约 8.7% 的题出现分歧，人工抽查 100 题的错误率是 4.9%（95% CI 1.6–9.8%）** ([arXiv 2601.22444](https://arxiv.org/abs/2601.22444))。至于辩论，它能否胜过简单投票，证据并不一致 ([arXiv 2511.07784](https://arxiv.org/pdf/2511.07784))，先验没必要上辩论。

LLM-as-judge 的校准有一个直接影响先验发布门槛的结论。**UC Berkeley 评测了 21 个裁判模型，原始一致率比经机会校正的区分能力高估 33–41 个百分点，无一例外** ([arXiv 2606.19544](https://arxiv.org/abs/2606.19544))。一个只会判「通过」的裁判也能拿到约 90% 的一致率 ([tomrochette](https://tomrochette.com/agents/people-and-publications/hamel-husain/))。业界常用的门槛是 κ ≥ 0.6 可用、≥ 0.8 强，校准集 100–300 条 ([FutureAGI](https://futureagi.com/blog/llm-as-judge-best-practices-2026/)，厂商博客，未经同行评审)。拿先验的方案来算，100 条里观察到 90% 一致，95% 二项置信区间大约是 82–95%，下界远低于 90%。要让下界达到 90%，100 条里需要观察到约 96% 的一致，或者把样本扩到几百条（这是研究员的推算，我用 Wilson 区间复核过）。四类判定的分布很不均衡，「已兑现」或「未兑现」可能占大头，只看总一致率会掩盖「部分兑现」和「证据不足」上的失败。少量人工标签可以用 PPI 方法族放大成带有效置信区间的估计，分层的 StratPPI 区间更窄 ([StratPPI](https://proceedings.neurips.cc/paper_files/paper/2024/file/c9fcd02e6445c7dfbad6986abee53d0d-Paper-Conference.pdf))。言行一致性的判定更主观，GPT 裁判与单个标注员的匹配率只有 0.728 ([arXiv 2511.17813](https://arxiv.org/pdf/2511.17813))，不适合按同一门槛自动公开。

计分口径必须公开，并且写死在公式里。同样是追踪 Musk 的预测，**各站口径不同，命中率从 7% 到 24% 不等**：MuskOmeter 晚兑现计 50% 分，得 24% ([muskometer](https://www.muskometer.com/))；Clearer Thinking 只保留有明确截止且已过期的 43 条，得 16.28% ([Clearer Thinking](https://www.clearerthinking.org/post/how-good-is-elon-musk-at-predicting-the-future-and-what-would-it-take-to-become-an-accurate-predict))；Tesorb 只按具体时限判，约 7% ([Tesorb](https://tesorb.com/elon-musk-predictions-tracker/))。twoweeks.lol 把 443 条陈述合并为 336 条预测，并单独列出 125 条「挪了球门」 ([twoweeks.lol](https://twoweeks.lol/))。Metaculus 对作废和模糊的题不计分，历史作废率约 8% ([Metaculus FAQ](https://www.metaculus.com/faq/)；[arXiv 2601.22444](https://arxiv.org/abs/2601.22444))。PolitiFact 用 Compromise 表示「明显少于承诺，但仍是与目标一致的重要成果」，评级可以反转 ([PolitiFact](https://politifact.com/article/2018/feb/12/principles-truth-o-meter-politifacts-methodology-i/))。ForecastBench 改用双向固定效应，按题目难度做调整 ([ForecastBench 方法](https://www.forecastbench.org/assets/pdfs/forecastbench_updated_methodology.pdf))。每类不到 20 题时 Brier 噪声极大 ([arXiv 2507.04562](https://arxiv.org/html/2507.04562v3))，这也支持先验坚持用 80% 区间而不是点估计。安全方面，核查 agent 面对的不只是隐藏指令。**「Attacks by Content」只需提供有偏或虚假的网页就能误导检索 agent，现有的注入检测对此无效**，论文给的防御是主动寻找支持和反驳的证据，再比较可信度 ([arXiv 2510.11238](https://arxiv.org/html/2510.11238))。

## 评测、可观测性与成本：Postgres 日志已经够用

评测方法在 2025–2026 年已经基本一致。第一步是人工读 trace 做错误分析，先拿约 100 条，前 30 条亲手标。能用代码判定的先用代码，剩下的用输出二元 Pass/Fail 的 LLM judge，并用人工标签算 TPR/TNR 来校准 ([hamel.dev FAQ](https://hamel.dev/blog/posts/evals-faq/))。Anthropic 建议把评测分成能力评测（起步通过率低，用来往上爬）和回归评测（应接近 100%，用来防退化），从真实失败里挑 20–50 个任务起步，并且优先检查结果状态，而不是 agent 自己怎么说 ([ai-eval.org 转述](https://ai-eval.org/post/anthropic-demystifying-evals-for-ai-agents)，原文未读到)。稳定性用 **pass^k**（k 次全部成功的概率）衡量。τ-bench 里 gpt-4o 零售域的 pass^1 约 61%，pass^8 不到 25% ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045))。对先验来说，同一条到期判定跑 3 次结论是否一致，就是最该盯的公信力指标。

可观测性的事实标准是 **OTel GenAI 语义约定**（`invoke_agent`、`execute_tool`、`gen_ai.usage.input_tokens` 等），但它仍处于 Development 阶段 ([DEV](https://dev.to/gabrielanhaia/opentelemetry-genai-semantic-conventions-your-llm-traces-should-look-like-this-in-2026-3ff6)；[Uptrace](https://uptrace.dev/blog/opentelemetry-ai-systems))。2026 年行业整合很剧烈：ClickHouse 收购了 Langfuse ([GitHub](https://github.com/orgs/langfuse/discussions/11593))；Helicone 被 Mintlify 收购后进入维护模式，关闭了新用户注册 ([Helicone](https://www.helicone.ai/blog/joining-mintlify))；Promptfoo 并入 OpenAI ([developersdigest](https://www.developersdigest.tech/blog/llm-observability-acquisitions-2026))。字节的 CozeLoop 以 Apache 2.0 开源，官方写明集成了火山方舟 ([GitHub](https://github.com/coze-dev/coze-loop))。但它是 Go 写的重型平台；Langfuse 自托管的最低配置约 9 vCPU，还要带 ClickHouse ([costbench](https://costbench.com/software/ai-observability/langfuse/)，第三方)。OTel 官方不支持 Bun，需要手动埋点 ([Datadog](https://docs.datadoghq.com/opentelemetry/guide/instrument_unsupported_runtimes/))。综合下来，对 1–2 人团队，最合算的是**「每次调用一行写进 Postgres，再用 SQL 或 Grafana 出图」**，这是社区里常见的做法。按 key 统计花费这类高基数聚合，用 SQL 比 Prometheus 更合适 ([llm-gateway PR](https://github.com/AndrewTtofi/llm-gateway/pull/6))。ark_calls 已经是这张表，只需要把字段名对齐 OTel GenAI，并补上 run_id、claim_id、prompt_version。监控方面，厂商博客给的起点参考是：基础指标全量记录，LLM judge 抽样 1–20%，预算在 50/80/100% 三档告警 ([Future AGI](https://futureagi.com/blog/production-llm-monitoring-checklist-2026/)，厂商建议，不是行业标准)。

成本的最大杠杆在方舟内部就有。**doubao-seed-2.1-pro 输入 6 元、缓存命中 1.2 元、输出 30 元（每百万 token）；2.1-lite 是 0.8/0.16/2.7；seed-2.0 及之后的模型在线推理默认开启隐式缓存，不能关闭** ([方舟模型价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh))。**批量推理的输入输出按在线价五折** ([方舟模型价格](https://www.volcengine.com/docs/82379/1099320))。方舟价格页是 JS 渲染的，部分数字来自搜索摘要，上线前请用 `arkcli pricing` 再核一次。pro 和 lite 的输出价差约 11 倍，足以支撑一个级联：lite 初判，代码校验原文，校验失败或跨模型分歧时再升级到 pro。代码校验本身就是最便宜的升级判据。

## 落到先验：三档数据、分层 consult、可靠运营

### 三档数据把「证据冻结，背景实时」变成可执行的规则

团队的原则草案方向正确，但缺两块：「实时背景一旦被判定用到怎么办」，以及「我们当时知不知道」。综合上面的研究，建议把所有数据归入下表三档，再加一类派生数据。

| 档位 | 包含什么 | 存储方式 | 失效方式 | 依据 |
|---|---|---|---|---|
| 冻结证据 | 主张原话及存档（原始字节 + SHA-256 + 提取正文 + SPN2 URL）、到期判定及其所用证据、利益关系区间、人工标签 | 只追加；更正 = 新事件 + supersedes | 永不失效，只能被更正事件取代 | Operon ([arXiv 2607.04240](https://arxiv.org/pdf/2607.04240))；ESAA ([arXiv 2602.23193](https://arxiv.org/html/2602.23193v1)) |
| 事件失效的半持久数据 | 机构敞口：地区营收、主要客户和供应商、合同 | 结构化来源 + accession 号 + 单位 + as_of | 该 CIK 有新 10-K/10-Q/8-K 时失效；TTL 约 100 天兜底 | SEC submissions 实时更新 ([SEC](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)) |
| 实时背景 | 最新新闻、股价、近期言论 | 默认不入库；返回时带 as_of、source_url、expires_at | 小时级 TTL 或不缓存 | TTL 参考值 ([myengineeringpath](https://myengineeringpath.dev/genai-engineer/llm-caching/)) |
| 派生数据 | 领域先验分数、兑现率 | score_snapshots：formula_version + input_event_watermark | 公式升版时新旧并存，按新版本重算 | 版本键失效 ([FutureAGI](https://futureagi.com/blog/what-is-semantic-caching-llms-2026/)) |

最关键的一条硬规则是：**实时背景只用于展示；一旦被某个判定或利益关联用到，就在那一刻快照冻结，升入第一档，否则判定无法复现**。利益关系表要做成双时态：`valid_period tstzrange` 表示现实中的任职或持股区间，用 Postgres 18 的 `WITHOUT OVERLAPS` 防止同一人同一职位的任期重叠（公司要放进主键，以允许合法地同时担任多家公司职务）。`recorded_at/superseded_at` 表示我们何时得知、何时更正。再加一个 `end_kind`（actual/scheduled/unknown），避免 Graphiti #2012 那种把「预计结束」当成「已结束」的错误 ([issue #2012](https://github.com/getzep/graphiti/issues/2012))。这样「发言当天他有没有利益关联」是一次有效时间的时点查询，「我们判定时知不知道」是一次事务时间查询。AI 抽取的关系作废或更正，应该以 actor=agent 的待审事件写入，不能像 Graphiti 那样由 LLM 直接生效。

这套分档直接对应近期的死数据问题。一次性全量爬取的敞口数据，既没有失效触发，也没有单位和分类上的结构保证。建议把现有敞口数据整体标为「未验证、待重采」，对美股公司改从 SEC 的 XBRL 维度数据取，每个数字带 accession 号；只有供应商和客户集中度这类正文信息才走「检索、存档、逐字校验」。港股和 A 股缺少等价的结构化来源，调研没有覆盖，是一个已知空白。

### consult 应该是三层 agent，默认零模型调用

consult 变成「真正的 agent」，不等于每次查询都跑一个 LLM 循环。对调用方 AI 来说，最有价值的是快、确定、可审计的结构化先验。建议按延迟和成本分三层，全部挂在一个符合 2026-07-28 规范的无状态 Streamable HTTP MCP server 上，工具控制在 3–5 个，按确定性顺序返回并带 `ttlMs`。

第一层是查询，零模型调用，毫秒级。用纯 SQL 回答「某人在某领域的先验」，通过 `outputSchema` 和 `structuredContent` 返回：领域分数和 80% 区间、样本量、四类判定计数、按发言日期计算的有效利益关联、formula_version、as_of，以及每条判定是自动公开还是人工复核过的。溯源字段用 PROV 词汇（wasDerivedFrom、generatedAtTime）表达，判定页可以零成本附带 ClaimReview JSON-LD ([Poynter](https://www.poynter.org/ifcn/2025/google-claimreview-fact-checks-snippets-removed/))。这一层还应支持 `as_of` 参数，回答「在某日先验会给出什么结论」，供调用方审计。这是双时态在产品层最直接的价值。

第二层是背景补充，秒级。当调用方问「这个人现在和 X 公司还有关系吗」，agent 用方舟 Responses API 挂上 web_search（加 `max_keyword` 限制关键词数）和先验自己的工具 ([方舟工具调用](https://www.volcengine.com/docs/82379/1958524))，由 lite 模型综合，返回结果明确标为「背景，非证据」，并带 as_of 和 expires_at。

第三层是核查新说法，分钟级。调用方提交一条新说法，server 用 tasks 扩展直接返回任务句柄 ([Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog))。后台 agent 依次做检索、存档、逐字校验、跨家族模型判定，结果作为「待审候选主张」写入事件，审核通过前不进入公开分数。这三层都是单 agent 加少量工具，不需要多 agent。抓取到的网页一律当作数据，判定理由只能引用逐字校验过的存档原文；只有单一来源支持的判定，要求补足两个独立来源，作为对 Attacks by Content 的防御 ([arXiv 2510.11238](https://arxiv.org/html/2510.11238))。分发渠道可以考虑扣子插件和 MCP Registry，扣子已内置 MCP client ([OpenAI Hub](https://www.openai-hub.com/news/567/)，二手)，不过扣子对 2026-07-28 新规范的支持情况未知。

### 运营可靠性：熔断、回退链、可防御的校准

112 次搜索连续失败而任务没有暂停，本质上是缺少按错误类型划分的熔断。具体做法是：在 ark_calls 上按 kind 和 caller，以 5–15 分钟为窗口算失败率；先把错误文本归成鉴权或未开通、网络、限流、解析失败、内容失败几类；鉴权或未开通类第一次出现就暂停整个 job，网络类连续 N 次失败后指数退避并暂停。每个批量 job 启动时先做一次搜索和抓取的预检调用，避免「联网搜索未开通」这种问题烧掉一整批预算。这些是研究员根据监控实践推出来的做法，没有找到专门针对外部依赖中断的公开案例 ([Future AGI](https://futureagi.com/blog/production-llm-monitoring-checklist-2026/))。链接打不开的问题，用一条回退链解决：先直连，加重试和退避；失败了用 Jina 或 Firecrawl 渲染 JS；还不行再开真浏览器；最后退到 Exa Contents 或 Parallel Extract 的缓存全文。每一步都保存原始字节、哈希和抓取时间，并标明「供应商缓存」还是「实时抓取」，逐字匹配只认实际拿到的字节 ([Jina](https://jina.ai/reader/)；[Exa](https://exa.ai/pricing))。

校准方案建议这样改。把「100 条、一致率 ≥ 90%」改成「95% 置信下界 ≥ 90%，且每类 κ ≥ 0.8」，并按判定类别、领域、模型是否分歧分层抽样，过采样「部分兑现」和「证据不足」。另做一轮双人标注，测出人与人的 κ 作为天花板。自动公开的通道只放行「代码校验通过、跨家族模型一致、pass^3 稳定」的判定；有分歧的送人工，参考 FutureSearch 的约 9% 分歧率 ([arXiv 2601.22444](https://arxiv.org/abs/2601.22444))；言行一致性判定默认走人工。计分规则要明确写进公式：「部分兑现」对应一个公开的分值；「证据不足」按作废处理，不计分，并公开作废率；重复承诺和改期合并为一条带时间线的预测。按项目规则，这些都属于评分逻辑的变化，score.ts 版本号、SPEC、方法页和 consult 输出要一起改。

### 优先级路线图

| 优先级 | 时间 | 事项 | 解决的问题 |
|---|---|---|---|
| P0 | 0–2 周 | 按错误类型熔断并自动暂停 job；启动预检；预算 50/80/100% 告警；ark_calls 补 run_id、claim_id、prompt_version | 112 次连续失败、联网搜索未开通 |
| P0 | 0–2 周 | 存档标准：原始字节 + SHA-256 + 提取正文 + 异步 SPN2（≤10 次/分，带退避）；抓取回退链；禁用 archive.today | 链接打不开、证据不可复现 |
| P0 | 0–2 周 | 冻结全量爬取的敞口数据并标为未验证；美股敞口改用 SEC XBRL 和 FSN，带 accession 号和单位 | 死数据 |
| P1 | 2–6 周 | 校准协议：置信下界、κ、分层抽样、双人标注；计分口径（部分兑现、作废、合并改期）随公式升版 | 自动公开门槛不可防御 |
| P1 | 2–6 周 | 利益关系改为双时态（valid_period + recorded_at/superseded_at + end_kind）；判定与背景快照之间的依赖边 | 「发言当日」和「当时是否已知」 |
| P1 | 2–6 周 | consult 第一层：2026-07-28 无状态 MCP，structuredContent + outputSchema，as_of 查询，formula_version | consult 成为可信事实源 |
| P1 | 2–6 周 | 批量 job 改走方舟批量推理（五折）；固定前缀放在最前以命中隐式缓存；lite 到 pro 的级联 | 成本 |
| P2 | 6–12 周 | eval_cases、eval_runs 表；pass^3 稳定性和单次成功成本面板；改 prompt 或换模型前跑回归 | 防退化 |
| P2 | 6–12 周 | 跨家族模型判定，分歧送人工；双源检索（方舟负责中文，Exa 或 Parallel 负责英文并限定域名） | 判定准确率、英文覆盖 |
| P2 | 6–12 周 | consult 第二、三层（背景补充 + tasks 句柄核查）；事件触发：截止日到期、SEC 新文件、人物新发言 | consult agent 化、数据新鲜度 |
| P3 | 之后 | 视需要接 CozeLoop 或 Phoenix；ClaimReview 和 PROV 对外输出；扣子和 Registry 分发；港股和 A 股结构化来源 | 生态与覆盖面 |

## Conclusion

这轮调研最重要的一点认识是：行业在 agent 能力上的进步（BrowseComp 逼近饱和、浏览器 agent 自报 97%、记忆分数九十多分），几乎没有触及先验真正依赖的那一层，也就是「某句话在某天由某人说出，并且原文仍然可查」。记忆产品会改写措辞，deep research 的引用会 404，judge 的一致率会虚高三四十个百分点。因此先验的护城河不在模型或检索，而在冻结证据、双时态关系和可复算的分数这套纪律。agent 技术应该用来降低这套纪律的执行成本，比如批量推理、级联、熔断和回退链，以及扩大它的服务面，比如无状态 MCP、任务句柄和 as_of 查询，而不是替代它。

还有一个容易被忽视的推论：在一个被注入攻击和低质引用充斥的环境里，「哪些判定是自动公开的、置信下界是多少、哪些背景已经过期」本身就是对调用方 AI 最有价值的信号。把不确定性写进输出 schema，而不是藏在后台，应该成为 consult 的首要设计原则。这也是先验区别于搜索 API 和记忆层、值得被别的 agent 优先调用的理由。
