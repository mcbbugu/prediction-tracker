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

