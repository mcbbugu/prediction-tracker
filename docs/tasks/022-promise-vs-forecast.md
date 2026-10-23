# 022 承诺与预测分开计分

负责人：Cursor
优先级：P0（019、020 依赖它）

## 目标

SPEC「承诺与预测分开」：人物页从一个兑现率变成「靠谱度」和「判断力」两个数。

## 做法

1. `claims` 加 `kind`（`promise` | `forecast` | `uncertain`）和 `kind_reason`（一句话）。
2. 判别：先用规则（主张主体是本人，或本人在说话当天有效的任职、控股机构 → `promise`，利益关系表按双时态查），规则判不了的交给模型，模型也拿不准就 `uncertain`。提示词带版本号，走 011 的缓存（011 未完成就先直接调用）。
3. 抽取步骤新主张自动判别；已有主张写回填脚本 `api/src/tools/backfill-kind.ts`（默认试运行）。
4. 计分：`recomputeScores` 分别对 promise 和 forecast 算现有的兑现率（公式暂时不变，只是分组），`uncertain` 两边都不计。旧的合并兑现率保留为「全部」，接口继续返回，标为 deprecated。
5. 展示：人物页头部两个数「靠谱度（承诺兑现率）」「判断力（预测兑现率）」，各带区间和条数；主张行加小标签「承诺 / 预测」；领域页和首页排名默认按靠谱度，可切换。consult 和 `/v1/prior` 返回两组。
6. 方法页写判别标准和例子。

## 范围

- `api/src/core/migrate.ts`、`api/src/claims/*.ts`、`api/src/scoring/score.ts`、`api/src/queries/*.ts`、`api/src/index.ts`、新建回填脚本、`api/package.json`
- 人物页头部、主张列表、首页与领域页排名、`src/app/method/page.tsx`、`src/lib/api.ts`
- 测试文件

## 验收标准

- [ ] 回填统计：三类各多少；随机抽 20 条贴出判别和理由，供人看一眼
- [ ] 判别规则的单元测试（本人主体、任职机构、离职后的机构、外部事件）
- [ ] 通用检查全部通过

## 完成记录

