# 004 重抓乱码 PDF 和打不开的出处

负责人：Cursor
优先级：P2

## 目标

存成乱码的 PDF 证据和打不开的出处重新抓取存档，并逐字复核主张原话还在不在原文里。

## 背景

- 原任务说明：`/tmp/cursor-jobs/t7.md`（本机文件，上次连接中断没做完）。
- `api/src/evidence/refetch.ts` 已部分写好但未提交，状态未知：先读懂、补完，不要另起炉灶。
- 存档标准见 SPEC 原则 3：原始字节 gzip + SHA-256 + 抓取途径；PDF 用 unpdf 本地提取。

## 做法

1. 找出乱码的证据（提取文本里大量不可读字符）和抓取失败的出处。
2. 走现有回退链（direct → browser → jina）重抓，新存档不覆盖旧存档。
3. 原话在新文本里找不到的主张，只列清单，不改状态。
4. 默认试运行，`--apply` 才写库；`api/package.json` 加 `"refetch"` 脚本。

## 范围（只能改这些文件）

- `api/src/evidence/refetch.ts`
- `api/package.json`

## 验收标准

- [x] 完成记录写明：重抓成功数、仍失败的链接、原话对不上的主张清单
- [x] 通用检查全部通过

## 完成记录

提交 `f9437cf`。补上「大量 U+FFFD」判定和 `--garbled`，`api/package.json` 增加 `refetch`。默认试运行；`--apply` 才 `snapshot`，新存档追加在后，不改旧行，也不改主张状态。

最新一份存档里符合条件 623 个网址（排除 sec.gov XBRL 64 个）。正文以 `%PDF` 开头 0 个，大量不可读字符 4 个，HTTP ≥ 400 有 475 个，正文少于 400 字 553 个。关联主张 1 条。

`--apply --limit=8`（有主张的排在前面）：新存档 8/8，可用正文 0。仍失败：

- HTTP 401 `https://www.reuters.com/business/energy/elon-musk-says-world-still-needs-oil-gas-2022-08-29/`（新 sources#3243，browser，0 字）
- HTTP 404 `https://www.dwarkesh.com/p/greg-brockman`（#3244）
- HTTP 404 `https://www.cnbc.com/2023/06/12/openai-greg-brockman-agi-this-decade.html`（#3245）
- HTTP 403 `https://www.nytimes.com/2023/07/21/podcasts/hardfork-greg-brockman-openai-transcript.html`（#3246）
- HTTP 403 `https://openai.com/index/governance-of-superintelligence/`（#3247）
- HTTP 403 `https://openai.com/index/introducing-superalignment/`（#3248）
- HTTP 403 `https://openai.com/index/new-models-and-developer-products-announced-at-openai-devday/`（#3249）
- HTTP 404 `https://www.theverge.com/2023/11/22/23972023/openai-board-sam-altman-greg-brockman-fired`（#3250）

原话对不上的主张：`musk-012`（Reuters 那条，旧存档和新存档都对不上）。原来对不上、现在对得上：0。

`--apply --garbled`：4 个新存档都是 HTTP 200、正文够长，但替换字符数量和旧存档一样，页面本身就是乱码，重抓没有变好。没有关联主张。

- `http://auto.people.com.cn/n1/2016/1022/c1005-28799549.html`：旧 #1178 → 新 #3252，前 4000 字里 2242 个 U+FFFD
- `http://m.zhiding.cn/article/3194330.htm`：旧 #2438 → 新 #3253，2716 个
- `https://interaksyon.philstar.com/breaking-news/2020/12/10/184766/spacexs-starship-prototype-explodes-on-landing-after-test-launch/`：旧 #46 → 新 #3251，1216 个
- `https://www.developpez.net/forums/d2173332/general-developpement/algorithme-mathematiques/intelligence-artificielle/25-predictions-matiere-d-ia-2025-gary-marcus-professeur-fondateur-geometric-intelligence/`：旧 #3112 → 新 #3254，105 个

其余约 611 个打不开或正文过短的网址这次没有逐个重抓。先跑的 8 个已经是同一类 401/403/404，整批再走浏览器回退要几个小时。脚本可以重复跑。

验证：`bun run typecheck`、81 项测试、根目录 `pnpm lint` 和 `tsc` 通过。

