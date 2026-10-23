# 010 双模型交叉判定 + 异常通知

负责人：Cursor
优先级：P1
依赖：007（自动收录标签）

## 目标

人工只看模型之间有分歧的条目（SPEC「人工的边界」）。

## 做法

1. **交叉判定**：按需分析里每条到期判定做完后，用不同的提示词（或不同模型，如方舟里另一个可用模型）独立再判一次，只给原话、期限和已存档的证据，不给第一次的结论。
   - 两次一致：照常公开。
   - 不一致：仍公开，但标「有分歧」，进 `/review` 的分歧队列，两次结论和理由都显示出来。
   - 人工裁定后，结论写回并去掉「有分歧」。
2. 「自动收录」人物下的主张全部一致、且没有未处理的反证时，`curation` 改为 `'cross_checked'`（标签「自动收录 · 双模型一致」）；不要写成 `reviewed`，那个只留给人工。
3. **异常通知**：新建 `api/src/core/notify.ts`，环境变量 `NOTIFY_WEBHOOK`（通用 webhook，可接 Telegram、飞书或 Slack），没有配置就只写日志。触发条件：
   - AFP 当日用量超过 80%
   - 熔断打开
   - 同一类任务连续失败 3 次
   - 有新反证提交
   同一条件一小时内只发一次。写进两个 `.env.example`。
4. 计入 AFP：第二次判定不联网搜索，只用已存档的证据。

## 范围

- `api/src/claims/verdict.ts`、`api/src/claims/discover.ts`、`api/src/core/notify.ts`（新建）、`api/src/core/ark.ts`（熔断处触发通知）、`api/src/core/migrate.ts`、`api/src/index.ts`
- `src/components/review-desk.tsx`（加分歧队列）、`src/components/status-pill.tsx` 或相关标签组件
- `api/.env.example`、`.env.example`、测试文件

## 验收标准

- [ ] 测试：一致时直接公开；不一致时进队列；人工裁定后标签消失
- [ ] 通知去重的测试
- [ ] 完成记录里写明一次真实分析的分歧率
- [ ] 通用检查全部通过

## 完成记录

