# 026 无人工阶段的披露、来源层级与三处修复

负责人：Cursor
优先级：P0
关联 issue：#1、#2、#5

## 目标

SPEC「近期版本：暂不做人工审核」：机器判定照常计分，但处处如实说明，并让下游 AI 能区分来源。顺带修审查确认的两个问题。

## 做法

1. **来源层级**：每条已判定主张返回 `verdict_tier`：`human`（人工写或人工裁定）、`seed_autocheck`（种子经自动核对）、`machine`（worker 自动判定）、`on_demand`（按需分析判定）。从 `provenance`、`claim_events` 推出来，不需要新人工数据；推不出的标 `machine`。`/v1/prior`、consult、MCP `get_prior` 都返回这个字段，并在顶层加 `verdict_tiers`（各层条数）和 `disclosure`（固定文字：「判定由 AI 完成，尚未经人工校准；准确率见 /method#eval」）。
2. **页面披露**：人物页分数旁一行小字「AI 判定 · 未经人工校准」，可点到方法页；方法页加一段说明当前阶段的做法（评测台有结果后显示准确率，没有就写「评测中」）。
3. **反证自动重判**：提交反证后自动把对方证据存档、加入证据重新判定一次（复用 `verifyClaim`）。结论变了 → 更新判定、标「有争议」、写 `claim_events`；没变 → 保留，公开显示「已复核，结论不变」和理由。仍发通知（010）。
4. **修复：无证据判定不计分**（审查 #5 第一点）：`api/src/scoring/score.ts` 第 122 行附近，`evidence_count = 0` 的已判定主张改为作废（同「证据不足」），不再按 0.5 计；作废数照常报告。加测试。现在库里这类主张是 0 条，分数不应变化，完成记录确认这一点。
5. **修复：分析任务并发与限额竞争**（审查 #5 第二点）：`api/src/jobs/analyze-limit.ts` 的 `claimNextApiAnalysis`，以及 `api/src/index.ts` 里 `/v1/analyze` 的每日上限和单 IP 上限检查，都放进事务，并用 `pg_advisory_xact_lock` 串行化「检查 + 插入 / 认领」。加并发测试：并发 10 个请求，不超过上限。
6. 交叉判定标签保持「双模型一致」，不改成「已核实」（审查 #2 的结论：它只证明读证据一致，不证明事实独立核实）。方法页写明这一点。

## 范围

- `api/src/queries/*.ts`、`api/src/index.ts`、`api/src/scoring/score.ts`、`api/src/jobs/analyze-limit.ts`、`api/src/claims/verdict.ts`（反证重判入口）
- 人物页分数区、`src/app/method/page.tsx`、`src/lib/api.ts`
- 测试文件

## 验收标准

- [ ] `/v1/prior?person=musk` 返回 `verdict_tiers` 和 `disclosure`，贴样例
- [ ] 并发测试通过；无证据计分测试通过
- [ ] 完成后在 GitHub issue #1、#2、#5 下回复做了什么（`gh issue comment`），不要关闭 issue
- [ ] 通用检查全部通过

## 完成记录

