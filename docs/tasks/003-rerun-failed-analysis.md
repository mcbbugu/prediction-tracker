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

没有人需要重跑，也没有启动 worker。

`analyze_person` 里失败过的查询共 34 个。按 `query` 核对，每一个后来都有一条 `state=done` 的任务（有的 `person_id` 在失败那次还是空的，成功那次才写上）。失败原因主要是连接中断、联网搜索当时被拒、或「链接都打不开」。成功那次收录的主张数：

| 人物 | id | 主张 |
| --- | --- | --- |
| 丹妮拉·阿莫迪 | daniela-amodei | 1 |
| 亚历山大·王 | alexandr-wang | 1 |
| 保罗·格雷厄姆 | paul-graham | 0 |
| 克莱姆·德朗格 | clement-delangue | 0 |
| 凯文·斯科特 | kevin-scott | 0 |
| 凯茜·伍德 | cathie-wood | 0 |
| 加里·马库斯 | gary-marcus | 1 |
| 吉姆·凯勒 | jim-keller | 1 |
| 吴恩达 | andrew-ng | 1 |
| 孙正义 | masayoshi-son | 11 |
| 安迪·贾西 | andy-jassy | 3 |
| 帕特·基辛格 | pat-gelsinger | 1 |
| 彼得·戴曼迪斯 | peter-diamandis | 0 |
| 拉里·埃里森 | larry-ellison | 1 |
| 李飞飞 | fei-fei-li | 0 |
| 杨立昆 | yann-lecun | 1 |
| 杰克·克拉克 | jack-clark | 3 |
| 杰夫·贝索斯 | jeff-bezos | 1 |
| 杰夫·迪恩 | jeff-dean | 1 |
| 杰弗里·辛顿 | geoffrey-hinton | 4 |
| 梁文锋 | liang-wenfeng | 1 |
| 比尔·盖茨 | bill-gates | 3 |
| 约书亚·本吉奥 | yoshua-bengio | 4 |
| 维诺德·科斯拉 | vinod-khosla | 2 |
| 艾丹·戈麦斯 | aidan-gomez | 0 |
| 苏姿丰 | lisa-su | 7 |
| 蒂姆·库克 | tim-cook | 1 |
| 诺姆·沙泽尔 | noam-shazeer | 0 |
| 里德·霍夫曼 | reid-hoffman | 1 |
| 阿尔温德·克里希纳 | arvind-krishna | 1 |
| 阿拉文德·斯里尼瓦斯 | aravind-srinivas | 0 |
| 雷·库兹韦尔 | ray-kurzweil | 6 |
| 马克·安德森 | marc-andreessen | 0 |
| 马克·贝尼奥夫 | marc-benioff | 0 |

主张数为 0 的也算跑完（任务状态是 done，只是没收到可公开的话）。没有再入队，避免把同一人再打一遍联网搜索。这些人已经在库里，首页看的是公开人物，不是这次新跑的。

