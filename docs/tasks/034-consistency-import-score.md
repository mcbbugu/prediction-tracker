# 034 可信度：已有 9 人核对入库、计分、页面展示

负责人：Cursor
优先级：P0

## 目标

SPEC P13 和「可信度（一致性）」一节（含 2026-10-23 近期版本规则）：把已经采集好的 9 人数据真正用起来，人物页的「可信度」不再显示「尚未收集」。

## 背景

- 采集文件：`data/consistency/*.json`，9 人，每人约 20 个话题；格式见 `data/consistency/README.md`。
- 核对入库脚本：`api/src/consistency/check.ts`（`pnpm api:consistency -- --person=<id> [--import]`），从没跑过，`consistency_pairs` 表是 0 行。
- 表字段：`proposed_label`（AI 提出的判定）、`label`（人工判定，近期为空）、`publication`、`provenance`。
- 计分接口已预留：`api/src/scoring/score.ts` 的 `COMPOSITE_WEIGHTS`（兑现率 0.7、一致性 0.3），现在返回 `not_collected`。

## 做法

1. **核对**：对 9 人逐个运行不带 `--import` 的试运行，汇总每人通过、失败的条数和失败原因（原话对不上、页面打不开、属于转述）。原话能就地修正的（只能改成页面上逐字存在的句子，不能编），修正后重跑。
2. **入库**：通过的用 `--import` 入库。近期规则：入库后 `publication` 直接设为公开，判定取 `proposed_label`，`label` 保持为空（表示未经人工）。
3. **计分**（`api/src/scoring/consistency.ts`，纯函数）：照 SPEC，用 Beta 后验，一致记 1、不一致记 0，半衰期 3 年，κ=4，中性先验 0.5，给 80% 区间。按人、按领域算。某人某领域对照少于 5 条时不出分，状态记为 `examples_only`。
4. **综合分**：有可信度分的领域按 0.7 / 0.3 合成，没有的维持「只含兑现率」。按项目规则，改计分要同步更新 `score.ts` 的版本号、SPEC 公式一节、方法页、consult。
5. **页面**：
   - 人物页「可信度（一致性）」卡片显示分数和区间（或「对照不足 5 条，只列例子」），以及对照条数。
   - 新子页 `/p/[id]/consistency`（照 SPEC「页面结构」规则）：按话题列出每条对照，包括类型（前后翻转 / 前后重申 / 言行对照）、两边原话和存档链接、说明理由（如有）、判定及理由，标「AI 判定」。可以按类型和判定筛选。
   - 人物页只放最近 3 条，加上「查看全部 N 条 →」。
   - 方法页补上可信度怎么算、为什么少于 5 条不出分。
6. consult 和 `/v1/prior` 返回可信度分、条数，以及每条的 `verdict_tier`。

## 范围

- `api/src/consistency/check.ts`（只修跑通需要的问题）、新建 `api/src/scoring/consistency.ts`、`api/src/scoring/score.ts`、`api/src/queries/*.ts`、`api/src/index.ts`
- `data/consistency/*.json`（只修原话）
- 人物页可信度卡片、新建 `src/app/p/[id]/consistency/`、`src/app/method/page.tsx`、`src/lib/api.ts`
- `SPEC.md`（只改公式一节的版本号）
- 测试文件

## 验收标准

- [x] 完成记录：9 人各自的核对通过率、入库条数、可信度分（或「只列例子」）
- [x] 计分函数单元测试（固定输入，区间正确；少于 5 条不出分）
- [x] 马斯克人物页和子页截图
- [x] 界面审美不变；通用检查全部通过

## 完成记录

提交 `768dd56`。9 个人的原话全部逐字对上，没有需要改句子。入库 85 条，`publication` 为公开，`label` 留空，分数用 `proposed_label`。一个领域少于 5 条不出分。

| 人 | 通过 | 入库 | 出分的领域 |
| --- | --- | --- | --- |
| 马斯克 | 10/10 | 10 | 没有。各领域都不足 5 条，只列例子 |
| 奥尔特曼 | 9/9 | 9 | 没有 |
| 黄仁勋 | 8/8 | 8 | 没有 |
| 达里奥·阿莫迪 | 9/9 | 9 | AI 模型与 AGI 81.6（8 条） |
| 苏姿丰 | 11/11 | 11 | AI 芯片与算力 74.8（6 条） |
| 孙正义 | 9/9 | 9 | 没有 |
| 梁文锋 | 11/11 | 11 | AI 模型与 AGI 66（6 条），公司经营与财务 70.9（5 条） |
| 加里·马库斯 | 8/8 | 8 | AI 模型与 AGI 76.1（7 条） |
| 雷·库兹韦尔 | 10/10 | 10 | 没有 |

够 5 条的领域按兑现率 70%、可信度 30% 合成，综合分版本 v1.4。达里奥人物页「AI 模型与 AGI」可信度显示 81.6（66–94），最近 3 条例子，链到 `/p/dario-amodei/consistency`。筛选「前后翻转」只留下他改口并说明理由的那一条。马斯克各领域都不足 5 条，卡片写「对照不足 5 条」，仍可查看全部 10 条。consult 和 `/v1/prior` 的领域对象带可信度分和每条的 `verdict_tier`（现在都是 machine）。

5 条都一致、说话日就是今天时，分数是 77.8，80% 区间包住它。4 条不出分。

验证：`cd api && bun run typecheck && bun run test`（112 项通过），根目录 `pnpm lint` 与 `npx tsc --noEmit -p .` 通过。达里奥人物页和对照子页在浏览器里看过。

