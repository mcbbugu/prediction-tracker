# 008 按需分析：按 IP 限流和排队

负责人：Cursor
优先级：P1

## 目标

不登录也能用，但不会被刷爆 AFP 预算（SPEC P7「限流」）。

## 背景

`POST /v1/analyze`（`api/src/index.ts`）现在只有全站并发上限 `MAX_RUNNING_JOBS` 和每日上限 `DAILY_JOB_LIMIT`，超出直接返回 429。

## 做法

1. `jobs` 表加 `client_ip` 列（存 IP 的 SHA-256 加盐哈希，不存明文；盐从环境变量 `IP_HASH_SALT` 读，写进两个 `.env.example`）。IP 取法：信任 `X-Forwarded-For` 的第一个，仅当环境变量 `TRUST_PROXY=1`。
2. 同一 IP 24 小时内新建分析超过 3 次 → 429，提示「每天最多发起 3 次新分析，已收录的人物可以随便看」。复用已有任务（`reused: true`）不计数。
3. 全站并发满时不再拒绝：任务状态为 `queued`，前一个完成后自动开始；`GET /v1/jobs/:id` 返回 `queue_position`。任务页显示「排队中，前面还有 N 个」。
4. 每日全站上限保留。
5. 加测试：同 IP 第 4 次被拒、不同 IP 不受影响、排队顺序正确。

## 范围

- `api/src/index.ts`、`api/src/core/migrate.ts`、`api/src/jobs/*.ts`
- `api/.env.example`、`.env.example`
- `src/app/jobs/[id]/*`（只加排队提示）
- 测试文件

## 验收标准

- [ ] 测试覆盖上面三种情况
- [ ] 通用检查全部通过

## 完成记录

提交 `77050c6`。同一 IP 24 小时内新建分析超过 3 次会 429，提示「每天最多发起 3 次新分析，已收录的人物可以随便看」。地址只存加盐 SHA-256。`TRUST_PROXY=1` 时才用 `X-Forwarded-For` 的第一个。复用已有任务不插新行，所以不计数。全站每天上限还在。

并发满了不再拒绝：任务留在 `queued`，有空位就按创建顺序自动开始。worker 不再领 `runner=api` 的任务，避免把排队的分析抢走。`GET /v1/jobs/:id` 返回 `queue_position`。任务页在排队时写「排队中，前面还有 N 个」。

测试：同一哈希第 4 次不允许、另一个哈希可以；前面有正在跑的任务时，后插入的排队位置更大。事务回滚，没有留下测试行。api 78 项测试、lint 和 tsc 通过。

`IP_HASH_SALT` 写在 `api/.env.example`。本机 `api/.env` 还没填的话，哈希盐是空字符串，限流仍然有效，只是盐不够长。

