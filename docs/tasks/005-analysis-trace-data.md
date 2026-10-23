# 005 按需分析：每一步记录完整细节（后端）

负责人：Cursor
优先级：P0

## 目标

任务页要能把整个过程讲清楚（SPEC P7「过程全公开」）。本任务只做后端：让每个事件的 `data` 带够信息，前端在 006 做。

## 背景

- 流程在 `api/src/claims/discover.ts`，到期判定在 `api/src/claims/verdict.ts`，事件存在 `job_events`（step、status、message、data）。
- 任务接口：`GET /v1/jobs/:id`（`api/src/index.ts`）。

## 做法

每一步结束时，事件 `data` 至少包含：

| 步骤 | data 要有 |
| --- | --- |
| 识别人物 | 候选人物列表、选中的理由、是否在收录范围 |
| 搜索公开发言 | 每个搜索词和它返回的链接 |
| 存档网页 | 每个链接：成功或失败原因、抓取途径（direct/browser/jina）、SHA-256、Wayback 链接、证据 id |
| 抽取预测 | 每条候选：原话、期限、来源证据 id |
| 核对原话 | 每条候选：通过或丢弃、丢弃理由 |
| 到期核对 | 每条：判定、采信的证据 id、被丢弃的证据及理由 |
| 利益关系 | 新增的每条关系及出处 |
| 完成 | 总耗时、本任务调用联网搜索的次数（从 `ark_calls` 统计） |

已有的字段不要删，只补充；旧任务的事件不需要回填。`GET /v1/jobs/:id` 原样返回 data 即可。

## 范围

- `api/src/claims/discover.ts`、`api/src/claims/verdict.ts`
- `api/src/index.ts`（只有任务接口需要时）
- 对应的测试文件

## 验收标准

- [ ] 本机跑一次按需分析（选一个库里没有的人），完成记录贴出各步骤 data 的样例
- [ ] 通用检查全部通过

## 完成记录

提交 `55081d3`。`discover.ts` 和 `verdict.ts` 在原有事件字段上补了步骤数据。`GET /v1/jobs/:id` 本来就原样返回 `data`，没有改接口。

本机对库里没有的「陆奇」跑了一次，任务 `8e69ecd4-c31f-4512-a896-ecc3fab654e0`，约 563 秒，联网搜索 6 次，新建人物 `qi-lu`。模型没有抽出带期限的原话，所以没有到期判定；利益关系新增 28 条。这次跑完之后才补上「没有到期主张也写一条空的到期核对」，所以下面没有那一步的实跑样例，形状在 `api/tests/discover-trace.test.ts` 里。

识别人物：

```json
{"name_zh":"陆奇","name_en":"Qi Lu","title":"奇绩创坛创始人及首席执行官","in_scope":true,"reason":"公开身份是科技高管，不是政治人物","candidates":[{"name_zh":"陆奇","name_en":"Qi Lu","why":"履历与微软、百度、奇绩创坛一致"}]}
```

搜索公开发言：`searches` 是每个搜索词和它返回的链接（中英各一次，第一条 23 个链接），原来的 `urls` 仍是筛过的 14 个。

存档网页（成功 / 失败各一条；Wayback 要等单独的快照任务，当时是 null）：

```json
{"ok":true,"url":"https://news.qq.com/rain/a/20260916A0CZ2Y00","reason":null,"fetched_via":"direct","sha256":"1460b4198915383368aa3516929e306eaa8a26c868e5e9d55bc0267310f86454","wayback_url":null,"source_id":3187}
{"ok":false,"url":"https://finance.sina.com.cn/meeting/2017-03-27/094328584618.shtml","reason":"HTTP 404","fetched_via":"direct","sha256":"e7fca5f735583525b10b7fc07d41729c75aeffb3e8e8294185d0877b97b103fc","source_id":3195}
```

抽取预测：`{"candidates":[]}`。核对原话：`{"kept":[],"dropped":[]}`，有候选时每条带 `outcome` 和 `reason`。

利益关系一条：`{"id":560,"kind":"role","counterparty":"MiraclePlus","counterparty_zh":"奇绩创坛","role":"创始人兼CEO","source_url":"https://cdss.berkeley.edu/qi-lu","publication":"published"}`。

完成：`{"elapsed_ms":562596,"search_count":6,"claims_found":0,"interests_found":28}`。`search_count` 按本进程在 `ark_calls` 里这次任务之后新增的 `kind=search` 计数。

`cd api && bun run typecheck && bun run test`：74 通过。根目录 `pnpm lint` 和 `npx tsc --noEmit -p .` 通过。

