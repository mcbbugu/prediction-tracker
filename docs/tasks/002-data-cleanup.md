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

提交 `a8e177c`。新增 `api/src/tools/cleanup.ts` 和 `api/package.json` 的 `cleanup` 脚本。默认只打印；`--apply` 才把重复主张的 `publication` 改成 `withdrawn`（记 `claim_events`，`action=duplicate_withdrawn`），并把 `basis=crawl`、`metric_kind=amount_usd`、数值 &lt; 10000 的敞口数值和类型置空。不删行。同一人物下，规范化后完全相同（至少 36 字）或几乎相同（至少 48 字，包含且长度比 ≥ 0.75，或 trigram Dice ≥ 0.9 且 80% 实词相同）算重复；证据链接更多的留下，一样多则留更早录入的。

试运行：

```
重复主张 0 组，将撤回 0 条
可疑期限 1 条（只列出，不修改）
  altman-006 山姆·奥特曼 published 出处是网站首页 https://ia.samaltman.com/
单位丢失的金额 6 条
  #2 tesla region/UNITED STATES 47.63（2025）原文是 $47.63B
  #4 tesla region/CHINA 20.96（2025）原文是 $20.96B
  #6 tesla region/UNITED STATES 13.21（2026）原文是 $13.21B
  #8 tesla region/CHINA 4.67（2026）原文是 $4.67B
  #33 tesla investment/xAI 20（2026）原文是 $20B Series E
  #34 tesla investment/Wiferion 76（2023）原文是收购价约 $76M
```

没有截止日期早于说话日的主张。上面这 1 条留给人工：首页不能当出处。

`--apply` 置空了这 6 条的 `metric_kind` 和 `metric_value`，原文还在，敞口表仍是 1080 行。没有主张被撤回，所以没有重算分数。再跑一次试运行：重复主张 0，单位丢失 0，首页那条仍在。`/v1/people/musk/interests` 仍是 200。

`cd api && bun run typecheck && bun run test`：70 通过。根目录 `pnpm lint` 和 `npx tsc --noEmit -p .` 通过。

