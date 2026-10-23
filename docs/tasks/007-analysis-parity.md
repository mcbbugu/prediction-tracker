# 007 按需分析补齐模块 + 「自动收录」标签

负责人：Cursor
优先级：P0

## 目标

自动生成的人物页和人工收录的一样完整；页面上标明「自动收录 · 未经人工复核」（SPEC P7）。

## 做法

1. **先盘点**：拿一个人工收录的人（如 musk）和一个按需分析出来的人，对比人物页每个模块有没有数据，结果写进完成记录。
2. **补齐流程**：在 `discover.ts` 的利益关系之后补上缺的步骤，每步照常 emit 事件：
   - 如果此人关联的公司在 SEC 有申报，导入财务和地区敞口（复用 `api/src/interests/` 里现有的 SEC 导入函数，不要重写）。
   - 重算分数和画像旁证（`scoring/score.ts` 的 `recomputeScores`、`indicators.ts`）。
3. **标签**：
   - `people` 表加 `curation` 列（`'auto' | 'reviewed'`，默认 `'reviewed'`，按需分析创建的人物写 `'auto'`），写在 `migrate.ts`。
   - 人物页头部、主张列表每条、首页卡片，对 `auto` 的显示小标签「自动收录 · 未经人工复核」，样式参照现有的「有争议」标签。
   - 不做人工逐个复核按钮；`curation` 改为 `reviewed` 由 010 的交叉判定自动完成。
4. 方法页说明这个标签的含义。

## 范围

- `api/src/claims/discover.ts`、`api/src/core/migrate.ts`、`api/src/queries/*.ts`、`api/src/index.ts`
- `src/app/p/[id]/page.tsx`、`src/app/page.tsx`、`src/app/claims/page.tsx`、`src/app/review/page.tsx`、`src/app/method/page.tsx`、`src/lib/api.ts`

## 验收标准

- [ ] 盘点表和补齐后的对比写进完成记录
- [ ] 已有人物显示不变；新分析的人物带标签
- [ ] 通用检查全部通过

## 完成记录

