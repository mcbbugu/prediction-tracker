// pnpm api:interests -- [--people=musk,altman] [--first=20] [--publish] [--link-only]
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
import { arkJson, arkSearch } from "./ark";
import { sql } from "./db";
import { migrate } from "./migrate";
import { excerpt, normalize, quoteOnPage, snapshot, usableLinks, type Snapshot } from "./sources";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const publish = process.argv.includes("--publish") || process.env.AUTO_PUBLISH === "1";
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
};

// "Tesla, Inc." and "Tesla" are the same counterparty.
function canonical(name: string) {
  return name.replace(/[,.]?\s+(inc|corp|corporation|ltd|llc|co|plc|company)\.?$/i, "").replace(/\s+/g, " ").trim();
}

// "2008", "2008-10" or "2008-10-01"; anything else is unknown.
function cleanDate(value: string | undefined) {
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
      "不收：他名下公司对外的交易（如他的公司和别家签合同、被收购）、竞争对手、亲属关系、捐款、学历、荣誉、传闻、计划中尚未发生的事。",
      "同一家机构的同一种关系只列一次。",
      "counterparty 写机构英文正式名（如 Tesla、OpenAI、NVIDIA），counterparty_zh 写常用中文名。role 用中文简写，如「CEO」「联合创始人」「董事」「持股约 13%」「投资人」「顾问」。",
      "started / ended 只在原文写明时填，格式 YYYY 或 YYYY-MM；仍在任填 ended = \"present\"；原文没写就留空字符串。",
      "quote 必须从原文逐字复制一句（20 到 300 字），这句话要能单独说明这条关系，并且出现机构名。不要改写、翻译或拼接。",
      '输出 JSON：{"relations":[{"kind":"role","counterparty":"","counterparty_zh":"","role":"","started":"","ended":"","quote":""}]}',
    ].join("\n"),
    JSON.stringify({ person: person.name_en, url: page.final_url, title: page.title, text: excerpt(page.text, KEYS, 10000) }),
    3000,
  )) as { relations?: Extracted[] };
  return answer.relations ?? [];
}

async function collect(person: Person) {
  const pages = await candidatePages(person);
  console.log(`  存档 ${pages.length} 个页面`);
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
      const counterparty = canonical((item.counterparty ?? "").trim());
      const quote = (item.quote ?? "").trim();
      const names = [counterparty, (item.counterparty ?? "").trim(), (item.counterparty_zh ?? "").trim()].filter(Boolean).map(normalize);
      if (!KINDS.has(kind) || !counterparty || !quoteOnPage(quote, page.text) || !names.some((name) => normalize(quote).includes(name))) {
        rejected += 1;
        continue;
      }
      const ended = (item.ended ?? "").trim().toLowerCase() === "present" ? "present" : cleanDate(item.ended);
      const rows = await sql`
        INSERT INTO interests (person_id, kind, counterparty, counterparty_zh, role, started, ended, source_url, source_id, quote, publication)
        VALUES (
          ${person.id}, ${kind}, ${counterparty}, ${(item.counterparty_zh ?? "").trim()}, ${(item.role ?? "").trim()},
          ${cleanDate(item.started)}, ${ended}, ${page.final_url}, ${page.id}, ${quote}, ${publish ? "published" : "proposed"}
        )
        ON CONFLICT (person_id, kind, lower(counterparty), lower(role)) DO NOTHING
        RETURNING id
      `;
      if (rows.length) kept += 1;
    }
  }
  return { pages: pages.length, kept, rejected };
}

// "said" is YYYY-MM-DD; a relation date may be YYYY or YYYY-MM, so compare at its precision.
function activeOn(interest: { started: string | null; ended: string | null }, said: string) {
  if (!interest.started || said.slice(0, interest.started.length) < interest.started) return false;
  if (interest.ended === "present") return true;
  if (!interest.ended) return false;
  return said.slice(0, interest.ended.length) <= interest.ended;
}

export async function linkClaims(personId: string) {
  const interests = await sql<{ id: number; kind: string; counterparty: string; counterparty_zh: string; role: string; started: string | null; ended: string | null }[]>`
    SELECT id, kind, counterparty, counterparty_zh, role, started, ended
    FROM interests WHERE person_id = ${personId} AND publication = 'published'
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
        INSERT INTO claim_interests (claim_id, interest_id, reason)
        VALUES (${claim.id}, ${Number(interestId)}, ${(link.reason ?? "").trim()})
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
  const people = await resolvePeople();
  console.log(`利益关系：${people.length} 人 · ${publish ? "通过核对的直接公开（机器核对）" : "结果进审核台"}${linkOnly ? " · 只重新标注主张" : ""}`);
  for (const person of people) {
    console.log(`\n${person.name}（${person.name_en}）`);
    if (!linkOnly) {
      const result = await collect(person);
      console.log(`  新增关系 ${result.kept} 条，丢弃 ${result.rejected} 条（依据句对不上或没提到机构）`);
    }
    try {
      console.log(`  标注利益相关主张 ${await linkClaims(person.id)} 条`);
    } catch (error) {
      console.log(`  标注失败：${(error as Error).message.slice(0, 120)}`);
    }
  }
  await sql.end();
}

if (import.meta.main) {
  main().catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
}
