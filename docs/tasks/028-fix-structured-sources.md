# 028 修好结构化来源：字幕、8-K、播客

负责人：Claude
优先级：P1
关联：013 完成记录（SEC 8-K 0 文档、字幕 0 文档、RSS 16 文档 0 主张）

## 目标

让不花 AFP 的来源真正产出主张，把联网搜索留给补缺。

## 做法

1. **字幕**：本机装好 yt-dlp 后（由用户执行 `brew install yt-dlp`，不要自己装），`youtube_captions` 只下载字幕（`--skip-download --write-auto-subs --sub-langs en,zh-Hans`）。找视频用 yt-dlp 自带的搜索（`ytsearch10:<人名> interview`），不花 AFP。字幕去时间戳后照存档标准存。自动生成的字幕可能有识别错误：存档时标 `transcript_kind = auto`（人工字幕为 `manual`），来自自动字幕的主张页面上标「出自自动字幕」，核对原话时允许的差异仍是零。
2. **8-K**：查清 013 为什么 0 个文档。8-K 新闻稿通常在 EX-99.1 附件（HTML），要从申报索引里找附件而不是主文件。只取此人任职期间、本人所在公司的申报。
3. **RSS 有文档没主张**：抽 5 个 RSS 文档看原因（时间词切块漏掉？不是本人说的话？），在完成记录里写结论，能修就修。
4. **播客文字稿**：新增适配器，先支持自带文字稿的来源（如 Lex Fridman、Dwarkesh 的文字稿页面），按人名在节目列表里匹配。
5. 每个来源的产出照常写进 `source_yield`。用 013 那 12 人再跑一次，只补新主张。

## 范围

- `api/src/claims/sources/*`、`api/src/claims/discover.ts`（只在注册新适配器时动）、测试文件

## 验收标准

- [ ] 各来源前后产出对比表（文档数、主张数、AFP 次数）
- [ ] 通用检查全部通过

## 完成记录

**原因和修法**

- **8-K（0 文档的原因）**：申报索引地址写错了（`{accession}-index.json` 不存在，应为目录下的 `index.json`），每次都 404，被 catch 吞掉。改为：只看条目含 2.02 / 7.01 / 8.01（新闻稿类）的 8-K，只取本人在该公司任职期间的（interests 里的 role 起止），附件按 EX-99 → press → 非封面 htm 的顺序找（Alphabet 叫 `googexhibit991…`，NVIDIA 叫 `q2fy27pr.htm`）。实测：纳德拉 4 份、皮查伊 4 份、黄仁勋 4 份、贝尼奥夫 3 份带本人名字的新闻稿。凯文·斯科特是 CTO，12 份里 11 份没有他，符合预期。
- **字幕（0 文档的原因）**：一是原来用 `-o -` 想把字幕写到标准输出，实际 yt-dlp 不会这么做，永远拿不到；二是本机访问 YouTube 会被要求「登录以确认不是机器人」。改为：搜索用 `--flat-playlist`（不触发验证），只取标题里有本人名字的视频，字幕写进临时目录再读，先要人工字幕、没有再要自动字幕，存档标 `transcript_kind = manual / auto`，主张页对 auto 显示「出自自动字幕」。**我们不绕过 YouTube 的登录验证**；运维可以设置 `YTDLP_COOKIES`（cookies.txt 路径）或 `YTDLP_COOKIES_FROM_BROWSER` 用自己的登录态，没设时 `source_yield.detail` 写明原因。注意：字幕没有说话人，靠标题认人，归属不如播客文字稿可靠。
- **RSS 有文档没主张**：抽看了 16 个文档：都是公司博客和新闻室（Microsoft 官方博客、Salesforce 新闻稿、Google 博客），作者不是本人；陆奇早已离开微软却挂着微软博客。所以 0 主张是对的。改为：文章正文或标题里要有本人名字才收；去掉陆奇的微软 feed。a16z、diamandis 的 feed 404，ark-invest 403，照实记录。
- **播客文字稿（新增 `podcast_transcripts`）**：Lex Fridman（feed 有 500 集，文字稿页 `<slug>-transcript/` 带说话人）和 Dwarkesh（Substack 归档接口，加粗人名段落分说话人）。按标题认嘉宾（全名精确匹配，不会把 Kimbal Musk 认成 Elon Musk）。**存档正文只放嘉宾本人的发言**（每段带说话人和时间），原始网页整页存 raw，所以每句都能归到本人。实测：黄仁勋、皮查伊、阿莫迪、纳德拉、扎克伯格都取到了文字稿。
- **长文档挑块**：原来只读前 4000 字里带时间词的块，长文字稿和 8-K 后半段读不到。改为给每块按「将来时用语 + 年份」打分，在预算内留分数最高的块，再按原文顺序拼回。web_search 的文档也走这里。
- `RawDoc` 加 `transcriptKind`，`sources` 加 `transcript_kind` 列。测试：`api/tests/structured-sources.test.ts`。

**重跑 013 的 12 人（2026-10-26，未跑完）**

跑到第 5 人后本机 Postgres（Docker）不再响应，`CONNECT_TIMEOUT`，后 7 人没跑。已跑的：

| 人物 | 之前 | 之后 | 结构化来源情况 |
| --- | --- | --- | --- |
| 保罗·格雷厄姆 | 0 | 0 | 无任职、无播客；RSS 2 篇不是本人 |
| 克莱芒·德朗格 | 0 | 0 | 字幕被要求登录；RSS 3 篇不是本人 |
| 凯文·斯科特 | 5 | 8 | 8-K 12 份 11 份无本人；Lex 那集无文字稿页（404）；新增 3 条来自联网搜索 |
| 凯茜·伍德 | 4 | 5 | RSS 403；新增 1 条来自联网搜索 |
| 彼得·戴曼迪斯 | 3 | 10 | RSS 404；新增 7 条来自联网搜索 |

这 12 人大多不是上市公司高管、也没上过这两档播客，结构化来源在他们身上本来就难有产出。数据库恢复后用 `bun --env-file=.env run src/claims/sources/rerun.ts fei-fei-li aidan-gomez noam-shazeer aravind-srinivas marc-andreessen marc-benioff qi-lu` 补跑剩下 7 人，再补全前后对比表。

