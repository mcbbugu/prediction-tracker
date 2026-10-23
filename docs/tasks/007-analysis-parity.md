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
   - 不做人工逐个复核按钮；010 的交叉判定全部一致后，`curation` 改为 `'cross_checked'`，标签变成「自动收录 · 双模型一致」；只有人工裁定才写 `'reviewed'`。
4. 方法页说明这个标签的含义。

## 范围

- `api/src/claims/discover.ts`、`api/src/core/migrate.ts`、`api/src/queries/*.ts`、`api/src/index.ts`
- `src/app/p/[id]/page.tsx`、`src/app/page.tsx`、`src/app/claims/page.tsx`、`src/app/review/page.tsx`、`src/app/method/page.tsx`、`src/lib/api.ts`

## 验收标准

- [ ] 盘点表和补齐后的对比写进完成记录
- [ ] 已有人物显示不变；新分析的人物带标签
- [ ] 通用检查全部通过

## 完成记录

盘点（补流程之前，页面模块在不在）：

| 模块 | 马斯克（人工收录） | 陆奇（按需分析） |
| --- | --- | --- |
| 头像 | 有 | 有 |
| 主张 | 42 | 0（这次没抽出能核对的原话） |
| 领域分 / 画像 | 6 个领域 | 没有主张，所以没有分 |
| 利益关系 | 23 条，13 家机构 | 18 条，15 家机构 |
| 对外敞口 | 194 | 48（微软、IBM 等已在库里的申报） |
| 改期与可检验度 | 有 | 有，但是 0 |

缺的不是页面，是分析流程没去导 SEC、也没在零主张时走一遍计分。现在利益关系之后会：用现有的 `sec.ts` 给关联机构导最近 1 份申报（对照表里没有的机构自动跳过；已入库的不重写），然后 `recomputeScores`，并把改期、可检验度写进事件。试跑 `microsoft,ibm --years=1 --dry-run`：IBM 营收 $67.5B，微软 $331.8B，不写库。

`people.curation` 默认 `reviewed`，所以马斯克页面不变。按需分析新建的人写 `auto`。陆奇是这次分析创建的，补成了 `auto`。标签「自动收录 · 未经人工复核」出现在他的人物页头部、首页卡片；主张列表在有主张时同样显示。`cross_checked` 留给 010，方法页写了三态的区别。没有加逐个人工复核按钮。

`/p/qi-lu` 的页面源码里有这个标签，`/p/musk` 没有。lint、tsc、74 项测试通过。

