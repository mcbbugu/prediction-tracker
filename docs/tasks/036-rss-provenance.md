# 036 RSS 回退不得冒充文章原文

负责人：Cursor
优先级：P0
关联 issue：#7

## 问题（已核对属实）

`api/src/claims/sources/rss.ts:61-63`：文章抓取失败、而 feed 的 description 不少于 400 字时，适配器会把 description 当成 `item.link`（文章网址）的正文。`api/src/evidence/sources.ts:201` 的 `archiveDocument` 又把它存成 `via: "direct"`、`finalUrl` 写成文章网址。后续逐字核对通过的，只能说明这句话出现在 feed 摘要里，证明不了文章原文里有它。这违反了 SPEC 原则 2、3（原话必须逐字出现在出处原文里）。

## 做法

1. 文章抓取失败时，**不再用 description 冒充文章**。二选一，推荐 A：
   - A：直接跳过这篇，记录原因（`source_yield` 的丢弃统计里体现）。
   - B：以 feed 网址 + item GUID 单独存档，来源类型记 `rss_description`；文章网址只作关联链接；基于它的主张标「转述」，页面写明「出自 RSS 摘要，未能打开原文」。
2. `archiveDocument` 接收调用方传入的真实 `via`、`status`、`finalUrl`，不再写死 `direct` / 文章网址。所有调用方核对一遍。
3. 排查库里已有的受影响存档：找出 `content_type = 'text/plain'`、由 RSS 适配器产生、文章网址却标成 direct 的存档，以及引用它们的主张。只列清单，并把这些主张退回待复核（`publication` 改为 `proposed`，写 `claim_events`），不删行。
4. 测试：文章 403 / 超时，且 description 很长时，断言不会产生 `final_url = 文章` 且 `fetched_via = direct` 的存档。

## 范围

- `api/src/claims/sources/rss.ts`、`api/src/claims/sources/index.ts`、`api/src/evidence/sources.ts`、测试文件
- 新建排查脚本 `api/src/tools/audit-rss-archives.ts`

## 验收标准

- [ ] 完成记录写明受影响的存档数和主张数（可能为 0）
- [ ] 测试通过；通用检查全部通过
- [ ] 在 issue #7 下回复，不关闭

## 完成记录

