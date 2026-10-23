// bun --env-file=.env run src/interests/resolve-ends.ts -- [--apply] [--people=musk,huang] [--limit=20] [--publication=published]
// 结束时间未知的利益关系：只依据该条 source_id 的存档原文，判断已结束 / 截至发文仍在任 / 原文没说。
// 默认试运行，只打印；加 --apply 才写库。模型调用走 arkJson（不联网搜索）。
//
// 更正不覆盖、不删除旧行：插入一条新行（复制原行，改 ended / end_kind，provenance=agent，publication 不变），
// 再把旧行的 superseded_at / superseded_by 指到新行。
// 唯一索引只约束未被取代的行（interests_live_unique_idx），所以先把旧行标为被取代，再插新行，不会冲突。
import { ArkStopped, afpUsedToday, arkJson, arkPreflight, takeModelCallId } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { excerpt, normalize, quoteOnPage } from "../evidence/sources";
import { cleanDate, endKind as endKindOf } from "./interests";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const apply = process.argv.includes("--apply");
const people = (arg("people") ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const publication = arg("publication")?.trim() || null;
const limitArg = arg("limit");
const limit = limitArg && Number.isFinite(Number(limitArg)) && Number(limitArg) > 0 ? Math.floor(Number(limitArg)) : null;

type Row = {
  id: number;
  person_id: string;
  name: string;
  name_en: string;
  kind: string;
  counterparty: string;
  counterparty_zh: string;
  role: string;
  started: string | null;
  source_url: string;
  source_id: number | null;
  quote: string;
  publication: string;
  reviewed_at: Date | null;
  stake_pct: string | null;
  amount_usd: string | null;
  org_key: string | null;
  text: string;
};

type Verdict = "ended" | "ongoing" | "unchanged";

type Decision = {
  judgment: string;
  quote: string;
  write: { ended: string; endKind: "ended" | "ongoing" } | null;
};

function clip(value: string, max = 80) {
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) return "—";
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function orgNames(row: Pick<Row, "counterparty" | "counterparty_zh">) {
  return [row.counterparty, row.counterparty_zh].map((name) => name.trim()).filter((name) => name.length >= 2);
}

function quoteNamesOrg(quote: string, row: Pick<Row, "counterparty" | "counterparty_zh">) {
  const text = normalize(quote);
  return orgNames(row).some((name) => text.includes(normalize(name)));
}

// Infoboxes and raw templates mention the organisation dozens of times and crowd the prose out of excerpt().
function readable(text: string) {
  const lines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length < 40) return false;
    if (trimmed.includes('"wt":') || trimmed.includes("{{") || trimmed.includes("}}")) return false;
    return (trimmed.match(/\[\[[^\]]+\]\]/g)?.length ?? 0) < 6;
  });
  const cleaned = lines.join("\n");
  return cleaned.length >= 200 ? cleaned : text;
}

function passage(text: string, row: Pick<Row, "counterparty" | "counterparty_zh" | "role" | "kind">) {
  const source = readable(text);
  const names = orgNames(row);
  const extra = row.kind === "holding" ? ["owns", "shareholder", "stake", "shares", "持股", "股份"] : ["currently", "resigned", "until", "现任", "离职", "至今"];
  const keys = [...names, row.role, ...extra].map((key) => key.trim()).filter((key) => key.length >= 2);
  let picked = keys.length ? excerpt(source, keys, 12000) : "";
  const hasName = (value: string) => names.some((name) => normalize(value).includes(normalize(name)));
  if (!hasName(picked)) {
    const lower = text.toLowerCase();
    const chunks: string[] = [];
    for (const name of names) {
      const needle = name.toLowerCase();
      let from = 0;
      for (let n = 0; n < 2; n += 1) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        chunks.push(text.slice(Math.max(0, at - 800), Math.min(text.length, at + 2200)));
        from = at + needle.length;
      }
    }
    if (chunks.length) picked = chunks.join("\n");
  }
  return picked.slice(0, 12000);
}

function hasYear(quote: string, year: string) {
  return new RegExp(`(?:^|\\D)${year}(?:\\D|$)`).test(quote);
}

function rangesOf(quote: string) {
  const text = normalize(quote);
  const found: { start: string; end: string }[] = [];
  for (const match of text.matchAll(/(\d{4})\s*年?\s*[-到至]+\s*(\d{4})/g)) found.push({ start: match[1], end: match[2] });
  for (const match of text.matchAll(/from\s+(\d{4})\s+(?:to|through|until)\s+(\d{4})/g)) found.push({ start: match[1], end: match[2] });
  return found;
}

function yearIsRangeStartOnly(quote: string, year: string) {
  const ranges = rangesOf(quote);
  if (!ranges.length) return false;
  return ranges.some((range) => range.start === year) && !ranges.some((range) => range.end === year);
}

function hasEndCue(quote: string) {
  const text = normalize(quote);
  if (rangesOf(quote).length) return true;
  if (/\b(left|resigned|resigning|resignation|departed|departing|ousted|ceased)\b/.test(text)) return true;
  if (/stepped down|steps down|no longer|was acquired|been acquired|acquired by|transitioned|transitioning|sale in \d{4}|sold in \d{4}/.test(text)) return true;
  return /离职|卸任|离任|辞职|辞去|辞任|卸下|不再担任|不再持有|不再是|被收购/.test(text);
}

function hasPresentCue(quote: string) {
  const text = normalize(quote).replace(/would remain|will remain|to remain|will serve|would serve/g, "");
  const office =
    "chair|chairman|chairwoman|chairperson|co-chair|chief|ceo|founder|co-founder|cofounder|president|director|member|shareholder|owner|advisor|adviser|investor|partner|head";
  const firm = /currently|现任|至今|目前仍|remains|has served/.test(text);
  if (/\bformer\b|曾任|曾经担任|曾经是|previously/.test(text) && !firm) return false;
  if (/was acquired|been acquired|acquired by|被收购|shut down|解散|倒闭/.test(text) && !firm) return false;
  return new RegExp(
    `currently|remains (a|an|the|on)|has served|have served|serves as|serving as|serves on the board|is a senior fellow|is still|-present\\b|现任|现为|目前仍|目前担任|至今|仍然担任|仍然是|仍是|仍任|仍持有|现在仍|has been (a |an |the |its )?(?:${office})\\b|is (also )?(a |an |the |its )?(?:${office})\\b`,
  ).test(text);
}

// Same sentence both keeps him in the seat and says the organisation was bought. That does not settle the end.
function contradictory(quote: string) {
  const text = normalize(quote);
  return /was acquired|been acquired|acquired by|被收购/.test(text) && /\bis (also )?(a |an |the |its )\b/.test(text) && !/currently|现任|至今|remains/.test(text);
}

function holdingNow(quote: string) {
  const text = normalize(quote);
  if (!/\b(owns?|stakes?|shares?|shareholder|percent)\b|%|持股|股份|股东|股权/.test(text)) return false;
  const past = /\b(was|were|sold|pledged)\b|曾任|曾经|承诺转让/.test(text);
  const firm = /\bowns\b|controlling shareholder|仍持有|仍持股/.test(text);
  if (past && !firm) return false;
  return firm || /shareholder|is a shareholder|仍持有|仍持股|-present\b|至今|currently/.test(text);
}

function parseWhen(raw: string) {
  const text = raw.trim();
  const direct = cleanDate(text);
  if (direct) return direct;
  const match = text.match(/(\d{4})\s*年\s*(\d{1,2})?\s*月?/);
  if (!match) return null;
  if (!match[2]) return match[1];
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}

function realDate(value: string) {
  const match = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return false;
  const year = Number(match[1]);
  const maxYear = new Date().getFullYear();
  if (year < 1950 || year > maxYear) return false;
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) return false;
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31)) return false;
  return endKindOf(value) === "ended";
}

function laterYearAlsoPresent(quote: string, year: string) {
  const maxYear = new Date().getFullYear();
  return [...quote.matchAll(/\d{4}/g)].some((match) => match[0] > year && Number(match[0]) <= maxYear);
}

function judgeQuote(row: Row, verdict: Verdict, when: string, quote: string): Decision {
  const unchanged = (note: string): Decision => ({ judgment: note ? `不改（${note}）` : "不改", quote, write: null });
  if (verdict === "unchanged") return unchanged("");
  if (!quote) return unchanged("没有依据句");
  if (quote.length > 400) return unchanged("依据句太长");
  if (!quoteOnPage(quote, row.text)) return unchanged("依据句不在存档原文里");
  if (!quoteNamesOrg(quote, row)) return unchanged("依据句没有机构名");
  if (contradictory(quote)) return unchanged("同一句既像在任又写了被收购");
  if (verdict === "ongoing") {
    if (row.role.includes("前任") || /前(?:CEO|总裁|董事|董事长)|原(?:CEO|总裁|董事|董事长)/.test(row.role)) return unchanged("职务本身是前任");
    if (row.kind === "deal" && !/pay|compensat|salary|package|remunerat|contract|sponsor|顾问费|薪酬|薪水|合同|赞助|报酬/.test(normalize(quote))) {
      return unchanged("依据句没有写这份商业往来仍在继续");
    }
    if (row.kind === "holding") {
      if (!holdingNow(quote)) return unchanged("依据句没有写明现在仍持有");
      return { judgment: "在任", quote, write: { ended: "present", endKind: "ongoing" } };
    }
    // 「联合创始人」本身不是任期。只写了现在是 CEO / 董事长，不能把创始人记成至今。
    if (/创始/.test(row.role) && !/ceo|总裁|董事|主席|首席|董事长/.test(row.role)) {
      if (!/is (also )?(a |an |the |its )?(co-)?founder|现任创始|仍是.{0,6}创始/.test(normalize(quote))) return unchanged("依据句没有写明创始人身份仍在");
    }
    if (!hasPresentCue(quote)) return unchanged("依据句没有写明截至发文仍在任");
    return { judgment: "在任", quote, write: { ended: "present", endKind: "ongoing" } };
  }
  const date = parseWhen(when);
  if (!date || date === "present" || !realDate(date)) return unchanged("没有可用的结束时间");
  const year = date.slice(0, 4);
  if (!hasYear(quote, year)) return unchanged("依据句没有结束年份");
  if (!hasEndCue(quote)) return unchanged("依据句没有写明已经结束");
  if (yearIsRangeStartOnly(quote, year)) return unchanged("依据句里这个年份是区间起点");
  if (row.started && year < row.started.slice(0, 4)) return unchanged("结束年早于开始年");
  if (laterYearAlsoPresent(quote, year) && !rangesOf(quote).some((range) => range.end === year)) return unchanged("依据句里还有更晚的年份");
  return { judgment: `已结束 ${date}`, quote, write: { ended: date, endKind: "ended" } };
}

async function ask(row: Row, text: string) {
  const answer = (await arkJson(
    [
      "你是事实核查员。只能依据用户给出的存档原文，不能用你自己的记忆补充任何日期或职务。",
      `任务：判断 ${row.name_en} 本人与「${row.counterparty}」之间「${row.role || "这段关系"}」这一条，原文写了什么。页面上别人的任期不算。`,
      "只许三种 verdict：",
      "- ended：原文写明这段关系已经结束，并且写出了结束年份（或年月）。ended 填 YYYY 或 YYYY-MM。年份必须是原文里的四位数字。不能从 was、former、曾任、曾经、founded、joined 推断一个结束年。区间（2014-2022、from 2014 to 2022）取结束的那一年，不取起点。转到下一家（transitioned to、before joining）可以当作上一段在那一年结束。",
      "- ongoing：原文写明截至这篇存档发文时，这段关系仍在继续。典型用语：现任、目前仍、至今、currently、is the CEO、is its chairman、remains、has served as、since 2019 has served as、1993–present。持股要看到现在时的持有：owns、is a shareholder、controlling shareholder、仍持股。ended 填 present。",
      "- unchanged：原文没说。下列一律 unchanged：只说 was / former / previously / 曾任 / 曾经 / joined / founded / co-founded / invested，但没写结束年份，也没写发文时仍在任；would remain、将留任这种打算；同一句既写 is a member / is the chair，又写 was acquired / 被收购；拿不准。不要把出生、国籍那一句当成依据。",
      "不要把「曾经、was、former、曾任、co-founded」当成「至今」。过去时本身既不是结束日期，也不是仍在任。创始人、联合创始人只有原文写明现在仍是 founder 才算 ongoing；原文只说他现在是 CEO 或董事长，而本条职务是创始人时，判 unchanged。",
      "持股和投资更严：owns 3.6%、is a shareholder、controlling shareholder、仍持股 才是 ongoing。portfolio includes、invested in、was a shareholder、was listed as、pledged to transfer 都是 unchanged。不要用「他是 CEO」那一句来证明持股。",
      "quote 必须从原文逐字复制一句（20 到 300 字），这一句单独就能支撑判断，并且含有机构名。ended 时这一句里还必须有结束年份的四位数字。机构名和年份分属相邻两句时，可以用 … 连接两段逐字原文，每段至少 15 个字。不要改写、翻译或补充。unchanged 时 quote 留空。",
      '输出 JSON：{"verdict":"ended"|"ongoing"|"unchanged","ended":"","quote":""}',
    ].join("\n"),
    JSON.stringify({
      person: row.name_en,
      organisation: row.counterparty,
      organisation_zh: row.counterparty_zh,
      role: row.role,
      kind: row.kind,
      started: row.started ?? "",
      text,
    }),
    1000,
    "RELATION_END_V1",
  )) as { verdict?: string; ended?: string; quote?: string };
  const raw = (answer.verdict ?? "").trim().toLowerCase();
  const verdict: Verdict = raw === "ended" || raw === "已结束" ? "ended" : raw === "ongoing" || raw === "present" || raw === "在任" ? "ongoing" : "unchanged";
  const decision = judgeQuote(row, verdict, String(answer.ended ?? ""), String(answer.quote ?? "").trim());
  return { ...decision, modelCallId: takeModelCallId(answer) };
}

// In one transaction: close the old row first (the live-row unique index then lets the copy in), insert the
// corrected copy, and point the old row at it.
async function correct(row: Row, ended: string, kind: "ended" | "ongoing", callId: string | null) {
  return sql.begin(async (tx) => {
    const [closed] = await tx<{ id: number }[]>`
      UPDATE interests SET superseded_at = now()
      WHERE id = ${row.id} AND superseded_at IS NULL AND end_kind = 'unknown'
      RETURNING id::int AS id
    `;
    if (!closed) throw new Error(`#${row.id} 已不是未知结束或已被取代，取消写入`);
    const [created] = await tx<{ id: number }[]>`
      INSERT INTO interests (
        person_id, kind, counterparty, counterparty_zh, role, started, ended, end_kind,
        source_url, source_id, quote, publication, provenance, reviewed_at,
        stake_pct, amount_usd, org_key, model_call_id
      ) VALUES (
        ${row.person_id}, ${row.kind}, ${row.counterparty}, ${row.counterparty_zh}, ${row.role}, ${row.started},
        ${ended}, ${kind}, ${row.source_url}, ${row.source_id}, ${row.quote}, ${row.publication}, 'agent', ${row.reviewed_at},
        ${row.stake_pct}, ${row.amount_usd}, ${row.org_key}, ${callId}
      )
      RETURNING id::int AS id
    `;
    await tx`UPDATE interests SET superseded_by = ${created.id} WHERE id = ${row.id}`;
    return created.id;
  });
}

function orgLabel(row: Row) {
  if (row.counterparty_zh && row.counterparty_zh !== row.counterparty) return `${row.counterparty}（${row.counterparty_zh}）`;
  return row.counterparty;
}

async function counts() {
  return sql<{ end_kind: string; publication: string; current: number; superseded: number }[]>`
    SELECT coalesce(end_kind, 'null') AS end_kind, publication,
           count(*) FILTER (WHERE superseded_at IS NULL)::int AS current,
           count(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS superseded
    FROM interests
    GROUP BY 1, 2
    ORDER BY 2, 1
  `;
}

async function main() {
  await migrate();
  const preflight = await arkPreflight({ search: false });
  if (!preflight.ok) {
    console.log(`启动预检没通过，不开始：\n  ${preflight.problems.join("\n  ")}`);
    return;
  }
  const afp = await afpUsedToday();
  if (afp.used >= afp.budget) {
    console.log(`AFP 今日已用 ${afp.used}，达到预算 ${afp.budget}，停止`);
    return;
  }
  const rows = await sql<Row[]>`
    SELECT i.id::int AS id, i.person_id, p.name, p.name_en, i.kind, i.counterparty, i.counterparty_zh, i.role,
           i.started, i.source_url, i.source_id::int AS source_id, i.quote, i.publication, i.reviewed_at,
           i.stake_pct::text AS stake_pct, i.amount_usd::text AS amount_usd, i.org_key, s.text
    FROM interests i
    JOIN people p ON p.id = i.person_id
    JOIN sources s ON s.id = i.source_id
    WHERE i.end_kind = 'unknown' AND i.superseded_at IS NULL
      ${people.length ? sql`AND i.person_id IN ${sql(people)}` : sql``}
      ${publication ? sql`AND i.publication = ${publication}` : sql``}
    ORDER BY CASE WHEN i.publication = 'published' THEN 0 ELSE 1 END, i.id
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;
  console.log(
    `结束时间未知 ${rows.length} 条 · ${apply ? "写库" : "试运行（加 --apply 才写库）"} · 今日 AFP ${afp.used}/${afp.budget}（只做模型调用）`,
  );
  const before = apply ? await counts() : [];
  let endedN = 0;
  let ongoingN = 0;
  let unchangedN = 0;
  let written = 0;
  let failed = 0;
  for (const row of rows) {
    const head = `#${row.id} ${row.name} · ${orgLabel(row)} · ${row.role || "（无职务）"}`;
    try {
      const text = passage(row.text, row);
      if (!orgNames(row).some((name) => normalize(text).includes(normalize(name)))) {
        unchangedN += 1;
        console.log(`${head} · 不改（存档段落里没有该机构名） · —`);
        continue;
      }
      const decision = await ask(row, text);
      if (decision.write?.endKind === "ended") endedN += 1;
      else if (decision.write?.endKind === "ongoing") ongoingN += 1;
      else unchangedN += 1;
      let suffix = "";
      if (apply && decision.write) {
        const id = await correct(row, decision.write.ended, decision.write.endKind, decision.modelCallId);
        written += 1;
        suffix = ` · 已写入 #${id}`;
      }
      console.log(`${head} · ${decision.judgment} · ${clip(decision.quote)}${suffix}`);
    } catch (error) {
      if (error instanceof ArkStopped) {
        console.log(`停止：${error.message}`);
        break;
      }
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${head} · 失败 · ${message.slice(0, 160)}`);
    }
  }
  console.log(`完成 · 已结束 ${endedN} · 在任 ${ongoingN} · 不改 ${unchangedN} · 失败 ${failed}${apply ? ` · 写入 ${written}` : ""}`);
  if (apply) {
    const after = await counts();
    console.log("写库前：");
    for (const row of before) console.log(`  ${row.publication} ${row.end_kind} 当前 ${row.current} 已取代 ${row.superseded}`);
    console.log("写库后：");
    for (const row of after) console.log(`  ${row.publication} ${row.end_kind} 当前 ${row.current} 已取代 ${row.superseded}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
