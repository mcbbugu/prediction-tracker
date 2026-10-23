# 002 数据清理脚本

负责人：Cursor
优先级：P1

## 目标

清掉重复主张和单位丢失的敞口数字，可重复运行、可审计，不删任何行。

## 背景

- 数据体检报告：`/tmp/cursor-jobs/data-audit-report.md`（本机文件）。不在了就按下面的规则自己查。

## 做法

新建 `api/src/tools/cleanup.ts`，默认试运行只打印，加 `--apply` 才写库：

1. **重复主张**：同一人物下原话相同或几乎相同的主张，保留证据更全、更早录入的那条；其余把 `publication` 改成 `'withdrawn'`，并写一条 `claim_events`（`action='duplicate_withdrawn'`，note 写保留的是哪条）。
2. **可疑期限**：deadline 早于说话日期、或来源是网站首页的主张，只打印清单，不改。
3. **单位丢失的敞口**：`basis='crawl'`、金额类指标且数值小于 10000 的，把指标数值和类型置空，条目保留。
4. 对受影响的人物重算分数（`api/src/scoring/score.ts` 的 `recomputeScores`）。

先试运行，把输出贴进完成记录，确认无误后再 `--apply`。

## 范围（只能改这些文件）

- 新建 `api/src/tools/cleanup.ts`
- `api/package.json`（加一条 `"cleanup"` 脚本）

## 验收标准

- [ ] 试运行输出和 apply 结果写进完成记录（含第 2 类清单，供人工处理）
- [ ] 再跑一次试运行，第 1、3 类为零
- [ ] 通用检查全部通过

## 完成记录

