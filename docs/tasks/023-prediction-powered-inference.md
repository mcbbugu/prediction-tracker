# 023 预测驱动推断：用更少的人工给出有效区间

负责人：Cursor
优先级：P1

## 目标

SPEC 校准规则（2026-10-23）：一致率区间改用 Prediction-Powered Inference（PPI），人工条数下限降到 50 条、每层 5 条。

## 背景

- 校准代码：`calibration_items` 表、`/v1/calibration*` 接口（`api/src/index.ts`），校准页 `src/app/review/calibration/`。
- 参考：Angelopoulos, Bates, Fannjiang, Jordan, Zrnic，*Prediction-Powered Inference*（Science, 2023）；以及其分层抽样版本。

## 做法

1. 新建 `api/src/scoring/ppi.ts`（纯函数）：
   - 输入：全部机器判定（N 条，模型的判定）、人工盲标子集（n 条，人和模型的判定）、分层权重。
   - 估计量：机器判定的「被人认可率」 = 模型在全量上的估计 + 人工子集上的校正项（人与模型差异的均值），按层加权。
   - 区间：用 PPI 的正态近似给 95% 区间；n 很小时退回保守的 Wilson 区间，取两者中更宽的。
2. 校准页和 `/v1/calibration` 同时显示旧算法（Wilson）和 PPI 的区间，以及是否达标（按新门槛）。
3. 主动挑样：下一条给人标的条目，从「对区间宽度贡献最大」的层里抽（按层方差 × 层大小排序），仍保持层内随机，不让人看到模型结论。
4. 方法页写清算法、文献和门槛。

## 范围

- 新建 `api/src/scoring/ppi.ts`、`api/src/index.ts`（校准接口）、校准页、`src/app/method/page.tsx`、`src/lib/api.ts`
- 测试文件

## 验收标准

- [ ] 用模拟数据测试：真实一致率 0.92 时，1000 次模拟中 95% 区间覆盖真值的比例在 93%～97%
- [ ] 同样的人工条数，PPI 区间不宽于 Wilson 区间（模拟中统计）
- [ ] 通用检查全部通过

## 完成记录

