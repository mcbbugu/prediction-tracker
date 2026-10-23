# 001 加索引、去掉 N+1 查询

负责人：Cursor
优先级：P1

## 目标

常用接口变快，返回内容一个字段都不变。

## 背景

- 性能体检报告：`/tmp/cursor-jobs/perf-report.md`（本机文件）。如果文件不在了，自己用 `EXPLAIN ANALYZE` 和接口耗时重新测，找出最慢的三处。

## 做法

1. 改之前用 curl 存下 `/v1/consult`、`/v1/prior?person=musk`、`/v1/people/musk`、`/v1/home` 的响应和耗时（接口在 http://localhost:3011）。
2. 按报告「收益排序」实施前三条：
   - 报告给的索引写进 `api/src/core/migrate.ts`，用 `CREATE INDEX IF NOT EXISTS`，放在相关表建表语句之后；不改已有索引。
   - N+1 查询（比如 consult 里逐个人查分数）改成一次批量查询。
3. 改完再测一次，逐字段对比响应（只允许耗时不同）。

## 范围（只能改这些文件）

- `api/src/core/migrate.ts`
- `api/src/queries/*.ts`
- `api/src/index.ts`（只动报告点名的查询）

## 验收标准

- [ ] 四个接口改前改后响应一致
- [ ] 前后耗时对比写进提交说明和完成记录
- [ ] 通用检查全部通过

## 完成记录

做了报告里不改变返回字段的两项：索引，以及 consult 的分数 N+1。

- `api/src/core/migrate.ts`：按报告加了 12 条 `CREATE INDEX IF NOT EXISTS` 和 `pg_trgm`（当前账号是超级用户，扩展装上了）。放在对应表或它依赖的列出现之后，没有改已有索引。
- `api/src/queries/records.ts`：新增 `latestScoresFor`，一次取出多人的最新分数。`已移除` 放在 `DISTINCT ON` 之后再滤掉。库里有 20 个领域的最新快照就是「已移除」，若按报告原文把条件写进 `DISTINCT ON`，会把更早的一条捞回来，返回就会变。
- `api/src/queries/consult.ts`：匹配出人物之后再查分数，只查这些人，不再对每个公开人物各查一次。

没做报告收益 ①②。① 要砍掉 `/v1/home` 的全量主张，返回字段会变，也要改前端，超出本任务允许的文件。② 要少传给模型的人名，`parsed` / 先例 / 校准说明都会变。空查询分支也没有截成 20 人，否则没写人名时返回的人物会变少。

验证：

- 36 位公开人物：`latestScoresFor` 和逐人 `latestScores` 的 JSON 一致（0 处不同）。36 人串行 11.4 ms，一次聚合 5.3 ms。
- 改前改后 JSON：`/v1/home`、`/v1/prior?person=musk`、`/v1/people/musk` 逐字段相同。consult 的分数、主张、证据链、`decay_weight` 相同。`timestamp`、模型写的 `directive`，以及不指定 `person_id` 时模型重写的 `claim` 措辞和先例说明，两次调用本来就会不同。指定 `person_id=musk` 时 `parsed` 和先例也相同。
- 耗时（各 5 次，取中位；consult 各 2 次）：home 25.4 → 9.3 ms，prior 9.5 → 11.0 ms，people/musk 7.1 → 19.3 ms，consult 约 8.8 → 9.4 s。当前一百多条主张，Postgres 仍可能继续全表扫描；consult 的时间几乎全在模型上。索引是为人物上千、主张上万之后准备的。
- `cd api && bun run typecheck && bun run test`：70 通过。根目录 `pnpm lint` 和 `npx tsc --noEmit -p .` 通过。

遗留：首页全量下发、`parseQuery` 整份名录、空查询打到全部人物，都还在。要改的话会动返回内容或前端，需要单独开任务。

