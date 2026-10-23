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

