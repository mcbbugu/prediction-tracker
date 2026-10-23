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

