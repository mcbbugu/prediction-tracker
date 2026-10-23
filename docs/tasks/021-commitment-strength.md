# 021 承诺强度与本人校准

负责人：Cursor
优先级：P1
依赖：012（在同一个结构化步骤里加字段）

## 目标

前沿路线第 6 项：区分「肯定会」和「也许会」，并看这个人说「肯定」时实际有多准。

## 做法

1. **强度等级**：抽取或结构化步骤给每条主张加 `confidence_level`：
   - `certain`（肯定、一定、will、guarantee）
   - `likely`（很可能、expect、should）
   - `possible`（也许、可能、could、hope）
   - `unstated`（没有强度表述）
   同时存 `confidence_cue`：触发判断的原文词语，必须逐字出现在原话里（程序核对，和原话核对同一规则），核对不过就记 `unstated`。
2. 已有主张回填：只用原话文本，模型判断 + 程序核对 cue，提示词带版本号（复用 011 的缓存）。
3. **本人校准**（`api/src/scoring/indicators.ts` 加一项）：按强度等级分组算兑现率（带 Wilson 区间），样本少于 5 条的组显示「样本不足」。
   - 指标「过度自信度」= certain 组兑现率与 likely 组兑现率之差；差值不显著时不下结论。
4. **展示**：
   - 主张行和详情页显示强度小标签（肯定 / 很可能 / 也许），悬停显示 cue 原文。
   - 人物页画像旁证加「说『肯定』时的兑现率」。
   - 方法页说明分级规则和 cue 必须逐字出现。
5. 给 020 留接口：难度计算可选择性用强度调整 p₀（本任务不改 020 的逻辑）。

## 范围

- `api/src/claims/*.ts`（抽取或结构化步骤）、`api/src/scoring/indicators.ts`、`api/src/core/migrate.ts`、`api/src/queries/*.ts`、新建回填脚本 `api/src/tools/backfill-confidence.ts`、`api/package.json`
- 主张列表与详情、人物页画像区、`src/app/method/page.tsx`、`src/lib/api.ts`
- 测试文件

## 验收标准

- [ ] 回填统计：各等级条数；cue 核对失败的条数
- [ ] 中英文各 5 句的分级单元测试（固定缓存，离线）
- [ ] 通用检查全部通过

## 完成记录

