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

- [ ] 对 005 的「陆奇」任务（8e69ecd4…）或任意一个新任务跑 replay，输出「一致」
- [ ] 用另一个提示词版本跑一次，贴出差异报告
- [ ] 通用检查全部通过

## 完成记录

