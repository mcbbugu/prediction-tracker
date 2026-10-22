# AI Agent 生产环境的评测（Evals）与可观测性（截至 2026-10）

> 方法说明：本次 WebFetch 工具不可用（报模型错误），所有内容来自 WebSearch 返回的摘要。其中 Anthropic 博文只拿到第三方转述和镜像，没有读到原文；工具定价大多来自第三方或厂商自己的对比文章。每条结论都附了 URL，数字最好到官方页面再核对一遍。

## 1. 评测方法（2025–2026）：从线上 trace 和人工标注建评测集、错误分析、二元判定与打分、评测驱动开发

### Takeaway
2025–2026 年主流做法已经比较一致：先人工读 trace 做错误分析，找出失败模式；能用代码判定的先用代码判定；剩下的用 LLM judge，输出二元 Pass/Fail，并拿人工标签校准（TPR/TNR）；评测集从真实失败案例起步，20–50 条就可以开始。评测要分成两类：能力评测（通过率本来就低，用来往上爬）和回归评测（应接近 100%，用来防退化）。

### Cited Findings
- Hamel Husain 和 Shreya Shankar 的《AI Evals: Everything You Need to Know》FAQ 是这一领域引用最多的实践指南，PDF 版落款 2026-09-18。内容来自两人给 5,000+ 名工程师和 PM 上评测课时最常被问到的问题，涵盖二元判定与 Likert、合并成单一指标、评测驱动开发、judge 选什么模型等。— [hamel.dev FAQ](https://hamel.dev/blog/posts/evals-faq/)；[PDF 2026-09-18](https://hamel.dev/blog/posts/evals-faq/evals-faq.pdf)
- 错误分析是评测里最重要的一环（旧版 FAQ 原话："Error analysis is the most important activity in evals"）。— [旧版 FAQ 镜像](https://www.gregorojstersek.com/evals-faq.pdf)
- 三步流程：(1) 读 trace，记下失败方式（error discovery）。先拿约 100 条多样化 trace，前 30 条至少自己亲手标。(2) 建评测器并验证。有客观规则能识别的失败用代码判定，需要人判断的用 LLM judge，每种失败模式标 100–200 条。(3) 用重要流程和已确认的失败建一个可重复跑的评测集，每次改动都跑一遍。— [hamel.dev FAQ（搜索摘要）](https://hamel.dev/blog/posts/evals-faq/)
- 推荐 LLM judge 当分类器用，只输出 Pass/Fail，再拿可信的人工标签对比验证。理由是二元选项逼人做决定，不让不确定性藏在中间分里。judge 模型先用最强的，等标准稳定、和人工对齐之后再考虑降本。— [hamel.dev FAQ](https://hamel.dev/blog/posts/evals-faq/)
- "Critique shadowing"：指定一位核心领域专家作为唯一标准，每条输出给二元判定，再附一段书面理由。— [hamel.dev FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Hamel 发布了给 coding agent 用的 evals-skills，包括 write-judge-prompt（设计二元 judge）和 validate-evaluator（用人工标签算 TPR/TNR 校准 judge，并做偏差修正）。— [Substack: Evals Skills for Coding Agents](https://hamelhusain.substack.com/p/evals-skills-for-coding-agents)；[GitHub hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills/blob/main/questions.md)
- 反方观点：有人认为二元判定加 critique shadowing 的方法过于主观，不适合所有产品；还指出一个只会盖 PASS 章的 judge 也能拿到约 90% 的一致率，但什么问题都抓不到（所以要看 TPR/TNR，不能只看总一致率）。— [tomrochette.com](https://tomrochette.com/agents/people-and-publications/hamel-husain/)
- Anthropic《Demystifying evals for AI agents》（2026 年 1 月，Anthropic Engineering）的要点：评分器分三类，即代码（单测、正则、检查调用了哪些工具，快、便宜、客观，但容易误杀）、模型（rubric 或成对比较，适合开放式输出，但不确定、成本高，要用人工校准）、人工（金标准，但贵）。一个任务上多个评分器可以加权过阈值，也可以要求全部通过。优先检查结果（环境的最终状态），而不是 agent 自己怎么说。— [第三方 TL;DR gist](https://gist.github.com/pebeto/76c1e61120cb27445d53a00459db5fc8)；[博文 markdown 镜像](https://github.com/chyornyy/anthropic_engineering_md/blob/main/anthropic_engineering_blog/Demystifying%20Evals%20for%20AI%20Agents.md)；原文地址 https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents（本次未直接读到）
- Anthropic 同文：能力评测应从低通过率起步，给团队留出爬坡空间；回归评测应接近 100% 通过，用来防退化。实操建议是从真实失败里挑 20–50 个任务起步，任务规格写清楚、不留歧义，坚持读 transcript，把评测当成持续维护的基础设施。研究类 agent 要查 groundedness（有没有依据）、coverage（覆盖面）和来源质量。— [ai-eval.org 转述](https://ai-eval.org/post/anthropic-demystifying-evals-for-ai-agents)；[hyacehila 转述](https://hyacehila.github.io/en/blog/2026/07/07/demystifying-evals-for-ai-agents/)
- OpenAI 官方文档：trace grading 是给 agent 的整条 trace（决策、工具调用、推理步骤）打结构化分数或标签，用来做基准对比、发现回归、验证改进。agent-evals 页面建议检查的问题包括：工具选对了吗？该交接时交接了吗？有没有违反指令或安全策略？— [Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)；[Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- OpenAI《Evaluation best practices》近期有更新，讲怎么定评测指标、分析不确定性来源；Graders 页面写明 OpenAI 正在弃用 evals/fine-tuning 流程里的 graders。— [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)；[Graders](https://developers.openai.com/api/docs/guides/graders)
- 第三方总结的常见分层：先跑便宜的确定性检查（字符串、代码）并作为硬门槛，再跑贵的模型评分器，阈值放宽一些。"output grading" 判断最终答案，"trace grading" 判断过程（调没调对工具、参数对不对、有没有多余步骤）。— [qaskills OpenAI trace grading 指南](https://qaskills.sh/blog/openai-evals-trace-grading-complete-guide)
- 背景（2024）："criteria drift"（标准漂移）指人在给更多输出打分的过程中会不断修改自己的评判标准，有些标准只有看到具体输出后才定得下来。所以评测标准没法完全事先定死，人工评分要持续进行；LLM 评估器适合标准模糊或数据脏的情况。出处是 Shankar 等人的论文《Who Validates the Validators?》（UIST'24）。— [arXiv 2404.12272](https://arxiv.org/abs/2404.12272)

### Inferences
- 先验的业务天然适合这套方法："引语是否逐字出现在存档页上" 是标准的代码评分器，应作为硬门槛；"这是不是一条可判定的预测""到期判定对不对""利益关系提取得对不对" 才需要人工或 LLM judge。人工复核过的条目就是现成的金标签，可以直接当回归集，也可以用来算 judge 的 TPR/TNR。
- 每条 claim 的追加式事件日志相当于 trace，可以按 Hamel 的流程做错误分析：抽约 100 条做开放式标注，归纳出失败类别，每类再挑例子进回归集。
- 判定类输出（兑现/未兑现/无法判定）建议都用离散标签，直接算人与模型的一致率和混淆矩阵，不要引入 1–5 分。

### Gaps
- 没读到 Anthropic 博文原文，细节（例如是否给了任务数下限）只能依赖第三方转述。
- OpenAI 弃用 graders 之后的替代方案和时间表，摘要里没写清楚。

## 2. Agent 专用基准与指标：任务成功率、轨迹评测、工具调用准确率、tau-bench/τ²-bench、pass^k、单次成功成本

### Takeaway
pass^k（k 次独立试验全部成功的概率）已经成为衡量 agent 稳定性的标准指标，来自 τ-bench，被 Anthropic 推荐用于面向客户的 agent。pass@k 衡量 "至少成功一次"，k 越大越乐观；pass^k 随 k 增大迅速下降。另一个趋势是看过程（轨迹、工具选择）和成本，而不只看最终正确率。

### Cited Findings
- τ-bench（Sierra，arXiv 2406.12045，2024，背景资料）定义了 pass^k：k 次独立试验全部成功的概率，在任务间取平均。若一个任务跑 n 次、成功 c 次，无偏估计为 E_task[C(c,k)/C(n,k)]。论文中 gpt-4o 在 retail 域的 pass^1 约 61%，pass^8 不到 25%。— [arXiv 2406.12045](https://arxiv.org/abs/2406.12045)
- τ²-bench（arXiv 2506.07982，2025-06）新增 "双控" Telecom 域：用户也能调用工具改变共享环境。它带一个组合式任务生成器，能批量生成可验证的任务；用户模拟器更可靠；还能把失败拆成推理错误和沟通/协调错误。agent 从无用户模式切到双控模式后表现明显下降。— [arXiv 2506.07982](https://arxiv.org/abs/2506.07982)；[GitHub sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench)
- Anthropic 博文举例：单次成功率 75%，跑 3 次时 pass^3 = 0.75³ ≈ 42%。到 k=10 时，pass@k 接近 100%，pass^k 接近 0%。按 agent 类型列出的推荐基准：coding 用 SWE-bench Verified、Terminal-Bench；对话类用 τ/τ²-bench；研究类用 BrowseComp；computer-use 用 WebArena、OSWorld。— [gist TL;DR](https://gist.github.com/pebeto/76c1e61120cb27445d53a00459db5fc8)
- 2026 年的后续研究：LOGIGEN（arXiv 2603.00540）在 τ²-Bench 上发现，Retail 域的 Pass^k 从 k=1 的 81.6% 降到 k=4 的 56.1%；《Beyond pass@1》（arXiv 2603.29231）发现任务越长，pass^k 越低；《On the Reliability of Computer Use Agents》（arXiv 2604.17849）指出 pass^k 仍是聚合指标，主张对重复运行结果做配对统计检验。— [LOGIGEN](https://arxiv.org/pdf/2603.00540)；[Beyond pass@1](https://arxiv.org/pdf/2603.29231)；[CUA reliability](https://arxiv.org/pdf/2604.17849)
- 2026 年已有研究专门把 agent 轨迹的成本和效用对齐（剖析、归因、诊断、评测）；也有 "Noise Floor Audit" 论文专门审计 agent 基准的噪声下限。（只看到标题，未读全文。）— [Cost-Utility Alignment arXiv 2608.26195](https://arxiv.org/pdf/2608.26195)；[Noise Floor Audit arXiv 2608.22331](https://arxiv.org/pdf/2608.22331)
- OpenAI agent 评测关注的过程指标包括工具选择是否正确、交接是否合规、有没有违反策略。— [OpenAI agent-evals](https://developers.openai.com/api/docs/guides/agent-evals)

### Inferences
- 公开基准对先验的参考价值有限，因为先验的任务（抽取、到期判定、利益收集）是领域专用的。值得借用的是指标定义：
  - 任务成功率：通过代码校验且被人工认可的比例。
  - pass^k：同一条输入跑 k 次（例如 k=3），判定结论是否一致，用来衡量判定的稳定性；对 "到期预测判定" 这种影响公信力的输出尤其重要。
  - 单次成功成本：总 cost units ÷ 通过校验的产出条数。现有的模型调用日志表直接就能算。
- 双控、用户模拟这类设定和先验关系不大；更相关的是研究类 agent 的 groundedness 和来源质量检查，而先验的 "逐字引语 + 存档页" 已经是更强的 groundedness 代码校验。

### Gaps
- 没找到 "单次成功成本" 的标准化定义或业界基准数字。
- Weave、Braintrust 等平台对 pass^k 的内置支持情况没有查到。

## 3. 可观测性工具：OTel GenAI 语义约定、Langfuse、LangSmith、Phoenix、Braintrust、Helicone、Weave、Laminar（以及与火山方舟相关的 CozeLoop）

### Takeaway
OTel GenAI 语义约定已经成为事实标准的 trace 结构，但仍处于 Development 阶段，规范已迁到独立仓库。2026 年行业整合很明显：ClickHouse 收购了 Langfuse，Mintlify 收购了 Helicone（后者已进入维护模式）。对 1–2 人团队，可以免费自托管的主要是 Langfuse（MIT）、Laminar（Apache 2.0）、Phoenix（ELv2），以及字节自家的 CozeLoop（Apache 2.0，原生支持火山方舟）。LangSmith 和 Braintrust 只在企业版提供自托管。

### Cited Findings
**OTel GenAI 语义约定**
- 定义了 gen_ai.* 命名空间：模型调用是 `chat`，agent 运行是 `invoke_agent`，工具调用是 `execute_tool`，另有 `embeddings`、`create_agent`、`retrieval` 等。span 名格式为 `{gen_ai.operation.name} {gen_ai.request.model}`。`gen_ai.provider.name` 取代了已弃用的 `gen_ai.system`。token 属性有 `gen_ai.usage.input_tokens`/`output_tokens`，以及缓存读写相关的计数。是否记录 prompt/completion 内容需要显式开启（opt-in）。— [DEV: OTel GenAI conventions 2026](https://dev.to/gabrielanhaia/opentelemetry-genai-semantic-conventions-your-llm-traces-should-look-like-this-in-2026-3ff6)；[Decagon 术语表](https://decagon.ai/glossary/what-are-opentelemetry-genai-semantic-conventions)
- 稳定性仍是 Development，名称可能变化。规范已迁到 github.com/open-telemetry/semantic-conventions-genai，是持续更新的规范，没有打 tag 发版（2026-08-28 访问）。— [arXiv 2609.12582 NovaFabric（引述）](https://arxiv.org/pdf/2609.12582)；[Uptrace 2026](https://uptrace.dev/blog/opentelemetry-ai-systems)
- Langfuse、Phoenix、OpenLLMetry、Laminar 等主流 tracer 都已向这套约定靠拢。约定只覆盖到工具边界为止，工具内部的 HTTP 调用、重试、限流不在范围内。— [Morph agent tracing](https://www.morphllm.com/agent-tracing)；[Nango](https://nango.dev/blog/opentelemetry-ai-agent-observability/)

**Langfuse**
- 2026-01-16 被 ClickHouse 收购，官方表示继续开源、不改许可证。— [GitHub Discussion #11593](https://github.com/orgs/langfuse/discussions/11593)；[Orrick](https://www.orrick.com/en/News/2026/01/Open-source-LLM-Observability-Langfuse-Acquired-by-ClickHouse-Inc)
- Cloud 定价（第三方汇总）：Hobby 免费，每月 5 万 units，数据保留 30 天，2 个用户，超额后不再记录；Core $29/月，含 10 万 units、90 天保留、不限用户，超额 $8/10 万 units；Pro $199/月。units = trace + observation + score 的总数，一次多步 agent 请求可能消耗 20+ units。自托管核心免费（MIT），文档给出的最低资源是 9 vCPU、21.5 GiB（需要 ClickHouse）。— [costbench](https://costbench.com/software/ai-observability/langfuse/)；[benchclaw](https://benchclaw.io/langfuse-pricing/)；[cekura](https://www.cekura.ai/blogs/langfuse-pricing)

**LangSmith**
- 闭源，只有企业版可自托管。Developer 免费档每月 5k base traces、1 个席位；Plus $39/席位/月。超额价格各来源说法不一（$0.50、$2.50、$5 每 1k traces 都有）。— [Laminar 定价对比](https://laminar.sh/article/llm-observability-pricing)；[MorphLLM](https://www.morphllm.com/llm-observability-tools)

**Arize Phoenix**
- 自托管免费、不限事件数，许可证为 Elastic License 2.0（源码可见，不是 OSI 认可的开源）。TS 包有 `@arizeai/phoenix-otel`（2026-04-13 发布 1.0）、`phoenix-client`、`phoenix-evals`、`openinference-core`；OpenInference TS 2.0（2025-11）提供了手动埋点的 wrapper（traceAgent、traceTool 等）。— [Phoenix TS SDK](https://arize.com/docs/phoenix/sdk-api-reference/typescript/overview)；[phoenix-otel 1.0](https://arize.com/docs/phoenix/release-notes/04-2026/04-13-2026-phoenix-otel-ts-1-0)；[OpenInference TS 2.0](https://arize.com/docs/phoenix/release-notes/11-2025/11-09-2025-openinference-typescript-2-0)

**Braintrust**
- 免费档有 1 GB 处理数据、1 万次 scores、14 天保留、不限用户；Pro $249/月；只有企业版可自托管（混合部署）。开源的 `autoevals` 评分库同时有 Python 和 TS 版。— [Laminar 对比](https://laminar.sh/article/braintrust-alternatives-2026)；[autoevals npm](https://www.npmjs.com/package/autoevals)

**Helicone**
- 2026-03-03 宣布被 Mintlify 收购，进入维护模式（安全修复和新模型支持照常，不再开发新功能），新用户注册已关闭。Apache 2.0 仓库仍可自托管。— [Helicone 官方博客](https://www.helicone.ai/blog/joining-mintlify)；[PostHog 对比](https://posthog.com/compare/best-helicone-alternatives)

**Laminar**
- Apache 2.0，有 Helm chart，开源镜像包含全部功能；有 Python/TS SDK，OTel 原生。云端免费档 1GB、7 天保留，Hobby $30/月，Pro $150/月。以上都来自 Laminar 自家文章，有利益偏向。— [Laminar 定价](https://laminar.sh/article/llm-observability-pricing)

**W&B Weave**
- 只查到概述：闭源，与 W&B 生态深度集成，评测框架强，有 OTLP 端点。— [Laminar Langfuse alternatives](https://laminar.sh/article/langfuse-alternatives-2026)

**CozeLoop（字节/Coze）**
- Apache 2.0，Go 语言编写，2025 年 7 月底开源。功能覆盖 prompt 开发与版本管理、评测（多维评分、agent 轨迹和工具选择评测、数据集管理、实验统计）、trace 观测。官方写明集成了火山方舟（Volcengine Ark），并支持经 OTel collector 上报 trace。可以用 Docker Compose 或 Helm 自托管；稳定镜像为 cozedev/coze-loop:1.0.0。— [GitHub coze-dev/coze-loop](https://github.com/coze-dev/coze-loop)；[Releases](https://github.com/coze-dev/coze-loop/releases)；[BytePlus 博客](https://www.byteplus.com/en/blog/coze-open-sources-ai-agent-tools)

**行业整合**
- 2026 年10 月的一篇文章列举：Promptfoo 并入 OpenAI，Galileo 并入 Cisco，Traceloop 加入 ServiceNow，Helicone 加入 Mintlify，Humanloop 关停。作者建议用 OTel 保持可迁移性。— [developersdigest](https://www.developersdigest.tech/blog/llm-observability-acquisitions-2026)

**Bun 兼容性**
- OTel Node SDK 大体能在 Bun 上运行，但 OTel 官方和主流 APM 都不正式支持 Bun。需要用 `bun --preload` 在代码里初始化；auto-instrumentation 和 AsyncLocalStorage 的上下文传播可能出问题，常见做法是手动创建 span，再加 `instrumentation-pg` 这类针对性的埋点。— [Datadog 文档](https://docs.datadoghq.com/opentelemetry/guide/instrument_unsupported_runtimes/)；[base14 Elysia/Bun](https://docs.base14.io/instrument/apps/auto-instrumentation/elysia/)；[Strapi Bun vs Node 2026](https://strapi.io/blog/bun-vs-nodejs-performance-comparison-guide)

**TS 评测运行器**
- Evalite（Matt Pocock，基于 Vitest，本地优先，带 UI，v1 beta）和 vitest-evals（David Cramer/Sentry，接入普通测试套件和 CI，支持 junit 报告），通常配合 autoevals 的评分器使用。Promptfoo 是 CLI/YAML 风格的回归测试和红队测试工具（现属 OpenAI）。— [InfoQ Evalite](https://www.infoq.com/news/2025/11/evalite-ai-testing)；[cra.mr vitest-evals](https://cra.mr/vitest-evals/)；[evalite v1 文档](https://v1.evalite.dev/)

### Inferences
- 先验已经有 Postgres 调用日志和事件日志，平台不是必需品。如果要上平台，按合适程度排：
  1. CozeLoop：原生支持方舟，开源，但它是 Go 的重型平台，部署成本不低。
  2. Langfuse 自托管：MIT，生态成熟，但要带上 ClickHouse，最低 9 vCPU，对小团队偏重。
  3. Langfuse Cloud Hobby/Core：对批处理量不大的场景可能够用；要注意 units 按 observation 计数，额度消耗会很快。
  4. Phoenix 自托管：单容器，较轻。
- 不建议押注 Helicone（维护模式）或 LangSmith（闭源、按席位收费）。
- 即使暂时不接平台，也建议把日志字段按 OTel GenAI 命名对齐（operation.name、provider.name、request.model、usage.input_tokens/output_tokens），以后导出到任何平台都容易。
- 在 Bun 上用 OTel 要手动埋点，不能依赖 auto-instrumentation。

### Gaps
- 各工具的官方定价页都没读到，数字来自第三方，且各来源有冲突（比如 LangSmith 超额价、Langfuse 企业自托管价）。
- Weave 的 TS SDK 现状、Braintrust 的 TS SDK 细节没查到。
- CozeLoop 的 TS SDK 支持情况和资源占用没查到。

## 4. 生产监控实践：抽样审计、漂移检测、护栏、失败突增告警、预算告警

### Takeaway
各方共识：基础指标（token、成本、延迟、错误）全量记录；质量评测（LLM judge）异步跑在 1–20% 的分层抽样上，出错、低分、成本或延迟异常的 trace 100% 保留；必须拦截的问题用同步护栏，先跑便宜的正则或分类器；成本预算在 50%/80%/100% 三档告警；对错误率、成本、延迟做异常检测告警。评判标准本身会漂移，所以人工抽检要持续做。

### Cited Findings
- 抽样：启发式检查跑 100%；LLM judge 按关心的维度（路由、模型版本等）分层抽 1–10%；被上游廉价检查标记的事件 100% 送检。另一说法是 5–20% 的抽样率，加上 100% 的错误和离群 span，judge 成本控制在线上 LLM 成本的 10–15% 以内。— [Future AGI 监控清单](https://futureagi.com/blog/production-llm-monitoring-checklist-2026/)；[Future AGI 实时评测](https://futureagi.com/blog/real-time-llm-evaluation-setup-2025/)
- Braintrust 的建议：基础指标（tokens、成本、延迟）全量记录，10–20% 的请求保存详细 trace，评测异步跑，不阻塞请求；每条 trace 都关联 prompt 版本号。— [Braintrust 2026](https://www.braintrust.dev/articles/best-llm-monitoring-tools-2026)
- Arize：护栏同步执行（拦截、改写、升级处理），其他在线评测异步执行，可以全量也可以抽样；护栏要追踪 precision、recall 和误报率。— [Arize LLM evaluation](https://arize.com/resources/llm-evaluation/)
- 预算：一个失控的 prompt 一夜之间就能烧掉数千美元，建议在预算的 50%、80%、100% 处告警；对延迟突增、成本跳升、错误率上升做异常告警。清单里还包括评测门禁 CI、漂移告警、供应商故障切换、带回放的 on-call runbook。— [Future AGI 清单](https://futureagi.com/blog/production-llm-monitoring-checklist-2026/)；[Pedro Alonso](https://www.pedroalonso.net/blog/llm-evaluation-monitoring-production/)
- 以上数字（抽样率、阈值）主要来自厂商博客，只能当起点参考，不是行业标准。— [同上](https://futureagi.com/blog/production-llm-monitoring-checklist-2026/)
- 评判标准会随着看到的输出而漂移，人工评分必须持续进行；prompt、模型或流水线一变，就要重新校准。— [Shankar et al. arXiv 2404.12272](https://arxiv.org/abs/2404.12272)
- Grafana 于 2026-04-21 推出 AI Observability 公开预览；Grafana Cloud 免费档含每月 50GB traces。— [ecorpit](https://ecorpit.com/grafana-cloud-agent-observability-llm-monitoring-setup-2026/)

### Inferences
- 先验的告警可以直接基于现有调用日志表的 `ok`/`error` 字段，按 kind/caller、5–15 分钟窗口算失败率，和过去 7 天同时段基线比较。按 error 文本归类（网络、搜索源、限流、解析失败）后再告警，能把搜索或网络中断和模型质量下降区分开。批处理任务应在失败率超阈值时自动熔断暂停，避免空烧费用。
- 漂移检测的低成本做法：每周固定抽 N 条（按 kind 分层）进人工复核队列，追踪 "人工同意率" 的周趋势。再加上分布类指标（每条 claim 的平均调用次数、被判 "无法判定" 的占比、引语校验失败率），换模型或换 prompt 后立刻能看到变化。
- 预算：按日、按月累计 cost units，在 50/80/100% 处告警；对单次运行设 cost 上限（agent 循环步数或 token 上限），防止失控。

### Gaps
- 没找到针对 "搜索/抓取类外部依赖中断" 的 agent 监控专门案例；以上建议是推断。
- 漂移检测的统计方法（PSI、KS 检验用在 LLM 输出上）没有查到权威来源。

## 5. 不引入平台、直接基于 Postgres 日志的轻量做法

### Takeaway
把 "每次模型调用一行" 写进 Postgres，再用 SQL 或 Grafana 出成本、错误率、延迟面板，是社区里常见且可行的做法。按 key 或用户统计花费这类高基数聚合，用 SQL 比 Prometheus 更合适。回归评测可以用 Vitest 系的 TS 评测运行器（Evalite、vitest-evals）配合 autoevals，从人工复核表里导出数据集，做成 CI 门禁。

### Cited Findings
- Grizzly Peak 的 Node 示例：`llm_logs` 表包含 model、provider、各类 tokens、latency_ms、estimated_cost_usd、status、endpoint 等字段，并给出按模型统计日成本、p95 延迟、按 endpoint 统计错误率的 SQL。原则是日志写入失败绝不能让应用崩溃。— [Grizzly Peak](https://www.grizzlypeaksoftware.com/library/logging-and-observability-for-llm-calls-somnl3zw)
- llm-gateway PR 的做法：每个请求一行 usage log（tokens、成本、延迟、重试次数、fallback、状态、错误码），由后台批量写入，请求不等待 Postgres。它解释了为什么按 key 统计花费要用 SQL 而不是 Prometheus：标签基数会爆炸。Grafana 面板用代码定义，同时配置 Prometheus 和 Postgres 两个数据源。— [GitHub PR](https://github.com/AndrewTtofi/llm-gateway/pull/6)
- 自托管 Langfuse 的指南提醒：token 数不会自动变成金额，需要自己维护价格表，并在供应商调价时更新。— [Codersarts](https://www.codersarts.com/post/llm-observability-with-self-hosted-langfuse-cost-tracking-prompt-a-b-testing-and-a-grafana-dashbo)
- Hamel 的 FAQ 强调先做错误分析和代码检查，再上 LLM judge；评测集应该来自真实 trace 和已确认的失败。— [hamel.dev FAQ](https://hamel.dev/blog/posts/evals-faq/)
- vitest-evals 的目标是让定性组件的每次改动都在 CI 里验证 "不比之前差"，可以和普通测试套件一起跑，也可以单独配置。— [cra.mr](https://cra.mr/vitest-evals/)
- 一个混合实践：确定性的 Vitest 评测作为 CI 门禁，Promptfoo 只在本地按需度量，不作为门禁。— [LeetSage PR #23](https://github.com/bhavishya7/LeetSage/pull/23)

### Inferences（针对先验的最小可行方案）
1. **回归评测集表**：例如 `eval_cases(id, kind, input_ref, expected_label, expected_fields jsonb, source='human_review', reviewed_at, failure_mode)`，从人工复核过的条目自动导入，按失败模式打标签，并给每类失败保留代表样本。
2. **评测运行表**：例如 `eval_runs(run_id, git_sha, prompt_version, model, started_at)` 和 `eval_results(run_id, case_id, pass bool, output jsonb, cost_units, trial_no)`。同一条用例跑 k 次，就能用 SQL 算 pass@1、pass^k 和单次成功成本。改 prompt 或换方舟模型时跑一遍，和上次运行做对比；新失败的用例就是回归。
3. **一致率面板**：用 SQL 比较模型判定和人工判定，按 kind 和周输出一致率、混淆矩阵、TPR/TNR。如果引入 LLM judge，也用同样方式校准 judge 本身。
4. **失败率与花费面板**：直接查现有调用日志表，按 kind/caller、小时/日统计失败率和 cost units，再按错误类型拆分。用 Grafana（Postgres 数据源）或 Metabase 出图，并设阈值告警和预算三档告警。
5. **trace 关联**：调用日志表加 `run_id`/`claim_id`/`prompt_version` 字段，就能把每次模型调用串到对应 claim 的事件日志上，相当于一个简化版 trace。字段名参照 OTel GenAI 约定，方便日后迁移。
6. **执行方式**：本地或 CI 用 Bun 脚本跑评测（或用 vitest-evals/Evalite），结果写回 Postgres。不依赖 SaaS，也不受 Bun 对 OTel 支持不完整的影响。

### Gaps
- 没找到明确主张 "只用 Postgres 做 LLM 可观测性" 的权威文章，也没找到 Metabase 方面的材料。
- Evalite、vitest-evals 在 Bun 运行时（`bun test` 而非 Vitest）上的兼容性没有确认。
- 方舟自带的用量和账单接口（arkcli usage/billing）能否和自建 cost units 对账，本次没有研究。
