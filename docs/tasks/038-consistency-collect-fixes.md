# 038 自动可信度采集：时间条件、去重、言行对照的方向

负责人：Cursor
优先级：P0（这三处都会直接扭曲可信度分数）
关联 issue：#10、#11、#12

## 问题（已核对属实）

1. **#10 时间条件没校验**：`api/src/consistency/collect.ts:17` 只用正则检查日期格式；`oneTopic()` 只在非 walk 时把前后颠倒的 a/b 换过来，没有检查 `data/consistency/README.md` 规定的间隔：`reaffirm` 至少相隔 1 年，`walk` 的建议和行动相隔不超过 2 年。日期由模型给出，没有对照出处核实。
2. **#11 只按话题文字去重**：`collect.ts:197` 的主键是 `人物 + sha256(话题文字)`。措辞不同、引文相同的两个话题会各入库一条，领域满 5 条就出分，同一件事会被重复计数。
3. **#12 言行对照只能是「不一致」**：`collect.ts:47` 的 `proposedLabel` 把所有 walk 一律判为 `inconsistent`，`collect.ts:154` 的提示词也把 walk 定义成「后来的行动和说法相反」。言行一致的例子收不进来，分数系统性偏低。手工采集的 `check.ts` 没有这个问题。

## 做法

1. **时间条件**（纯函数，加单元测试）：
   - 日期必须是真实存在的日历日期（排除 2026-02-30 这类）。
   - `reaffirm`：b − a ≥ 365 天。
   - `walk`：|行动日期 − 建议日期| ≤ 730 天。
   - `reversal`：b 必须晚于 a；同一天的不收。
   - 不满足条件的记为 `no_counterpart`，并写明原因，不入库。
2. **日期要有出处**：区分「模型给的日期」和「核实过的日期」。核实方式：日期出现在原话附近的正文里，或者页面元数据里有发布日期且原话就出自该页面。核实不了的不进正式对照；不能拿抓取日期冒充说话日期。
3. **去重**：
   - 证据指纹 = 人物 + 类型 + 规范化后的 a 原话 + 规范化后的 b 原话（规范化：去掉标点和空白、统一大小写）。同一句话换个网址也算重复。
   - 在 `consistency_pairs` 上加指纹列和唯一约束（只对新数据生效，旧数据先补算指纹）。入库用 `ON CONFLICT (fingerprint) DO NOTHING`，并发写入由数据库保证不重复。
   - 同一话题下确实是不同事件的（a、b 都不同），允许分别记录。
4. **言行对照的方向**：
   - 提示词改为：「建议与他本人同期公开行动的对照，相符和相反都要找」。
   - 模型另外输出 `relation: match | contradict | unclear`，并引用行动证据句；`unclear` 不入库。
   - `proposedLabel` 改为 walk + match → consistent，walk + contradict → inconsistent，不再仅凭 kind 推导。
5. **排查已有数据**（只读，出清单）：
   - 自动采集入库的对照里，不满足时间条件的、指纹重复的、所有 walk 都被判为不一致的。
   - 受影响的条目把 `publication` 改回 `proposed`，写 `claim_events` 或对照自己的事件记录，不删行，然后重算分数。
6. 测试：同一天、364/365/366 天、两年边界前后、无效日期、模型日期和出处冲突；不同话题同一组引文；同一引文不同网址；并发入库；walk 的 match / contradict / unclear 三种情况。

## 范围

- `api/src/consistency/collect.ts`、`api/src/consistency/*.ts`（如需抽公共函数）、`api/src/core/migrate.ts`、`api/src/scoring/consistency.ts`（只在重算时用）
- 新建排查脚本 `api/src/tools/audit-consistency.ts`、测试文件

## 验收标准

- [ ] 完成记录：受影响的对照数量（按三类问题分列）、退回复核的条数、重算前后受影响人物的可信度分
- [ ] 所有边界测试通过；通用检查全部通过
- [ ] 在 issue #10、#11、#12 下回复，不关闭

## 完成记录

