# 011 模型调用内容寻址与可重放

负责人：Cursor
优先级：P0

## 目标

数据架构第 2 层（见 `docs/数据架构.md`）：每次模型调用可追溯、可重放，换模型能自动出差异报告。

## 背景

- 方舟调用集中在 `api/src/core/ark.ts`，调用记录在 `ark_calls` 表。
- 存档已有 SHA-256（`api/src/evidence/`）。

## 做法

1. 新表 `model_calls`：`id`（输入哈希 = sha256(模型名 + 提示词 + 参数 + 输入)）、模型名、提示词版本、参数、输出（jsonb）、输出哈希、耗时、`created_at`。同一个 id 重复调用时直接读缓存（加 `ARK_REPLAY=1` 时只读缓存、缓存缺失就报错；默认读缓存仍可用，`ARK_CACHE=off` 关闭）。联网搜索也照此缓存，按 query 加日期分桶。
2. 提示词抽成带版本号的常量（如 `EXTRACT_V3`），版本号进哈希。
3. 主张、判定、利益关系的记录里，写上产生它的 `model_call_id`（新列，可为空，旧数据不回填）。
4. 新脚本 `api/src/tools/replay.ts`：
   - `--job=<id>`：用缓存重跑某个分析任务，产物必须与库里一致，输出「一致」或差异。
   - `--job=<id> --model=<名字>` 或 `--prompt=<版本>`：用新模型或新提示词重跑，不写库，输出差异报告（新增、消失、改判的主张）。
5. 测试：同输入两次调用只打一次模型；重放结果逐字节一致。

## 范围

- `api/src/core/ark.ts`、`api/src/core/migrate.ts`、`api/src/claims/*.ts`、`api/src/interests/*.ts`、新建 `api/src/tools/replay.ts`、`api/package.json`、测试文件

## 验收标准

- [x] 对 005 的「陆奇」任务（8e69ecd4…）或任意一个新任务跑 replay，输出「一致」
- [x] 用另一个提示词版本跑一次，贴出差异报告
- [x] 通用检查全部通过

## 完成记录

提交 `f6fda7e`。`model_calls` 用输入哈希当 id。同样的模型、提示词、版本、参数和输入再调用时直接读缓存，不打第二次模型。`ARK_REPLAY=1` 只读缓存，缺失就报错。`ARK_CACHE=off` 每次都打模型。联网搜索按 query 加上海时区的日期分桶。

提示词版本进哈希：抽取是 `EXTRACT_V1`，判定是 `JUDGE_V1`，交叉判定是 `CROSS_V1`，利益关系是 `RELATIONS_V1`。主张、`verdict_proposals`、利益关系加了可空的 `model_call_id`，旧行不回填。

`bun run replay -- --job=<id>` 用缓存对照库里的产物。换 `--model` 或 `--prompt` 不写主张，只打差异。版本族对得上时，`EXTRACT_V2` / `JUDGE_V2` 会在原提示词后加一句新要求。

陆奇那次任务（`8e69ecd4-c31f-4512-a896-ecc3fab654e0`）发生在缓存上线之前，主张上没有 `model_call_id`，脚本说明无法重放。用一条事务里建好、随后回滚的样本任务跑出来是「一致」。换提示词的差异报告：

```
差异报告（提示词 EXTRACT_V2）
新增主张
- Beta will ship by 2031.
消失主张
- Alpha will ship by 2030.
改判
（无）

差异报告（提示词 JUDGE_V2）
新增主张
（无）
消失主张
（无）
改判
- Alpha will ship by 2030.：已兑现 → 未兑现
```

验证：`bun run typecheck`、84 项测试、根目录 `pnpm lint` 和 `tsc` 通过。同输入两次只打一次模型，第二次输出和第一次逐字节相同。

