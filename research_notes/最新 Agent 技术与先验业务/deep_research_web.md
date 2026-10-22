# Deep Research Agent、搜索/抓取 API、浏览器 Agent、网页存证与结构化财务数据（截至 2026-10-22）

> 调研日期 2026-10-22。价格和基准分数都标了数据日期。大部分基准数字来自第三方聚合榜（BenchLM、Steel、Yutori 等），其中很多是厂商自报，**不能直接横比**。凡是由搜索摘要转述、我没打开原始页面的内容都已注明。2025 年以前的内容标为「背景」。

## 1. Deep Research 产品与开源实现：架构与基准

### Takeaway
2026 年，「深度研究」已经从 ChatGPT/Gemini 里的一个产品功能，变成了可以按任务付费调用的 API agent（Gemini Deep Research 用 Interactions API，OpenAI 的旧 deep-research 模型已退役，并入 GPT-5.6 加工具）。架构基本都是「规划器 → 并行子搜索 → 汇总 → 单独做一遍引用」。BrowseComp 头部分数已经到 90% 上下，基本饱和；对先验来说，差异更多在**引用能否逐字核对**和**成本**，而不在榜单名次。

### Cited Findings
**架构**
- Anthropic Research（2025 年 4 月上线）用 orchestrator-worker 架构：Lead Researcher 先分析问题、把计划写进 memory（防止超过 20 万 token 后上下文被截断），再并行派出 3–5 个子 agent，每个子 agent 有独立上下文，各自搜索、用 interleaved thinking 评估结果；汇总之后交给一个独立的 **Citation Agent** 把每条论断对回来源。Opus 4 主控 + Sonnet 4 子 agent 的组合，在内部评测上比单 agent Opus 4 高 90.2%，token 消耗约为普通对话的 15 倍（背景，2025 年）。以上是二手转述 — [ByteByteGo](https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent)；[ZenML](https://www.zenml.io/llmops-database/building-a-multi-agent-research-system-for-complex-information-tasks)
- **Gemini Deep Research API**：通过 Interactions API 调用，agent ID 为 `deep-research-preview-04-2026` 和 `deep-research-max-preview-04-2026`，必须 `background: true` 后台运行再轮询。支持 `collaborative_planning`（先出研究计划，用户改完再执行）、可视化图表、远程 MCP server。**不支持自定义 function calling，也不支持 structured output**。官方估算单任务成本：标准版约 80 次搜索、25 万输入 / 6 万输出 token，约 $1–3；Max 版最多约 160 次搜索、90 万输入 token，约 $3–7（官方文档，2026-10 抓取）— [Google AI docs](https://ai.google.dev/gemini-api/docs/deep-research)
- **OpenAI Deep Research API**：`o3-deep-research` / `o4-mini-deep-research` 走 Responses API，必须挂至少一个数据源（web_search_preview、file_search 向量库、远程 MCP），需要后台模式。文档的弃用通知写明这两个模型 **2026-07-23 下线**，替代是 `gpt-5.6-sol` 加 web search / MCP 等工具 — [OpenAI docs](https://developers.openai.com/api/docs/guides/deep-research)
- **Claude API 的搜索与抓取工具**：web_search 收费 **$10 / 1000 次**，另加 token 费；支持 `max_uses`、`allowed_domains`/`blocked_domains`。`web_search_20260209` 及之后版本支持 dynamic filtering，即先由模型写代码过滤结果，再放进上下文。web_fetch 能抓全文和 PDF，但文档明确写了**不支持 JS 渲染页面**，这类页面建议改用客户端 browser use tool — [web search 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)；[web fetch 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
- **Perplexity**：API 已经变成 Agent API（第三方模型 + 工具），web_search 工具 $0.0025/次（fast 模式 $0.001），fetch_url $0.0005/次，finance_search $0.005/次；单独的 Search API **$5 / 1000 次请求**（Fast 档 $1/1k），一次请求最多带 5 个 query，失败或被限流的请求不计费（官方价格页，2026-10 抓取）— [Perplexity pricing](https://docs.perplexity.ai/getting-started/pricing)
- LangChain **open_deep_research**（开源，模型、搜索、MCP 都可替换）：2025-08 在 DeepResearch Bench 排第 6（RACE 0.4344）。换 GPT-5 后 0.4943；默认 GPT-4.1 跑完整个 bench 0.4309，花费 $45.98；用 Claude Sonnet 4 是 0.4401，花费 $187.09（自报，旧 Gemini 评审口径）— [GitHub](https://github.com/langchain-ai/open_deep_research)；[Exa 博客](https://exa.ai/blog/open-source-deep-research-agents)
- GPT-Researcher：没有找到可靠的 2025–2026 基准分数，只在 [arXiv 2601.20843](https://arxiv.org/pdf/2601.20843) 里作为 baseline 被引用过。

**基准**
- BrowseComp 背景数据：最初版 OpenAI Deep Research 单次 51.5%，多次尝试 78%；人类训练员只解出 29.2% — [Galileo](https://galileo.ai/blog/what-is-browsecomp-openai-benchmark-web-browsing-agents)
- BrowseComp 2026-10 各榜单互相不一致：BenchLM（10-20）Atria Dawn Preview 92.5%、GPT-5.6 Sol 92.2%、Claude Opus 4.7 79.3% — [BenchLM](https://benchlm.ai/benchmarks/browsecomp)；TensorFeed（10-19，多为厂商自报）GPT-6 Astra 91.5%、Kimi K3 91.2%、Claude Opus 5 90.8% — [TensorFeed](https://tensorfeed.ai/benchmarks/browsecomp)；Steel 按完整 agent 系统排名（10-11），GPT-5.6 Sol Ultra 92.2% — [Steel](https://leaderboard.steel.dev/leaderboards/browsecomp/)；OpenRouter 按「模型 + 搜索供应商」组合排名，Claude Opus 5 + Perplexity（25 轮）89.0% — [OpenRouter](https://openrouter.ai/benchmarks/browsecomp)。以上全部来自搜索摘要，我没有逐个核对原页。
- BrowseComp-ZH：Iris-pro 85.1、MiroThinker-H1 84.4 — [Scholar Compass](https://scholarcompass.net/en/tasks/deep-research-agents/benchmarks/browsecomp-zh)
- 中国开源模型：**Tongyi DeepResearch**（阿里，30B-A3B MoE，基于 Qwen3-30B-A3B）HLE 32.9、BrowseComp 43.4、BrowseComp-ZH 46.7、GAIA 70.9、xbench-DeepSearch 75.0。同一张表里 OpenAI DeepResearch 为 HLE 26.6 / BC 51.5 / BC-ZH 42.9 / GAIA 67.4；**Kimi Researcher** HLE 26.9、xbench-DeepSearch 69.0 — [arXiv 2510.24701](https://arxiv.org/html/2510.24701v1)。Yunque DeepResearch BC 62.5 / BC-ZH 75.9 / HLE 51.7 / GAIA 78.6 — [arXiv 2601.19578](https://arxiv.org/html/2601.19578)
- **DeepResearch Bench**（ICLR 2026，100 个博士级任务，覆盖 22 个领域，中英各半）用 RACE 评报告质量、FACT 评引用可信度。评审模型 2026-05 从 Gemini-2.5-pro 换成 GPT-5.5，**新旧分数不可比** — [GitHub](https://github.com/Ayanami0730/deep_research_bench)；[arXiv](https://arxiv.org/pdf/2506.11763)。GPT-5.5 评审口径下（CellCog 自己整理，2026-08-07）：CellCog Max 55.78、Gemini 2.5 Pro DR 49.98、OpenAI DR 47.84、Perplexity Research 43.05、Grok Deeper Search 41.22 — [CellCog](https://cellcog.ai/benchmarks)（来源不中立）
- AgentDisCo 论文因为「被引网页随时间 404」放弃了 FACT 指标 — [arXiv 2605.11732](https://arxiv.org/pdf/2605.11732)。这正好说明引用必须当场存档。

### Inferences
- 先验需要的是「找到原话 + 逐字核对 + 存档」，不需要长报告。所以与其买 Deep Research 成品，不如借它的架构：规划器并行派子搜索，最后由一个**独立的引用核验步骤**拿存档全文做字符串匹配。Gemini DR 不支持 structured output，OpenAI 的 DR 模型已下线，两者都不适合直接嵌进流水线。
- BrowseComp 已经饱和，换模型的收益有限；搜索源的质量和抓取成功率才是瓶颈。

### Gaps
- Kimi / 豆包 / Qwen 自家 Deep Research 产品的 2026 年 API 与价格没有查到。Qwen DeepResearch 只有一篇博客引用（qwen.ai/blog?id=qwen-deepresearch, 2025-11），没有分数。
- 各榜单上的 GPT-6 Astra、Kimi K3 等 2026 年分数没有打开原始厂商页核对。

## 2. 面向 Agent 的搜索 API

### Takeaway
主流 agent 搜索 API 的价格都落在 **$1–$10 / 千次**。Exa 和 Parallel 能直接返回网页正文或压缩摘录，质量评分最高；Brave 有独立索引、延迟低；火山方舟最便宜，在国内直连，但英文长尾质量没有独立评测。从中国访问海外 API 的稳定性没有可靠资料，需要自己实测。

### Cited Findings
- **Exa**（官方价格页，2026-10 抓取）：Search 起价 **$4/1k**，延迟 450ms–1s；Contents（全文）**$1 / 1k 页**，可配置 livecrawl；Deep Search $12/1k；Agent（异步深度研究）$0.012–$1.00/次；Monitors $15/1k。免费档每月 $10 额度 + $10 新手奖励，10 QPS；按量付费档最高 25 QPS — [Exa pricing](https://exa.ai/pricing)。第三方称 2026-03 基础搜索从 $5 涨到 $7/1k（Fast/Auto 档），超过 10 条的结果每条另加 $1/1k — [fastcrw](https://fastcrw.com/blog/web-search-api-pricing-2026)；[Keirolabs](https://keirolabs.cloud/blogs/comparisons/exa-search-api-pricing-per-1000-requests-2026)（两者都是竞品写的）
- **Parallel**（官方，2026-10）：Search **$0.001–0.005 / 次（含 10 条结果）**，返回排序后的 URL 和压缩摘录，延迟 200ms–3s，限速 600 次/分；Extract $0.001/次（全文或摘录，<3s）；Task API（深度研究，带 citations、reasoning、confidence 字段）$0.005–2.4/次，耗时 5s–30min；Monitor $0.003–0.01；每月 5000 次免费请求，注册最多送 $80 — [Parallel pricing](https://parallel.ai/pricing)
- **Tavily**（官方，2026-10）：免费档 1000 credits/月；按量 $0.008/credit；Project 档 $30/月 4000 credits。basic 搜索 1 credit、advanced 2 credits，Research 15–250 credits/次（credit 换算来自第三方）— [Tavily pricing](https://www.tavily.com/pricing)；[fastcrw](https://fastcrw.com/blog/web-search-api-pricing-2026)。Nebius 已于 2026-02 宣布收购 Tavily（第三方摘要，未核实原始公告）— 同上
- 质量：Artificial Analysis 2026-08 Search Index 中 Parallel（advanced）75、Exa（auto）74、Tavily（basic）66（转引自竞品博客，未核对原页）— [fastcrw](https://fastcrw.com/blog/web-search-api-pricing-2026)。Brave 官网引用 AIMultiple 的独立测试：agent 质量 Brave 14.89 > Firecrawl 14.58 > Exa 14.39 > Tavily 13.67；平均延迟 Brave 669ms、Tavily 998ms、Exa 1.2s、Perplexity 11s、Parallel Pro 13.6s — [Brave Search API](https://brave.com/search/api/)（厂商引用的结果，有选择性呈现的可能）
- **Brave**：自有索引，不依赖 Google/Bing；每月最多 $20 免费调用，预付 credits；官网称 Microsoft 已经下线 Bing Search API，Google 的 Custom Search API 不再接受新客户 — [Brave](https://brave.com/search/api/)。第三方列出的价格约 $5/1k — [fastcrw](https://fastcrw.com/blog/web-search-api-pricing-2026)
- **Perplexity Search API** $5/1k（Fast 档 $1/1k），见第 1 节 — [Perplexity pricing](https://docs.perplexity.ai/getting-started/pricing)
- **Firecrawl Search**：每 10 条结果 2 credits（见第 3 节）— [Firecrawl pricing](https://www.firecrawl.dev/pricing)。**Jina** 的 `s.jina.ai` 返回 SERP 和 5 条结果的正文 — [Jina Reader](https://jina.ai/reader/)
- **Claude web_search** $10/1k，支持域名白名单和黑名单 — [Anthropic docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- **火山方舟联网内容插件**：按次后付费，每月前 **2 万次免费**，之后联网资源 **4 元/千次**，头条、抖音、墨迹垂类 6 元/千次；同一次返回里每种来源类型各计 1 次。用 Responses API 的 `web_search` 工具时，一轮可能并发多个关键词、多次计费，可以用 `max_keyword` 限制关键词数。「豆包搜索 Custom 版」要设 `sources:["doubao"]`，单独计费，且不能和其他来源混用 — [联网内容插件计费](https://www.volcengine.com/docs/82379/1338550)；[Web Search 文档](https://www.volcengine.com/docs/82379/1756990?lang=zh)（以上为搜索摘要，原页是 JS 渲染，curl 抓不到）
- 国内其他选项：智谱搜索 API 约 10 元/千次 — [什么值得买](https://post.smzdm.com/p/a95662wp/)

### Inferences
- 针对先验现在的问题（结果链接打不开、付费墙、JS 渲染）：Exa Contents、Parallel Extract、Tavily Extract 是在服务端抓取或使用缓存索引的全文，可以绕开「自己用 urllib 抓」这一层。但如果要求**逐字匹配**，必须保存当时实际拿到的原文，并标明它是供应商缓存，还是 live crawl 的结果。
- 建议**双源**：火山方舟负责中文和低成本召回，Exa 或 Parallel 负责英文，带 `includeDomains`（如 sec.gov、investor 页面）和发布日期过滤。月成本按 1 万次搜索算，大约 $10–70。
- 国内访问：海外 API 一般需要海外信用卡和稳定出口。OpenAI 和 Anthropic 的 API 不对中国大陆提供服务（这是常识，本轮没有抓支持国家页面核实）。Exa、Parallel、Brave 没有公开的地域限制，但也没有找到国内访问质量的资料。

### Gaps
- 没有找到 Exa、Tavily、Parallel 各自日期过滤、域名过滤参数的完整清单（只知道大致都支持）。
- 「豆包搜索 Custom 版」的单价没有找到。
- SerpAPI、Google Vertex grounding 的 2026 年价格未覆盖。

## 3. 页面抓取 / 提取 / 浏览器 Agent

### Takeaway
抓静态页和 PDF 用 Jina Reader 或 Firecrawl 最省事（不到 $0.001–0.003/页）；JS 渲染页面和需要交互的页面用 Browserbase、Browser Use 一类云浏览器（约 $0.1/浏览器小时，或每任务约 11¢）。Online-Mind2Web、OSWorld-Verified 的头部分数都超过 80–95%，但多为厂商自报、评审口径不一。

### Cited Findings
- **Firecrawl**（官方，2026-10，按年付的月价）：Free 1000 credits/月（2 并发）；Hobby $16（5000 credits）；Standard $83（10 万 credits，25 并发）；Growth $333（50 万）；Scale $599（100 万，100 并发）。1 credit = 1 页 scrape；Search 每 10 条 2 credits；Interact（浏览器操作）每分钟 2 credits；JSON 提取每页另加 4 credits；**没返回结果的抓取不计费** — [Firecrawl pricing](https://www.firecrawl.dev/pricing)。第三方称 Stealth 模式每页 5 credits，FIRE-1 agent 失败也计费 — [eesel](https://www.eesel.ai/blog/firecrawl-pricing)
- **Jina Reader**：在 URL 前加 `r.jina.ai` 即可拿到 Markdown；可选浏览器引擎（X-Engine）、超时、CSS 选择器、PDF 分页，以及 OCR（token 消耗 40 倍）— [Jina Reader](https://jina.ai/reader/)。按 token 计费，新 key 送 1000 万 token；不带 key 时限 20 次/分，带 key 时 500 次/分；单价各来源说法矛盾 — [Keirolabs](https://keirolabs.cloud/blog/firecrawl-vs-jina-reader-vs-tavily-extract)；[spider.cloud](https://spider.cloud/blog/best-firecrawl-alternatives/)
- **Browserbase**（官方，2026-10）：Free（3 并发、1 浏览器小时）；Developer $20/月（25 并发、100 小时，之后 $0.12/小时，代理 $12/GB）；Startup $99/月（超出后 $0.10/小时，代理 $10/GB）；付费档都含**自动验证码处理**和 Search、Fetch API（Fetch 超出后 $0.5–1/1k）— [Browserbase pricing](https://www.browserbase.com/pricing)。（注意：自动过验证码可能触碰目标网站的服务条款。）
- **Online-Mind2Web**（300 个任务、136 个真实网站）：人工评测榜 Hark 97.7%、Yutori Navigator n1.5 97.3%（2026-08-05）— [Yutori](https://yutori.com/leaderboards/online-mind2web)。Browser Use Cloud 自报 97%（2026-03）和 98%（2026-08，用自己的评审，模型成本约 11¢/任务）— [Browser Use](https://browser-use.com/posts/online-mind2web-benchmark)；Steel 指出它的评审和 OpenAI 的不同，不可直接比较 — [Steel](https://leaderboard.steel.dev/leaderboards/online-mind2web/)。Stagehand + Gemini 2.5 CU 65%，换 Claude Sonnet 4.5 是 55% — [Digital Applied](https://www.digitalapplied.com/blog/open-source-browser-computer-use-agents-2026)。背景：OpenAI Operator 61.3%（2025-04），Claude 3.7 CU 56.3%（2025-02）— [Steel](https://leaderboard.steel.dev/leaderboards/online-mind2web/)
- **OSWorld-Verified**（人类基线 72.36%）：官方榜榜首 Intelligence-Indeed Agent 90.19%（据 Presenc，2026-10-01）— [Presenc](https://presenc.ai/research/osworld-computer-use-leaderboard-2026)；Yutori 跟踪榜（2026-08-31）claude-fable-5 86.0%、Kimi K3 84.8%、GPT-5.6 Sol 83.0% — [Yutori](https://yutori.com/leaderboards/osworld-verified)；Claude Sonnet 4.6 为 72.5%（2026-02）。更难的 OSWorld 2.0 上最好的完全完成率约 44–49% — [Presenc](https://presenc.ai/research/osworld-computer-use-leaderboard-2026)
- Claude web_fetch 不渲染 JS，官方建议改用 browser use tool — [Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)

### Inferences
- 推荐的抓取链：① 先用 urllib，加重试和指数退避；② 失败了用 Jina Reader 或 Firecrawl scrape（能渲染 JS）；③ 还不行再用 Browserbase 或 Playwright 开真浏览器；④ 最后退到搜索 API 的缓存全文（Exa Contents、Parallel Extract）。每一步都保存原始 HTML 和抓取时间戳，供逐字匹配用。
- 先验的任务是「打开页面拿到原文」，用不上 computer-use 的多步交互能力。OSWorld 分数对先验参考价值不大，只有登录或翻页才需要浏览器 agent。

### Gaps
- 没有找到 Jina、Firecrawl 在付费墙页面上的成功率实测，也没有找到从中国访问这些服务的稳定性数据。
- Playwright MCP、OpenAI ChatGPT agent、Gemini computer use 的 API 价格没有查。

## 4. 网页存档作为证据

### Takeaway
Wayback Machine 的 Save Page Now（SPN2）是首选：免费、有 API、第三方中立。但它限流严格，抓 JS 页面会失败。archive.today 2026 年被 Wikipedia 拉黑，原因是**篡改已存档内容**，**不应再作为证据来源**。最稳的做法是「SPN2 公共存档 + 自建 WARC/截图（SHA-256 哈希）」双保险。

### Cited Findings
- **SPN2 API**（`web.archive.org/save`）：推荐用 S3 key 认证；登录用户最多 12 个并发 capture，匿名 6 个；登录用户每天最多 10 万次 capture；同一 URL 每天最多 10 次；目标站点 10 秒不响应就失败，单次 capture 最长 90 秒（这是约 4.5 年前文档的非官方副本，数值可能已变）— [SPN2 文档 gist](https://gist.github.com/regstuff/82e690db2f1d91ba59f6681c1abad6cf)。429 错误提示「每分钟不超过 15 次」，超限可能被封 IP 5 分钟到 1 天；登录后限额按账号计，不再按 IP 计 — [spn-scripts](https://github.com/overcast07/wayback-machine-spn-scripts)。Python `wayback` 库在 v0.5.1（2026-06-19）把 CDX 搜索的默认速率降到 **24 次/分**，以匹配服务器现在的硬限制 — [wayback docs](https://wayback.readthedocs.io/en/latest/usage.html)
- **archive.today**：2025-10-30 FBI 向注册商 Tucows 发出传票，要求提供站主身份 — [404 Media](https://www.404media.co/fbi-tries-to-unmask-owner-of-infamous-archive-is-site/)。2026-02 英文 Wikipedia 把它加入垃圾链接黑名单，并要移除约 69.5 万条链接，理由是它利用访客浏览器 DDoS 一名博主，并**篡改已存档页面的内容** — [Heise](https://www.heise.de/en/news/Hundreds-of-thousands-of-links-Wikipedia-bans-Archive-today-after-cyberattack-11185344.html)；[SC World](https://www.scworld.com/brief/wikipedia-bans-archive-today-over-ddos-attacks-and-content-alteration)。它也没有官方 API — [Visualping](https://visualping.io/blog/best-wayback-machine-alternatives)
- **Perma.cc**（Harvard Library Innovation Lab）：面向法律和学术引用，需要账号。个人付费档的说法互相矛盾：$10/月 10 条、$25/月 100 条、$100/月 500 条（据 2026-08 的一篇评测）— [osint4all](https://osint4all.com/tool/perma-cc/)；另一说是不公开定价 — [Visualping](https://visualping.io/blog/best-wayback-machine-alternatives)。媒体机构可以申请共享账号 — [Wikipedia](https://en.wikipedia.org/wiki/Perma.cc)。开发者文档页被 Cloudflare 挡住，没能核实 API。
- 法律效力：单纯截图或快照本身不构成可采信证据；Perma.cc、Pagefreezer 提供防篡改存档 — [Visualping](https://visualping.io/blog/best-wayback-machine-alternatives)

### Inferences
- 先验的「引文必须和存档逐字一致」可以这样落地：抓取时同时保存 ① 原始 HTML/PDF 字节和 SHA-256；② 提取出的正文；③ SPN2 快照 URL（异步提交、排队、限速 ≤5–10 次/分、带退避）。引文匹配以 ② 为准，③ 作为第三方佐证。
- 自建方案可以用 ArchiveBox（WARC + SingleFile + PDF + 截图）或 SingleFile CLI，生成单文件 HTML 放进对象存储。这部分本轮没有找到 2026 年的资料（见 Gaps）。

### Gaps
- 没有找到 SPN2 在 2025–2026 年的官方限额文档、ArchiveBox 的最新版本状态、事实核查机构（IFCN、Bellingcat 等）的取证规范，也没有找到 Wayback 对付费墙页面的抓取成功率。

## 5. 结构化财务数据：可以直接调用、不必爬取的来源

### Takeaway
SEC 的 data.sec.gov API 免费、不需要 key、近实时（XBRL 延迟约 1 分钟），可以直接取公司级财务数据。但 **companyfacts、frames 不含维度数据**，分地区、分业务线的收入要从 Financial Statement & Notes 数据集（DIM 表），或者单份 filing 的 XBRL 里解析。

### Cited Findings
- 官方端点：`https://data.sec.gov/submissions/CIK##########.json`（申报历史）、`/api/xbrl/companyconcept/CIK…/us-gaap/{tag}.json`、`/api/xbrl/companyfacts/CIK….json`、`/api/xbrl/frames/us-gaap/{tag}/USD/CY2019Q1I.json`。**不需要认证**，不支持 CORS。submissions 延迟通常不到 1 秒，XBRL 不到 1 分钟。批量包 companyfacts.zip、submissions.zip 每晚约 3:00 ET 重建。XBRL API 只汇总标准 taxonomy（us-gaap、ifrs-full、dei、srt）里**适用于整个申报实体**的事实 — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- 访问规则：所有 EDGAR 域名合计不超过 **10 次/秒**；必须带 `User-Agent: 公司名 邮箱`，否则返回 403；超限后会被限流约 10 分钟 — [tldrfiling](https://tldrfiling.com/blog/sec-edgar-api-rate-limits-best-practices)；[dev.to](https://dev.to/odeeb/sec-edgar-rate-limit-and-user-agent-fair-access-rules-nki)
- 分部和地区收入：**Financial Statement and Notes Data Sets** 包含所有报表和附注里的数值，提供 SUB、NUM、TAG、DIM 等 8 张制表符分隔的表，DIM 表存 XBRL 维度（dimh=0 表示无维度），用 NUM 关联 DIM 就能拿到 `StatementGeographicalAxis` 等维度的数据 — [SEC FSN](https://www.sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets)；[FSN 说明 PDF](https://www.sec.gov/files/aqfsn_1.pdf)。companyfacts、frames 只暴露无维度事实 — [pipeworx MCP](https://github.com/pipeworx-io/mcp-sec-financial-statements)
- **EdgarTools**（Python）解析单份 filing 的 XBRL 时，默认会显示维度拆分（包括地区分部）— [EdgarTools](https://edgartools.readthedocs.io/en/stable/guides/extract-statements/)。商业的 sec-api.io 有教程从 Apple 10-K 里按产品和地区取收入 — [sec-api.io](https://sec-api.io/resources/extract-financial-statements-from-sec-filings-and-xbrl-data-with-python)
- 各公司用的收入 tag 不统一，要依次试 2–3 个候选概念 — [dev.to](https://dev.to/northpine-studio/revenue-by-year-from-sec-edgar-in-python-three-traps-in-the-xbrl-api-3goh)

### Inferences
- 先验的「公司收入按地区」可以完全改成 API 驱动：用 submissions 找到最新的 10-K，用 EdgarTools 解析这份 filing 的 XBRL 维度（或每季下载 FSN 数据集），每个数字都带上 accession 号和 R 文件链接作为证据，省掉爬网页和存档两步。
- 持股：Form 4、13F、DEF 14A 也在 submissions 里，可以按 CIK 直接拉取。供应商和大客户集中度只在 10-K 文本里，仍然需要全文检索（efts.sec.gov 的 full-text search 也受 10 次/秒限制）。

### Gaps
- 没有核实 FSN 数据集 2026 年的发布频率（历史上按月或按季）。
- 没有覆盖商业财务数据 API（FMP、Polygon、FactSet 等）的分部数据能力与价格，也没有覆盖非美公司（港股、A 股年报）的结构化来源。
