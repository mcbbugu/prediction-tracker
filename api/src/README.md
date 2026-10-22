# api/src 目录

按职责分目录。新文件放进对应目录；跨目录用相对路径 import。`index.ts`（HTTP 接口入口）留在根目录。

| 目录 | 放什么 |
|---|---|
| `core/` | 数据库连接（`db`）、迁移（`migrate`）、方舟调用（`ark`：限速、预算、熔断、启动预检） |
| `evidence/` | 证据存档：抓取与回退链（`sources`，含本机浏览器 `render.mjs`）、Wayback 提交 |
| `people/` | 人物：头像、种子导入与种子核对 |
| `claims/` | 主张：按需发现（`discover`）、到期核对（`verdict` / `verify`）、原话复核、改期串、领域归并、旧版 agent |
| `interests/` | 利益关系：任职持股（`interests`）、机构敞口（`exposures`）、机构名归一（`orgs`）、SEC 营收、合并机构名 |
| `scoring/` | 计分公式（`score`）、校准协议（`calibration`）、画像旁证（`indicators`） |
| `queries/` | 接口用的读取查询（`records`）、consult |
| `jobs/` | 任务队列的 worker、入队、批量 |
| `tools/` | 一次性的检查工具（联网搜索探针） |

脚本入口都在 `api/package.json` 的 scripts 里（`pnpm api:<name>`）。读仓库根目录下 `data/` 的脚本用 `join(dirname(fileURLToPath(import.meta.url)), "../../..")` 定位根目录；挪动文件时注意层级。

`queries/prior.ts` 是 consult 第一层（只查库的先验，`GET /v1/prior`）；`queries/mcp.ts` 把它包成 MCP 工具 `get_prior`（`POST /mcp`）。
