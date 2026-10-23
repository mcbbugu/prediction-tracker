// pnpm api:interests -- [--people=musk,altman] [--first=20] [--publish] [--link-only] [--concurrency=3]
// 利益关系采集（SPEC「利益关系」、P12）：任职与控制、持股与投资、商业往来，每条带起止时间和存档出处。
//
// Same bar as claims — the model is never trusted on its own:
//   1. Candidate pages: the person's English Wikipedia article plus web search results. We archive each page ourselves.
//   2. The model extracts relations using ONLY that saved text, copying one supporting sentence word for word.
//   3. Code keeps a relation only if the sentence is on the saved page and names the counterparty.
//   4. Claims are then linked to the relations active on the day they were said (code checks the dates).
// --publish (local-only mode, like batch): relations go public as 机器核对; otherwise they wait as proposed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArkStopped, arkJson, arkPreflight, arkSearch } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { canonicalName, orgKey, parseScale } from "./orgs";
import { excerpt, normalize, quoteOnPage, snapshot, usableLinks, type Snapshot } from "../evidence/sources";
import { isProduction } from "../core/env";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// --publish / AUTO_PUBLISH only work off production (core/env.ts).
const publish = (process.argv.includes("--publish") || process.env.AUTO_PUBLISH === "1") && !isProduction;
const linkOnly = process.argv.includes("--link-only");
const MAX_PAGES = 7;
const KINDS = new Set(["role", "holding", "deal"]);

type Person = { id: string; name: string; name_en: string };
type Extracted = {
  kind?: string;
  counterparty?: string;
  counterparty_zh?: string;
  role?: string;
  started?: string;
  ended?: string;
  page?: number;
  quote?: string;
  stake_text?: string;
  amount_text?: string;
};

// "2008", "2008-10" or "2008-10-01"; anything else is unknown.
export function cleanDate(value: string | undefined) {
  const match = (value ?? "").trim().match(/^\d{4}(-\d{2}(-\d{2})?)?$/);
  return match ? match[0] : null;
}

function wikipediaUrl(person: Person) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(person.name_en.replace(/\s+/g, "_"))}`;
}

async function search(query: string) {
  try {
    return (await arkSearch(query)).urls;
  } catch (error) {
    // Budget, outage or access problems stop the whole run; one failed search does not.
    if (error instanceof ArkStopped) throw error;
    console.log(`  搜索失败：${(error as Error).message.slice(0, 120)}`);
    return [];
  }
}

async function candidatePages(person: Person) {
  const queries = [
    `${person.name_en} career: companies founded, CEO and board positions, with start and end years. Official bios, company pages, Wikipedia.`,
    `${person.name_en} stake shareholding investments disclosed SEC filing annual report percentage owned`,
    `${person.name}（${person.name_en}）的任职经历、持股、投资和商业合作（顾问、代言、合同），附出处`,
  ];
  const urls = [wikipediaUrl(person)];
  for (const query of queries) urls.push(...(await search(query)));
  const pages: Snapshot[] = [];
  for (const url of usableLinks(urls).slice(0, 14)) {
    if (pages.length >= MAX_PAGES) break;
    const page = await snapshot(url);
    if (page && page.http_status < 400 && page.text.length >= 400 && normalize(page.text).includes(surname(person))) pages.push(page);
  }
  return pages;
}

function surname(person: Person) {
  return normalize(person.name_en.split(/\s+/).pop() ?? person.name_en);
}

const KEYS = [
  "founder", "founded", "co-founded", "ceo", "chief executive", "president", "chairman", "chair", "board", "director",
  "stake", "shares", "owns", "owned", "invest", "investor", "advisor", "adviser", "partner", "joined", "left", "resigned",
  "创始", "创办", "首席执行官", "董事", "持股", "股份", "投资", "顾问", "任职", "离职",
];

async function extract(person: Person, page: Snapshot) {
  const answer = (await arkJson(
    [
      "你是事实核查员。只能依据用户给出的网页原文，不能用你自己的记忆补充事实。",
      `任务：列出原文里明确写到的、${person.name_en} 本人的利益关系。三类：`,
      "- role：任职与控制（创始人、联合创始人、CEO、总裁、董事、董事长、控股）。",
      "- holding：公开披露的持股和投资（含本人公开说过的持仓、投资某公司）。",
      "- deal：本人与机构之间有明确来源的商业往来（付费顾问、代言、赞助、合同、薪酬方案）。",
      "不收：政府和公职、他名下公司对外的交易（如他的公司和别家签合同、被收购）、竞争对手、亲属关系、捐款、学历、荣誉、传闻、计划中尚未发生的事。",
      "同一家机构的同一种关系只列一次。",
      "counterparty 写机构英文正式名（如 Tesla、OpenAI、NVIDIA），counterparty_zh 写中文媒体常用的叫法，没有通行中文名的品牌（如 SpaceX、OpenAI、Neuralink、PayPal、xAI）留空字符串，不要硬译。role 用中文简写，如「CEO」「联合创始人」「董事」「持股约 13%」「投资人」「顾问」。",
      "started / ended 只在原文写明时填，格式 YYYY 或 YYYY-MM；仍在任填 ended = \"present\"；原文没写就留空字符串。",
      "quote 必须从原文逐字复制一句（20 到 300 字），这句话要能单独说明这条关系，并且出现机构名。不要改写、翻译或拼接。",
      "stake_text：quote 里写明的持股比例原文片段（如「20.3%」「about 13 percent」），amount_text：quote 里写明的金额原文片段（如「$6.5 million」「1亿美元」）。必须从 quote 里逐字复制；quote 里没有就留空，不要估算或换算。",
      '输出 JSON：{"relations":[{"kind":"role","counterparty":"","counterparty_zh":"","role":"","started":"","ended":"","quote":"","stake_text":"","amount_text":""}]}',
    ].join("\n"),
    JSON.stringify({ person: person.name_en, url: page.final_url, title: page.title, text: excerpt(page.text, KEYS, 10000) }),
    3000,
  )) as { relations?: Extracted[] };
  return answer.relations ?? [];
}

async function collect(person: Person, publication: "published" | "proposed" = publish ? "published" : "proposed") {
  const pages = await candidatePages(person);
  let kept = 0;
  let rejected = 0;
  for (const page of pages) {
    let relations: Extracted[] = [];
    try {
      relations = await extract(person, page);
    } catch (error) {
      console.log(`  抽取失败 ${page.final_url}：${(error as Error).message.slice(0, 100)}`);
      continue;
    }
    for (const item of relations) {
      const kind = (item.kind ?? "").trim();
      const counterparty = canonicalName((item.counterparty ?? "").trim());
      const quote = (item.quote ?? "").trim();
      const names = [counterparty, (item.counterparty ?? "").trim(), (item.counterparty_zh ?? "").trim()].filter(Boolean).map(normalize);
      if (!KINDS.has(kind) || !counterparty || !quoteOnPage(quote, page.text) || !names.some((name) => normalize(quote).includes(name))) {
        rejected += 1;
        continue;
      }
      const ended = (item.ended ?? "").trim().toLowerCase() === "present" ? "present" : cleanDate(item.ended);
      const rows = await sql`
        INSERT INTO interests (person_id, kind, counterparty, counterparty_zh, role, started, ended, end_kind, source_url, source_id, quote, publication,
                               org_key, stake_pct, amount_usd)
        VALUES (
          ${person.id}, ${kind}, ${counterparty}, ${(item.counterparty_zh ?? "").trim()}, ${(item.role ?? "").trim()},
          ${cleanDate(item.started)}, ${ended}, ${endKind(ended)}, ${page.final_url}, ${page.id}, ${quote}, ${publication},
          ${orgKey(counterparty)}, ${parseScale(item.stake_text, quote, "pct")}, ${parseScale(item.amount_text, quote, "usd")}
        )
        ON CONFLICT (person_id, kind, lower(counterparty), lower(role)) DO NOTHING
        RETURNING id
      `;
      if (rows.length) kept += 1;
    }
  }
  return { pages: pages.length, kept, rejected };
}

// Several pages describe the same relation in different words. Keep one row per relation — the most complete one,
// with its own source and sentence untouched — and mark the rest as merged (nothing is deleted).
export async function consolidate(personId: string) {
  const rows = await sql<{ id: number; kind: string; counterparty: string; org_key: string | null; role: string; started: string | null; ended: string | null; source_url: string }[]>`
    SELECT id::int AS id, kind, counterparty, org_key, role, started, ended, source_url
    FROM interests WHERE person_id = ${personId} AND publication IN ('published', 'proposed') AND superseded_at IS NULL
  `;
  if (rows.length < 2) return 0;
  const answer = (await arkJson(
    [
      "下面是同一个人的利益关系记录，来自不同网页，很多是同一件事的不同写法。",
      "把描述同一条关系的记录分到一组（同一机构、同一种关系；例如「CEO」「CEO兼产品架构师」是同一组，「董事长」和「CEO」不是同一组；同一家公司不同时间点的持股可以并成一组）。",
      "org_key 相同的是同一家机构（如 X 与 Twitter）；org_key 不同的不要合并。",
      "每组选一条保留：优先有起止时间的，其次出处更权威的（公司公告、SEC、官方简介 > 维基百科 > 其他）。",
      '输出 JSON：{"groups":[{"keep":1,"merge":[2,3]}]}，只有一条的组也要列出。',
    ].join("\n"),
    JSON.stringify(rows),
    4000,
  )) as { groups?: { keep?: number; merge?: number[] }[] };
  const known = new Set(rows.map((row) => row.id));
  const keep = new Set((answer.groups ?? []).map((group) => Number(group.keep)).filter((id) => known.has(id)));
  const merged = (answer.groups ?? [])
    .flatMap((group) => group.merge ?? [])
    .map(Number)
    .filter((id) => known.has(id) && !keep.has(id));
  if (merged.length) await sql`UPDATE interests SET publication = 'merged' WHERE id IN ${sql(merged)}`;
  return merged.length;
}

// Rows collected before the scale fields existed: set org_key, and read stake / amount from the sentence we already kept.
export async function backfill(personId: string) {
  const rows = await sql<{ id: number; counterparty: string; quote: string; org_key: string | null; stake_pct: string | null; amount_usd: string | null }[]>`
    SELECT id::int AS id, counterparty, quote, org_key, stake_pct, amount_usd
    FROM interests WHERE person_id = ${personId} AND publication IN ('published', 'proposed') AND superseded_at IS NULL
  `;
  for (const row of rows) {
    if (row.org_key !== orgKey(row.counterparty)) await sql`UPDATE interests SET org_key = ${orgKey(row.counterparty)} WHERE id = ${row.id}`;
  }
  const todo = rows.filter((row) => row.stake_pct === null && row.amount_usd === null && /\d/.test(row.quote));
  if (!todo.length) return 0;
  const answer = (await arkJson(
    [
      "下面每条是一句原文。如果句子里写明了持股比例或金额，把那个原文片段逐字复制出来。",
      "stake_text 如「20.3%」「about 13 percent」；amount_text 如「$6.5 million」「1亿美元」。句子里没有就留空，不要估算或换算。",
      '输出 JSON：{"rows":[{"id":1,"stake_text":"","amount_text":""}]}',
    ].join("\n"),
    JSON.stringify(todo.map((row) => ({ id: row.id, counterparty: row.counterparty, quote: row.quote }))),
    3000,
  )) as { rows?: { id?: number; stake_text?: string; amount_text?: string }[] };
  const byId = new Map(todo.map((row) => [row.id, row]));
  let filled = 0;
  for (const item of answer.rows ?? []) {
    const row = byId.get(Number(item.id));
    if (!row) continue;
    const stake = parseScale(item.stake_text, row.quote, "pct");
    const amount = parseScale(item.amount_text, row.quote, "usd");
    if (stake === null && amount === null) continue;
    await sql`UPDATE interests SET stake_pct = ${stake}, amount_usd = ${amount} WHERE id = ${row.id}`;
    filled += 1;
  }
  return filled;
}

// 按需分析用：给一个人补齐详情页上的利益关系，核对通过的直接公开。
export async function fillPersonInterests(personId: string) {
  const [person] = await sql<Person[]>`SELECT id, name, name_en FROM people WHERE id = ${personId}`;
  if (!person?.name_en) return { pages: 0, kept: 0, rejected: 0, linked: 0 };
  const result = await collect(person, "published");
  await backfill(person.id);
  await consolidate(person.id);
  const linked = await linkClaims(person.id);
  return { ...result, linked };
}

// "said" is YYYY-MM-DD; a relation date may be YYYY or YYYY-MM, so compare at its precision.
// 利益关系双时态: what a stored end date says about the tie. No end date is "unknown", not "ongoing".
export type EndKind = "ongoing" | "ended" | "planned" | "unknown";
export function endKind(ended: string | null | undefined, today = new Date().toISOString().slice(0, 10)): EndKind {
  if (!ended) return "unknown";
  if (ended === "present") return "ongoing";
  return ended > today ? "planned" : "ended";
}

export function activeOn(interest: { started: string | null; ended: string | null }, said: string) {
  if (!interest.started || said.slice(0, interest.started.length) < interest.started) return false;
  if (interest.ended === "present") return true;
  if (!interest.ended) return false;
  return said.slice(0, interest.ended.length) <= interest.ended;
}

export async function linkClaims(personId: string) {
  const interests = await sql<{ id: number; kind: string; counterparty: string; counterparty_zh: string; role: string; started: string | null; ended: string | null }[]>`
    SELECT id, kind, counterparty, counterparty_zh, role, started, ended
    FROM interests WHERE person_id = ${personId} AND publication = 'published' AND superseded_at IS NULL
  `;
  const claims = await sql<{ id: string; category: string; quote_en: string; quote_zh: string; published_date: string }[]>`
    SELECT id, category, quote_en, quote_zh, to_char(published_date, 'YYYY-MM-DD') AS published_date
    FROM claims WHERE person_id = ${personId} AND publication = 'published'
  `;
  await sql`DELETE FROM claim_interests WHERE claim_id IN ${sql(claims.length ? claims.map((claim) => claim.id) : [""])}`;
  if (!interests.length || !claims.length) return 0;

  // The model only says which organisation a claim is about; whether the relation held on that day is checked in code.
  const answer = (await arkJson(
    [
      "下面是一个人公开说过的若干主张，以及他和一些机构的关系。",
      "对每条主张，判断它谈的是不是这些机构本身、它们的产品、业务或股价（例如主张关于特斯拉的自动驾驶 → Tesla）。",
      "只按主张内容判断，不考虑时间。谈的是整个行业、别家公司或泛泛的技术趋势，就不算。",
      '输出 JSON：{"links":[{"claim_id":"","interest_ids":[1],"reason":"一句中文"}]}，没有关联的主张不用列。',
    ].join("\n"),
    JSON.stringify({
      interests: interests.map((item) => ({ id: Number(item.id), organisation: `${item.counterparty}（${item.counterparty_zh}）`, role: item.role })),
      claims: claims.map((claim) => ({ claim_id: claim.id, domain: claim.category, quote: claim.quote_en || claim.quote_zh })),
    }),
    4000,
  )) as { links?: { claim_id?: string; interest_ids?: number[]; reason?: string }[] };

  const byId = new Map(interests.map((item) => [Number(item.id), item]));
  const byClaim = new Map(claims.map((claim) => [claim.id, claim]));
  let linked = 0;
  for (const link of answer.links ?? []) {
    const claim = byClaim.get(link.claim_id ?? "");
    if (!claim) continue;
    for (const interestId of link.interest_ids ?? []) {
      const interest = byId.get(Number(interestId));
      if (!interest || !activeOn(interest, claim.published_date)) continue;
      await sql`
        INSERT INTO claim_interests (claim_id, interest_id, reason, level)
        VALUES (${claim.id}, ${Number(interestId)}, ${(link.reason ?? "").trim()}, 'direct')
        ON CONFLICT DO NOTHING
      `;
      linked += 1;
    }
  }
  return linked;
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function resolvePeople() {
  const listed = arg("people");
  const first = Number(arg("first") ?? 0);
  const wanted: string[] = listed ? listed.split(",").map((item) => item.trim()) : [];
  if (first > 0) {
    const lines = readFileSync(join(root, "data/batches/ai-tech-100.txt"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .slice(0, first);
    for (const line of lines) {
      const [zh, en = ""] = line.split("|").map((part) => part.trim());
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM people WHERE id = ${slug(en)} OR name = ${zh} OR lower(name_en) = ${en.toLowerCase()}
        ORDER BY CASE id WHEN 'musk' THEN 0 WHEN 'altman' THEN 0 WHEN 'huang' THEN 0 ELSE 1 END
        LIMIT 1
      `;
      if (rows[0]) wanted.push(rows[0].id);
      else console.log(`库里还没有「${zh}」，跳过`);
    }
  }
  if (!wanted.length) wanted.push("musk", "altman", "huang");
  const ids = [...new Set(wanted)];
  return sql<Person[]>`SELECT id, name, name_en FROM people WHERE id IN ${sql(ids)}`;
}

async function main() {
  await migrate();
  const preflight = await arkPreflight();
  if (!preflight.ok) {
    console.log(`启动预检没通过，不开始：\n  ${preflight.problems.join("\n  ")}`);
    return;
  }
  const people = await resolvePeople();
  console.log(`利益关系：${people.length} 人 · ${publish ? "通过核对的直接公开（机器核对）" : "结果进审核台"}${linkOnly ? " · 只重新标注主张" : ""}`);
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 3));
  let next = 0;
  async function worker() {
    while (next < people.length) {
      const person = people[next++];
      const lines = [`\n${person.name}（${person.name_en}）`];
      try {
        if (!linkOnly) {
          const result = await collect(person);
          lines.push(`  存档 ${result.pages} 个页面，新增关系 ${result.kept} 条，丢弃 ${result.rejected} 条（依据句对不上或没提到机构）`);
        }
        lines.push(`  补规模字段 ${await backfill(person.id)} 条`);
        if (!linkOnly) lines.push(`  合并重复 ${await consolidate(person.id)} 条`);
        lines.push(`  标注利益相关主张 ${await linkClaims(person.id)} 条`);
      } catch (error) {
        lines.push(`  出错：${(error as Error).message.slice(0, 160)}`);
      }
      console.log(lines.join("\n"));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await sql.end();
}

if (import.meta.main) {
  main().catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
}
