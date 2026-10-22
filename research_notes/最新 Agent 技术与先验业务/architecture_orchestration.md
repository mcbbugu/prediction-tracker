# Agent 架构与编排、成本与延迟控制（截至 2026-10）

> 方法说明：基于 2026-10-22 的网络检索。WebFetch 对多数页面失败（返回模型错误），只成功抓取了 MCP 2026-07-28 官方 changelog 全文；其余条目来自搜索结果摘要，很多是第三方二手来源，已逐条标注。早于 2025 年的内容标为「背景」。

## 1. 工具调用与 MCP（及 A2A 等相关协议）

### Takeaway
MCP 当前版本是 **2026-07-28**，相对 2025-11-25 有破坏性变更：核心改成无状态，去掉握手和会话；server 主动发起的请求（elicitation、sampling）改成 Multi Round-Trip Requests；Tasks（长任务）改成可选扩展；Sampling、Roots、Logging 被废弃。官方 Registry 已有约 4.3 万个 server，大部分新 server 是远程的。A2A v1.0 是第一个稳定版，归 Linux Foundation 管理。对先验来说，最该先做的是：把 consult 做成符合 2026-07-28 规范的远程无状态 Streamable HTTP MCP server，返回 structuredContent 加 outputSchema；需要慢速核查的请求，用 tasks 扩展返回任务句柄。

### Cited Findings
**MCP 2026-07-28 规范（官方 changelog，全文已读）**
- 发布节奏：5 月 21 日锁定 RC，经过 10 周验证，7 月 28 日定稿，取代 2025-11-25（2025-11-25 是首次加入实验性 tasks 的版本）。— [MCP Blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)；[RC 公告](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- 去掉协议级会话和 `Mcp-Session-Id`。`tools/list` 等不再随连接变化；需要跨调用状态时，由 server 生成句柄，作为普通工具参数传递（SEP-2567）。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- 无状态：删除 `initialize`/`initialized` 握手。每个请求在 `_meta` 里带协议版本和客户端能力。新增必须实现的 `server/discover`（SEP-2575）。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- `subscriptions/listen` 取代 HTTP GET 端点和 `resources/subscribe`。去掉 `ping`、`logging/setLevel`。去掉 SSE 断点续传（`Last-Event-ID`），流断开后客户端必须换新 ID 重发请求（SEP-2575）。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- **Tasks** 移出核心，成为官方扩展 `io.modelcontextprotocol/tasks`：用 `tasks/get` 轮询，新增 `tasks/update`（客户端中途补充输入），删除 `tasks/list`，server 可以不经请求方 opt-in 直接返回任务句柄（SEP-2663）。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- **MRTR（SEP-2322）**：server 返回 `resultType:"input_required"` 和 `inputRequests`，客户端重试原请求时带上 `inputResponses`，以此取代 server 主动发起的 `elicitation/create`、`sampling/createMessage`、`roots/list`。所有结果都必须带 `resultType`。URL 模式 elicitation 的 `elicitationId` 和完成通知被删除。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- 结构化输出：`inputSchema` 和 `outputSchema` 放开到完整 JSON Schema 2020-12，`structuredContent` 可以是任意 JSON 值（SEP-2106）。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- 缓存相关：`tools/list` 等结果必须带 `ttlMs` 和 `cacheScope`（SEP-2549）。server 应以确定性顺序返回工具，原文目的是「提升 LLM prompt cache 命中率」。Streamable HTTP POST 必须带 `Mcp-Method`/`Mcp-Name` 头，便于网关路由（SEP-2243）。`_meta` 支持 OpenTelemetry traceparent（SEP-414）。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- 鉴权加固：校验 RFC 9207 的 `iss`（SEP-2468）。凭证按 issuer 绑定（SEP-2352）。动态客户端注册（DCR，RFC 7591）被废弃，改用 Client ID Metadata Documents（PR #2858）。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- 废弃 Roots、Sampling、Logging（SEP-2577）。HTTP+SSE 传输正式进入 Deprecated。新增特性生命周期政策，废弃窗口至少 12 个月（SEP-2596）。另外新增扩展框架和 MCP Apps。— [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)；[MCP Blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- MCP 由 Linux Foundation 旗下的 Agentic AI Foundation（AAIF）托管，AAIF 发布了迁移指南。— [AAIF](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate)

**Registry 与生态规模（第三方统计，数据取自 registry.modelcontextprotocol.io 公开 API）**
- 2026-10-14：官方 Registry 有 43,012 个活跃 server（共 150,595 个版本）。另一统计为 43,298 个，30 天内增长 36%。2026 年 3 月只有 3,012 个。每月新增从 3 月的 1,894 个涨到 9 月的 11,809 个。Registry 于 2025 年 9 月进入 preview，没有找到 GA 声明。— [DevToolHub](https://devtoolhub.com/mcp-registry-by-the-numbers/)；[LocalCan](https://www.localcan.com/blog/state-of-mcp-server-development)；[circadian-agent](https://circadian-agent.com/research/mcp-registry)
- 当月新发布的 server 中 78% 带远程 URL（2025 年 12 月是 27%）。62% 的 server 发布一次之后再没更新。npm SDK 在截至 2026-10-05 的一周内下载 7,670 万次。— [DevToolHub](https://devtoolhub.com/mcp-registry-by-the-numbers/)；[oktopost](https://www.oktopost.com/blog/mcp-registry-legacy-servers/)
- 大厂托管 MCP（二手来源）：AWS Agent Toolkit MCP 于 2026 年 5 月 GA，60+ 个 server；Google Cloud Managed MCP 在 Cloud Next '26 发布，50+ 个 server；Microsoft 有 Azure MCP Server。— [gravity.fast](https://gravity.fast/data/mcp-adoption-statistics/)
- OpenAI 的 Responses API 自 2025 年起支持 remote MCP（背景）。— [OpenAI](https://openai.com/index/new-tools-and-features-in-the-responses-api/)

**A2A 等**
- A2A 由 Google 于 2025-04-09 发布，2025-06-23 捐给 Linux Foundation。v1.0 是第一个稳定版：签名 Agent Card（JWS + JCS）、多租户、版本协商，绑定 JSON-RPC、gRPC 等多种传输。一周年时（2026-04-09）有 150+ 个组织支持，已集成进 Google、Microsoft、AWS 平台，有 5 种语言的 SDK。— [Linux Foundation 新闻稿](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)
- v1.0 的发布日期有冲突：一说 2026-03-12。还有二手来源称已有 v1.2，未经官方证实。— [Wikipedia](https://en.wikipedia.org/wiki/Agent2Agent)；[rapidclaw](https://rapidclaw.dev/blog/a2a-protocol-complete-guide-2026)
- Microsoft Agent Framework 1.0 于 2026-04-03 GA，合并了 Semantic Kernel 和 AutoGen，原生支持 MCP 和 A2A（二手来源）。— [Alice Labs](https://alicelabs.ai/en/insights/best-ai-agent-frameworks-2026)

### Inferences
- 规范已转向无状态和远程优先。先验的 consult 本来就是只读查询，天然适合无状态 server，不需要会话。
- 「真伪核查」这类慢请求（需要现场抓取页面、跑 verifier）可以用 tasks 扩展返回句柄，让调用方轮询，不要同步阻塞。
- outputSchema 加 structuredContent 能让调用方 AI 直接拿到「领域先验分、样本量、兑现率、利益冲突」这样的结构化字段。
- 工具列表保持确定性顺序，加上 ttlMs，同时利好调用方的 prompt cache。
- A2A 面向的是 agent 之间的任务委派。先验作为「被查询的数据源」，MCP 已经够用，A2A 优先级低。

### Gaps
- MCP Registry 是否 GA、MCP Apps 的细节、各 Tier 1 SDK 版本号：官方博客正文未能抓取。
- OpenAI、Anthropic、Google 对 2026-07-28 版本的具体支持日期，没有找到一手来源。
- ACP（IBM/BeeAI 的 Agent Communication Protocol）2026 年的状态没有检索到。

## 2. 2026 年的 Agent 框架与 SDK

### Takeaway
各家框架都在收敛到同一组原语：agent loop、工具、子 agent 或 handoff、可选的图编排、托管运行时。厂商在把「harness」本身托管化，例如 Anthropic Claude Managed Agents 和 OpenAI Agents API。TypeScript 栈的主流选择是 Vercel AI SDK 6 和 Mastra。

### Cited Findings
- **Claude Managed Agents**：2026-04-08 公测，提供托管沙箱、会话持久化、多 agent 协作。计费是 token 费用加每会话小时 $0.08（按毫秒计，只在 running 状态计费），web search 每千次 $10，不适用 Batch 折扣。10 月 9 日加入 dynamic workflows（beta），一个 agent 写程序就能分阶段跑最多 1,000 个 agent，并发 64。以上均为二手来源。— [agent37](https://www.agent37.com/blog/claude-managed-agents-pricing)；[imisofts](https://imisofts.com/blog/claude-managed-agents-pricing/)
- **OpenAI**：2026-09-10 Agents API 公测，用托管的 Codex harness 处理会话编排、上下文压缩和故障恢复。2026 年 5 月推出 TypeScript 版 Agents SDK，支持 sandbox agents，并为 web search 工具加了 `return_token_budget`。2026-10-20 支持 12 小时 prompt cache。— [OpenAI Changelog](https://developers.openai.com/api/docs/changelog)
- **OpenAI Background mode**：设 `background:true` 异步执行，可轮询，也可用 webhook 接收完成事件。— [OpenAI Docs](https://developers.openai.com/api/docs/guides/background)
- **LangGraph** 1.0 于 2025-10 发布（LangChain 1.0 于 2025-10-22 发布，带 create_agent 和 middleware）。2026 年 8 月新增节点缓存、deferred nodes（fan-in）、模型前后钩子。最新版 1.2.12（2026-09-21）。PyPI 月下载约 7,160 万。— [Firecrawl](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks)；[uvik](https://uvik.net/blog/agentic-ai-frameworks/)
- **Mastra** 于 2026-01 发布 1.0，@mastra/core 1.71.0（2026-09-24），npm 月下载约 560 万。— [uvik](https://uvik.net/blog/agentic-ai-frameworks/)；[Alice Labs](https://alicelabs.ai/en/insights/best-ai-agent-frameworks-2026)
- **Vercel AI SDK 6**：提供 Agent 抽象（stopWhen）、工具审批、完整 MCP 支持、DevTools，月下载 2,000 万+。— [Kernel](https://www.kernel.sh/ai-library/top-ai-agent-frameworks-2026)
- **Google ADK**：2.0 支持 Graph Workflows（确定性代码和 agent 节点混合），覆盖 5 种语言，最新版 2.10.0（2026-09-25）。— [uvik](https://uvik.net/blog/agentic-ai-frameworks/)
- 选型建议：复杂的 Python 工作流用 LangGraph，要类型安全用 Pydantic AI，TypeScript 用 Mastra 或 Vercel AI SDK，绑定单一厂商就用厂商 SDK。— [Langfuse](https://langfuse.com/blog/2025-03-19-ai-agent-comparison)（2025 年文章，背景）

### Inferences
- 先验用的是 Bun 和 Ark。Ark 的 Responses API 兼容 OpenAI 协议，所以 Vercel AI SDK 或 OpenAI Agents SDK（TS）配 Ark 的 base URL 应该可行，但需要实测 Ark 对 Responses 各字段的兼容程度。
- 也可以不引入框架：现有 job 队列加一个手写 loop，代码量很小。框架的价值主要在 tracing 和 MCP client。

### Gaps
- Pydantic AI 2026 年的版本，以及 Anthropic Agent SDK 的具体版本号，未查到。
- 所有下载量数据都来自第三方汇总。

## 3. 多 agent 还是单 agent，以及上下文工程

### Takeaway
业界已收敛到一种做法：单一编排者持有完整上下文，按需派出隔离的子 agent，子 agent 只做读和检索，返回压缩后的摘要；写操作和决策保持单线程。多 agent 的 token 消耗约是聊天的 15 倍，只在高价值、可并行、信息量超出单个上下文窗口的任务上划算。

### Cited Findings
- Anthropic（2025-06，背景）：普通 agent 的 token 消耗约是聊天的 4 倍，多 agent 约 15 倍。Opus 4 主导加 Sonnet 4 子 agent 的组合，比单 agent Opus 4 在研究任务上好 90.2%。在 BrowseComp 上，token 用量单独解释了 80% 的性能方差，加上工具调用次数和模型选择共解释 95%。— [Simon Willison 摘要](https://simonwillison.net/2025/Jun/14/multi-agent-research-system/)
- 批评意见：90.2% 是拿约 15 倍预算的系统去比没有这个预算的单 agent。— [Augment](https://www.augmentcode.com/guides/multi-agent-cost-compounding)
- Cognition「Don't Build Multi-Agents」（2025-06，背景）提出两条原则：共享完整的 agent 轨迹，而不只是单条消息；行动里隐含决策，相互冲突的决策会导致坏结果。长任务应使用专门的压缩模型。— [Cognition](https://cognition.com/blog/dont-build-multi-agents)
- Cognition「Multi-Agents: What's Actually Working」（2026-04-22）：已经开始部署真正能用的多 agent 系统，范围较窄，即多个 agent 贡献智能、写操作保持单线程。并行写入的 swarm 仍然不行。2026 年 3 月上线的「Devin 管理 Devins」由协调者拆分任务，分给运行在独立 VM 里的子 Devin，再汇总结果。— [Cognition](https://cognition.com/blog/multi-agents-working)；[Latent Space](https://www.latent.space/p/cognition)
- Anthropic「Code execution with MCP」（2025-11）：把工具改为文件系统里的代码，渐进式加载，Drive→Salesforce 示例的 token 从 15 万降到 2,000（-98.7%）。Cloudflare 的「Code Mode」思路相同。第三方实测是 -75.5%，取决于任务。— [Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp)；[Shevchenko](https://gregshevchenko.com/research/mcp-stack-token-economy/)
- 第三方测量：一套重型 MCP 配置启动时就占约 6.6 万 token。— [particula](https://particula.tech/blog/code-execution-mcp-token-reduction-pattern)

### Inferences
- 先验 consult 的单次请求是「查一个人在某领域的先验」。上下文很小，单 agent 加少量工具（查库、查利益、必要时联网）就够了，不需要多 agent。
- 批处理流水线（抽取、核查、利益收集）本来就是任务级并行。这种「编排者加隔离 worker，只回传结构化结果」的模式，与业界共识一致；而且先验的「代码校验 quote 原文」相当于单线程的写入闸门。
- 工具数量要少，返回要精简：返回 ID 和摘要，原文按需读取，避免把整页存档塞进上下文。

### Gaps
- Anthropic 的「Effective context engineering」一文、compaction 和 tool search 功能的一手细节，本次未检索到。

## 4. 长时运行与持久化 agent

### Takeaway
持久化执行已成为生产 agent 的标配：Temporal（大厂）、Inngest 或 Vercel Workflow（TS 函数式）、Restate（单个二进制）、DBOS（Postgres 库）。主要框架都有官方集成，厂商 API 也提供 background 加 webhook。对已有 Postgres 的团队，DBOS 式的「工作流状态和业务数据同库、同事务提交」最省事。

### Cited Findings
- Temporal 与 OpenAI Agents SDK 的集成，Python 版于 2026 年 3 月 GA（另一说 4 月）。model 调用可持久重试，replay 时不会重复执行。Replit Agent 3、OpenAI Codex web、Cursor 的长任务都运行在 Temporal 上（二手来源）。— [Cadenya](https://cadenya.com/other-content/durable-execution-for-ai-agents)；[reactify](https://www.reactify-solutions.com/articles/durable-ai-agents-2026)
- Inngest AgentKit：agent 网络加 router，共享状态，以 MCP 作为工具。step.run 按步骤名哈希记忆结果。许可证是 SSPL。— [ZenML](https://www.zenml.io/blog/inngest-alternatives)
- Restate：已有 Vercel AI SDK、OpenAI Agents SDK、ADK、Pydantic AI 集成，每步记日志，按幂等键去重，许可证 BSL，单个二进制。— [Cadenya](https://cadenya.com/other-content/durable-execution-for-ai-agents)
- DBOS：工作流状态和业务数据放在同一个 Postgres，一次 COMMIT 同时提交，是库而不是服务。— [hackernoon](https://hackernoon.com/durable-execution-for-ai-agents-langgraph-dbos-inngest-and-temporal-compared)
- 运维成本：Temporal 需要 4 个服务加 DB；Restate 是 1 个二进制；Inngest 是 1 个二进制，默认用 SQLite；DBOS 是库加 Postgres。— [Cadenya](https://cadenya.com/other-content/durable-execution-for-ai-agents)
- 托管服务计费粒度会让成本放大，例如「一次 agent 运行计费 51 个 step」。— [beri.net](https://www.beri.net/article/temporal-vs-inngest-vs-restate-vs-dbos-durable-execution-agent-cost)
- 事件驱动方面，OpenAI 提供 batch、background 完成事件的 webhook。— [OpenAI Docs](https://developers.openai.com/api/docs/guides/background)

### Inferences
- 先验已经有 Postgres job 队列，加上限流和预算控制。最小改动路线是参照 DBOS 的模式，把每次模型调用或工具调用作为 step 记到同一个库，崩溃后从最后一个 step 恢复，不急着引入 Temporal。
- 触发源可以统一成事件：deadline 到期触发核查，新闻 feed 或新的 13F/申报触发利益更新，人物新发言触发抽取。

### Gaps
- 这些对比文章大多是厂商或博客写的，没有官方 benchmark。DBOS 有没有 TS/Bun 版本，未确认。

## 5. 成本与延迟控制

### Takeaway
最大的几个杠杆依次是：prompt cache（缓存读取约为输入价的 0.1–0.2 倍）、Batch（约五折）、小模型优先，以及控制工具和上下文的体积。Ark 上 Seed 2.x 缓存命中价约为输入价的两折，批量推理约为在线价的五折，隐式缓存默认开启且不能关闭。

### Cited Findings
- Anthropic：缓存写入为输入价的 1.25 倍（5 分钟）或 2 倍（1 小时），读取为 0.1 倍。Batch 五折，可与缓存叠加，重复部分最多省约 95%（二手来源）。— [tensormesh](https://tensormesh.ai/learn/anthropic-prompt-caching-pricing/)；[edenai](https://www.edenai.co/post/prompt-caching-claude-vs-gpt-vs-gemini-cost-playbook)
- OpenAI：自动缓存。GPT-5.x 读取约 0.1 倍，GPT-5.6 及以后写入 1.25 倍，缓存保留 30 分钟（二手来源）。2026-10-20 官方新增 12 小时缓存，写入价为输入价的 2.5 倍。— [OpenAI Changelog](https://developers.openai.com/api/docs/changelog)；[leanlm](https://leanlm.ai/blog/prompt-caching)
- Gemini：自 2025 年 5 月起默认隐式缓存，2.5 及以后读取 0.1 倍，显式缓存另收存储费（二手来源，有冲突说法）。— [morphllm](https://www.morphllm.com/prompt-caching)
- **火山方舟价格（元/百万 token）**：doubao-seed-2.1-pro 输入 6.00、缓存命中 1.20、输出 30.00；2.1-lite 为 0.80 / 0.16 / 2.70；2.1-turbo 为 3.00 / 0.60 / 15.00；2.0-mini 为 0.2 / 0.04 / 2.0。缓存存储费 0.017 元/百万 token/小时。doubao-seed-2.0 及之后的模型在线推理默认隐式缓存，不能关闭。— [方舟模型价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)；[计费说明](https://www.volcengine.com/docs/82379/1544681)
- 方舟批量推理：输入和输出按在线价五折，缓存命中价不变（例如 seed-1.8 在线 0.80 / 2.00，批量 0.40 / 1.00），不能用免费额度抵扣。另外可以按天或按小时购买 TPM 保障包。— [方舟模型价格](https://www.volcengine.com/docs/82379/1099320)
- MCP 规范要求工具按确定性顺序返回，以提升调用方的 prompt cache 命中率。— [MCP Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- OpenAI web search 的 `return_token_budget` 可以限制搜索结果回灌的 token 数；另有「ultrafast」service tier（只见于第三方报道）。— [OpenAI Changelog](https://developers.openai.com/api/docs/changelog)；[tech-insider](https://tech-insider.org/openai-responses-api-setup-ultrafast-mode-2026/)

### Inferences
- 先验的批量 agent（抽取、核查）不要求时效，应全部走方舟批量推理，可直接省约 50%。把固定的 system prompt 和 schema 放在请求最前面，以吃到隐式缓存（2 折）。
- 在线 consult：先用纯 SQL 回答，零模型调用。只有需要解释或综合时，才调用 lite/mini 这类小模型，难例再升级到 pro。2.1-lite 与 pro 的输出价差约 11 倍。
- Pro 与 lite 的价差足以支撑「小模型初判，代码校验，失败再升级」的级联，而代码校验 quote 原文正好是一个廉价的升级判据。

### Gaps
- Anthropic、OpenAI、Google 的缓存价格都只拿到二手汇总，没有抓取官方定价页。
- Seed 2.x 的批量价、各模型的 TTFT/延迟数据未查到（arkcli models 可查 TTFT/TPOT 排名）。
- 没有找到投机执行（speculative tool execution）的权威数据。

## 6. 中国生态：火山方舟 / 豆包 / 扣子

### Takeaway
方舟的 agent 能力集中在 Responses API：内置 web_search（豆包搜索）、知识库检索、hosted MCP（MCP Marketplace）和 remote MCP（Streamable HTTP），可与 function calling 混用。Chat API 不支持这些内置工具。扣子 3.0 转型为多 agent 协作平台，并支持 MCP 和 A2A。

### Cited Findings
- 方舟内置工具和 hosted MCP 只能通过 Responses API 使用，Chat API 不支持。remote MCP 走 Streamable HTTP，支持多轮调用，可与自定义函数和 web search 混用。— [方舟工具调用](https://www.volcengine.com/docs/82379/1958524)；[迁移至 Responses API](https://docs.volcengine.com/docs/ark/responses-api-migration?lang=zh)
- web search 同时支持 Responses（OpenAI 协议）和 Messages（Anthropic 协议）。推荐使用「豆包搜索 Custom 版」，示例：`tools:[{"type":"web_search","sources":["doubao"]}]`，模型 `doubao-seed-2-1-pro-260915`；旧版「联网内容插件」只支持 Responses。— [方舟 Web Search](https://docs.volcengine.com/docs/ark/web-search?lang=zh)
- 2026-07-28 火山引擎开放豆包搜索服务，可通过 API、Skill、MCP、Agent Plan 接入，返回原网页 Markdown 和结构化数据，每月 500 次免费。— [51allai](https://51allai.com/posts/2026/07/doubao-search-service/)
- 扣子 3.0（2026-06-01）：项目空间支持多 agent 协作，可接入 Claude Code、Codex CLI，加深了对 MCP 和 A2A 的支持。扣子 2025 年 11 月起内置 MCP client，2025 年 9 月起可把插件封装成 MCP 工具对外提供。— [OpenAI Hub](https://www.openai-hub.com/news/567/)；[知乎](https://zhuanlan.zhihu.com/p/2045225229530699011)
- 火山 AgentKit：MCP 生态、长短期记忆、全链路观测，集成联网搜索、Browser-use 等 MCP 服务。HiAgent 3.0 面向政企，于 2026-06-23 的 FORCE 大会发布。— [AgentKit](https://www.volcengine.com/solutions/ai-cloud-native-agentkit)；[CSDN](https://blog.csdn.net/lpfasd123/article/details/162229660)

### Inferences
- 先验可以直接用方舟 Responses API，用 `tools` 同时挂上自家 consult MCP（remote）和 web_search，做成「核查 agent」，不必自建搜索。但 hosted 搜索结果仍要经过「原文存档、代码校验 quote」这道闸门。
- 豆包搜索能返回原网页 Markdown，可以直接作为存档来源，用来做 verbatim 校验，这是比 web_search 摘要更合适的输入。
- 可以考虑把先验 MCP 上架扣子插件或 MCP Marketplace，作为国内分发渠道。

### Gaps
- 未找到方舟「Managed Agents」产品的公开发布信息（本机 arkcli 有相关 skill，说明可能存在）。
- 方舟 Responses API 是否支持 background 或 webhook，未查到。
- 扣子对 MCP 2026-07-28 新规范的支持情况，未查到。
