# 可信度（一致性）采集格式

每人一个文件 `data/consistency/<person_id>.json`。采集者（人或 Cursor）只负责找原话和出处、提出判定；
入库前由 `pnpm api:consistency` 程序存档每个链接并逐字核对，判定一律进人审（`label` 为空），校准前不出分。

## 采集单位是「话题」，不是「矛盾」

只找自相矛盾会让分数系统性偏低。所以先列话题，再逐个查结果，查到什么记什么：

1. **列话题**：这个人最有代表性的建议和明确立场，每人 5–10 个，优先他反复讲、传播广的（访谈、演讲、本人博客、社交媒体、致股东信）。列的时候还不知道结果，不能挑「看起来会翻车的」。
2. **逐个查**：每个话题最多产出一条对照，三种之一：
   - `reversal` 前后翻转：后来说了相反的话。他公开说明了改变理由（承认以前错了、有新情况）→ `consistent`，并填 `explanation`；没说明 → `inconsistent`。
   - `reaffirm` 前后重申：相隔至少 1 年，后来仍持同一立场 → `consistent`。
   - `walk` 言行对照：他给别人的建议，对照他本人同期的公开行动（持股披露、公司公告、本人公开的行为）。相符 `consistent`，相反 `inconsistent`。
   一个话题既有言行又有前后，可以各出一条，`topic` 写同一个。
3. 查不到对应的后话或行动，也要在 `topics` 里记一行 `result: "no_counterpart"`。

## 不收

- 选举、政党、政府政策相关的立场（`result: "excluded"`）。
- 带可检验后果和期限的话（「三年内会……」「现在买，三年后你会感谢我」）——那是预测，进兑现率，不进这里。
- 转述：`a`、`b`（walk 除外）、`explanation` 的 `quote` 必须是本人原话，出现在引号里或本人发表的文字里。记者的概括句不算。
- 同一句话换个出处重复记。

## 原话要求

- `quote` 必须**逐字**出现在 `url` 指向的页面正文里（大小写、标点差异不要紧，词不能改）。可以用 `…` 连接同一页上的几段，每段至少 15 个字符。
- 用原语言。英文就抄英文，中文就抄中文；`quote_zh` 给中文译文（原文是中文时与原文相同）。
- `walk` 的 `b` 是行动的证据：页面上描述这一行动的那一句（可以是公告或记者的句子），同样逐字。
- 优先稳定的页面：官方博客、文字实录、监管文件、大报。视频页、需要登录的页面、付费墙抓不到正文，别用。
- `date` 是这句话说出或行动发生的日期（`YYYY-MM-DD`，只知道月份就写该月 1 日）。

## 格式

```json
{
  "person_id": "musk",
  "collected_by": "cursor",
  "collected_at": "2026-10-23",
  "topics": [
    { "topic": "远程办公", "domain": "公司经营与财务", "result": "pair", "pairs": ["musk-c001"] },
    { "topic": "……", "domain": "……", "result": "no_counterpart", "note": "只找到 2019 年这一次表态" },
    { "topic": "……", "domain": "……", "result": "excluded", "note": "选举相关" }
  ],
  "pairs": [
    {
      "id": "musk-c001",
      "kind": "reversal",
      "domain": "公司经营与财务",
      "topic": "远程办公",
      "a": { "quote": "原话", "quote_zh": "译文", "date": "2020-03-01", "url": "https://..." },
      "b": { "quote": "原话", "quote_zh": "译文", "date": "2022-06-01", "url": "https://..." },
      "explanation": null,
      "proposed_label": "inconsistent",
      "rationale": "一两句中文：两句话为什么算相反/相符，有没有说明理由。"
    }
  ]
}
```

- `id`：`<person_id>-c<三位序号>`，文件内唯一，改内容不改编号。
- `domain` 只能取这些：AI 模型与 AGI、AI 芯片与算力、自动驾驶、电动车与电池、机器人、航天、手机与消费电子、互联网平台、云与企业软件、加密货币、生物科技与医疗、能源、公司经营与财务、宏观经济与市场、其他科技。
- `a` 永远是时间上更早的那句（walk 里 `a` 是建议，`b` 是行动，行动可以早于或晚于建议，但要在建议前后 2 年内才算「同期」）。
- `explanation` 只用于 reversal：`{ "quote", "quote_zh", "date", "url" }`，同样逐字。

## 自检

```bash
pnpm api:consistency -- --person=musk          # 只核对：存档每个链接，逐条报告原话是否逐字对上
pnpm api:consistency -- --person=musk --import # 核对通过的写入 consistency_pairs（proposed，待人审）
```
