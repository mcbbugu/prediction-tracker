# 先验 · 公众人物说过的话，后来兑现了多少

把公众人物带期限的公开预测和承诺逐句对回原文，到期后对照公开资料核对结果，按领域算出兑现率；他给别人的建议和立场前后是否一致，也单独记一项；利益关系并排标出。别的 AI 在采信某人的一句新说法之前，可以通过 `/v1/prior`、`/v1/consult` 或 MCP 先查这个人的记录。

**产品方向、原则和计分口径都在 [SPEC.md](./SPEC.md)。开发前先读它。**

## 现状（2026-10-26）

- 公开人物 67 位，主张 364 条，其中 69 条已到期判定，23 人在至少一个领域有分数。大部分人物目前还是「样本不足」。
- **判定由 AI 完成，尚未经人工校准。** 每条判定带来源层级（人工 / 种子自动核对 / 机器 / 按需分析），网站、`/v1/prior` 和 consult 的返回里都会写明这一点。第一轮人工盲标（40 条）排在接下来两周（[042](docs/tasks/042-blind-check-small.md)）。
- 先验对下游 AI 有没有用，还没有被证明：上一次对照实验测不出差别（见 [037](docs/tasks/037-point-in-time-eval.md)）。
- 接下来两周只做「证明价值」三件事：线上实时调研能不能用、AI 判得准不准、先验对下游有没有用。进展见 [任务看板](docs/tasks/BOARD.md)。

## 每个数字都能追到原文

- 每条主张必须逐字出现在程序自己存档的网页里（原始字节和正文都存哈希），页面写明说话人是此人。分「原话」和「转述」两类，转述在页面上标出。
- 判定为已兑现、部分兑现、未兑现时，至少附一条同样逐字核对过的证据；查不到可靠结果就是「证据不足」，作废、不计分。
- 模型只负责找候选链接和提出判定，网页由程序打开和存档；模型调用按内容寻址存下，可以重放。
- 分数快照只追加不覆盖，每次变化都写明是哪几条主张引起的。任何人都可以提交反证，复核期间标「有争议」。

## 计分

- 分数按领域算，不做跨领域的总分。承诺（结果在本人控制之内）和预测分开算：前者叫靠谱度，后者叫判断力。
- 已兑现 1、部分兑现 0.5、未兑现 0；按截止日距今加时间权重（半衰期 3 年），中性先验把小样本拉向 50。
- 一个领域有 1 条已判定就出分，旁边总是同时给 80% 区间和条数，例如「56（25–85）· 1 条」。0 条显示「样本不足」。
- 同一承诺反复改期再说，连成一串，整串 k 条合计按 √k 条计分。
- 当前公式版本 v1.3，细节和改动记录见 SPEC「分数显示」。

## 收录范围

- 收：企业家、投资人、科技与科学人物、经济学家、分析师、媒体评论员、体育与文化界公众人物。
- 不收：主要身份是政治人物的人（现任或前任政府官员、民选官员和候选人、政党人员、政府发言人），所有国家一视同仁。企业家兼任人大代表、政协委员这类兼职代表席位，或短期担任顾问类职务，照常收录。
- 任何人关于选举结果和政府政策的说法都不收；私人个体和只在私人场合说的话不收。

## 本地运行

需要 Docker、Bun 和 Node（pnpm）。

```bash
pnpm install
pnpm api:docker   # Postgres，端口 5434
pnpm api:seed     # 迁移数据库，导入人物和 data/people/*.json 里人工整理的种子主张
pnpm api:dev      # 接口 http://127.0.0.1:3011
pnpm dev          # 网站 http://localhost:4321
```

模型和搜索用的是火山方舟，密钥写在 `api/.env`：`ARK_API_KEY`、`ARK_BASE_URL`、`ARK_MODEL`。完整的环境变量说明见 `api/.env.example` 和 `.env.example`。

后台工作（按需分析、到期核对、可信度采集）都排进 `jobs` 表，由 worker 执行：

```bash
pnpm api:enqueue -- due        # 已过期、仍待定的主张 → 到期核对
pnpm api:enqueue -- status     # 队列状态和今日搜索额度
pnpm api:worker -- --publish   # 执行队列（本机模式自动公开）；--once 队列空了就退出
```

人工入口只有两个：`/review`（反证和模型分歧）和 `/review/calibration`（盲标），口令是 `api/.env` 的 `REVIEW_TOKEN`。更多命令见 SPEC「本地运行」。

## 上线清单

本机能跑不等于能上线。部署前逐项确认：

1. **数据库**：托管的 Postgres 16，`api/.env` 的 `DATABASE_URL` 指向它；接口启动时自动迁移。定期备份（证据存档和判定是只追加的，丢了补不回来）。
2. **接口**（`cd api && bun run start`，常驻）：
   - `NODE_ENV=production`：生产环境下本机模式（`AUTO_PUBLISH=1`）会让接口和 worker 拒绝启动；
   - `REVIEW_TOKEN` 至少 24 个字符；
   - `CORS_ORIGINS` 设为网站的域名；`SITE_URL` 设为网站地址（consult / MCP 返回的链接用它）。
3. **worker**（`cd api && bun run worker`，常驻）：到期核对和按需分析都靠它。
4. **网站**（`pnpm build && pnpm start`）：`.env.local` 的 `NEXT_PUBLIC_API_URL` 填浏览器能访问到的接口地址，`API_URL` 可填内网地址。
5. **抓取**：服务器上装本机浏览器（`cd api && node node_modules/playwright/cli.js install chromium`），没装则跳过这一级回退；`JINA_API_KEY`、`IA_ACCESS_KEY` / `IA_SECRET_KEY` 按需填写。
6. **每日扩库**（可选）：`deploy/com.prediction-tracker.expand.plist` 是 macOS 定时任务模板，把里面的 `/path/to/prediction-tracker` 换成你的目录后再用 `launchctl load` 启用。

## 目录

```
src/                 Next.js 网站和审核台
api/src/             接口（Elysia）、发现与核对流水线、计分、任务队列、迁移
api/sql/init.sql     新数据库的表结构；旧库由 api/src/core/migrate.ts 补齐
data/people/         人工整理的种子主张（真实出处）
data/batches/        建库用的人物名单
data/eval/           评测数据和报告
docs/tasks/          开发任务和看板
public/portraits/    授权人物照片（出处和许可见各人物页）
```

## 许可

MIT
