# 任务看板

状态：待办 / 进行中 / 卡住 / 已完成。按顺序做。

| 编号 | 任务 | 负责人 | 优先级 | 状态 | 提交 |
| --- | --- | --- | --- | --- | --- |
| [001](001-perf-indexes.md) | 加索引、去掉 N+1 查询 | Cursor | P1 | 已完成 | fc57ccb |
| [009](009-restore-review-pages.md) | 恢复审核和校准入口（H01 被它卡住） | Cursor | P0 | 已完成 | d733e08 |
| [002](002-data-cleanup.md) | 数据清理脚本 | Cursor | P1 | 已完成 | a8e177c |
| [005](005-analysis-trace-data.md) | 按需分析：每步记录完整细节 | Cursor | P0 | 已完成 | 55081d3 |
| [006](006-analysis-trace-ui.md) | 任务页展示分析过程（依赖 005） | Cursor | P0 | 已完成 | 2d6f22d |
| [007](007-analysis-parity.md) | 按需分析补齐模块、加自动收录标签 | Cursor | P0 | 已完成 | ae25ce9 |
| [008](008-analysis-rate-limit.md) | 按 IP 限流和排队 | Cursor | P1 | 已完成 | 77050c6 |
| [010](010-cross-model-check.md) | 双模型交叉判定 + 异常通知（依赖 007） | Cursor | P1 | 已完成 | d7cb6e4 |
| [003](003-rerun-failed-analysis.md) | 重跑失败的人物分析 | Cursor | P1 | 已完成 | 无代码提交 |
| [004](004-refetch-sources.md) | 重抓乱码 PDF 和打不开的出处 | Cursor | P2 | 待办 | |
| [011](011-replayable-pipeline.md) | 模型调用内容寻址与可重放 | Cursor | P0 | 待办 | |
| [012](012-testable-propositions.md) | 可检验命题 + 确定性判定器（依赖 011） | Cursor | P0 | 待办 | |
| [013](013-multi-source-discovery.md) | 多源发现，提高产出率 | Cursor | P0 | 待办 | |
| [014](014-transparency-log.md) | 透明日志与每日根哈希（依赖 011） | Cursor | P1 | 待办 | |
| [015](015-eval-bench.md) | 评测台与版本指标（依赖 011、012） | Cursor | P1 | 待办 | |
| [016](016-exposure-intervals.md) | 推算带区间、假设和时间对齐（依赖 011） | Cursor | P1 | 待办 | |
| [017](017-insider-trades.md) | 言行一致：SEC Form 4 内部人交易 | Cursor | P1 | 待办 | |
| [018](018-event-study-baseline.md) | 事件研究与同类基准（依赖 012） | Cursor | P2 | 待办 | |
| [019](019-delay-survival.md) | 生存分析：延迟系数与兑现时间预测（依赖 022） | Cursor | P0 | 待办 | |
| [020](020-difficulty-hierarchical.md) | 难度调整技能分 + 分层贝叶斯，公式 v2.0（依赖 012） | Cursor | P0 | 待办 | |
| [021](021-commitment-strength.md) | 承诺强度与本人校准（依赖 012） | Cursor | P1 | 待办 | |
| [022](022-promise-vs-forecast.md) | 承诺与预测分开计分（019、020 依赖它） | Cursor | P0 | 待办 | |
| [023](023-prediction-powered-inference.md) | 预测驱动推断：少量人工给出有效区间 | Cursor | P1 | 待办 | |
| [024](024-vague-claims.md) | 模糊表述按多种定义判定（依赖 012） | Cursor | P1 | 待办 | |
| [025](025-growing-lists-pages.md) | 长列表进子页（变化原因、全部主张）+ 服务端分页 | Cursor | P1 | 待办 | |
| [H01](H01-blind-calibration.md) | 盲标 49 条校准判定（等 009，暂缓） | 人工 | P2 | 待办 | — |
