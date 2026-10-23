# 015 评测台与流水线版本指标

负责人：Cursor
优先级：P1
依赖：011、012

## 目标

数据架构第 5 层：每次流水线升级都有可比的指标，变差不允许上线。

## 做法

1. 金标准集 `data/eval/`：
   - `discovery.jsonl`：人物 + 已知的带期限预测（用现有人工种子 `data/people/*.json` 里的主张生成）。
   - `verdicts.jsonl`：已有人工判定的主张（种子里人写的判定；以后加上盲标结果）。
2. `api/src/tools/eval.ts`：用 011 的重放机制跑（有缓存就不花钱），输出：
   - 发现召回率、抽取精度
   - 判定一致率与 Wilson 下界、κ
   - 确定性判定占比（来自 012）
   - 单位成本：每条有效主张的搜索次数和秒数
3. 结果写进 `data/eval/history.jsonl`（流水线版本号、日期、各项指标）。流水线版本号 = 各提示词版本 + 判定器版本拼起来。
4. 方法页加「流水线版本」表：从 history 读，展示每个版本的指标。
5. `api/package.json` 加 `eval` 和 `eval:check`；`eval:check` 在任一核心指标低于上一版超过 2 个百分点时退出码非 0。

## 范围

- 新建 `api/src/tools/eval.ts`、`data/eval/*`、`api/package.json`、`src/app/method/page.tsx`、测试文件

## 验收标准

- [ ] 跑出第一版基线指标，写进完成记录
- [ ] 通用检查全部通过

## 完成记录

