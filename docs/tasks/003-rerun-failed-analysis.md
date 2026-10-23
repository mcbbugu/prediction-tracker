# 003 重跑失败的人物分析

负责人：Cursor
优先级：P1

## 目标

上次因连接中断失败的约 11 个人物分析重新跑完，结果直接公开（SPEC：按需分析直接公开）。

## 做法

1. 只读查询 `jobs` 表：`kind='analyze_person'`、失败过且从没成功过的人物。
2. 读 `api/src/jobs/enqueue.ts`、`api/src/jobs/worker.ts` 弄清用法，只把这些人重新入队。
3. 运行 `cd api && bun --env-file=.env run src/jobs/worker.ts --once --publish`。
4. worker 有启动预检和熔断：因网络、额度停下就记录原因，不要绕过、不要改代码。

## 范围

- 不改任何代码文件。
- 只可提交新增的头像图片（`public/portraits/` 下本任务产生的）。

## 验收标准

- [ ] 完成记录里列出每个人的结果：新增主张数，或失败原因
- [ ] 首页能看到新跑完的人物

## 完成记录

