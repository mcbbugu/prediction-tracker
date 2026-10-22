// pnpm api:exposures -- [--people=musk] [--crawl --orgs=tesla,spacex] [--publish]
// 默认只给主张挂敞口；全量爬取已冻结，要加 --crawl 才跑。
// 利益关系第二、三层（SPEC「利益关系的三层数据」）：
//   2. 机构 ↔ 外部敞口：地域营收、生产场地、供应商、客户、合作、投资，每条带规模、时间和存档出处。
//   3. 主张 ↔ 敞口：按说话当天有效的关系和敞口，给主张挂上相关敞口（direct / indirect + 一句原因）。
//
// Same bar as everything else — the model is never trusted on its own:
//   - candidate pages come from search; we archive each page ourselves (annual reports in full);
//   - the model extracts exposures using ONLY that saved text and copies the supporting sentence word for word;
//   - code keeps an exposure only if the sentence is on the saved page and names the target, and keeps a number
//     only if its text appears in that sentence. Nothing is estimated or converted.
import { ArkStopped, arkJson, arkPreflight, arkSearch } from "../core/ark";
import { sql } from "../core/db";
import { activeOn, cleanDate } from "./interests";
import { migrate } from "../core/migrate";
import { parseScale } from "./orgs";
import { excerpt, hostOf, normalize, quoteOnPage, snapshot, usableLinks, type Snapshot } from "../evidence/sources";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const publish = process.argv.includes("--publish") || process.env.AUTO_PUBLISH === "1";
// The bulk crawl of every dimension (2026-10) produced unreliable rows (lost units, wrong categories) and is
// frozen: those rows stay as basis = 'crawl' and show as unverified. US-listed revenue now comes from SEC
// filings (pnpm api:sec). Linking claims to exposures still runs; a new crawl needs --crawl on purpose.
const crawl = process.argv.includes("--crawl");
const linkOnly = process.argv.includes("--link-only") || !crawl;
const PAGES_PER_DIMENSION = 4;
// A 10-K is several hundred thousand characters; the geographic revenue note sits near the end.
const FILING_CHARS = 3_000_000;

export const DIMENSIONS = ["region", "facility", "supplier", "customer", "partner", "investment"] as const;
type Dimension = (typeof DIMENSIONS)[number];
const METRICS = new Set(["revenue_share", "production_share", "amount_usd", "stake_pct"]);

const PLAN: Record<Dimension, { label: string; queries: (name: string) => string[]; keys: string[] }> = {
  region: {
    label: "地域：各国或地区的营收、主要市场",
    queries: (name) => [
      `${name} 10-K annual report revenues by geographic area United States China other countries`,
      `${name} revenue by country China share of total revenue`,
    ],
    keys: ["geographic", "revenues", "united states", "china", "europe", "region", "country", "market", "营收", "中国"],
  },
  facility: {
    label: "生产场地：工厂、数据中心、发射场等，所在国家和城市，产能",
    queries: (name) => [
      `${name} 10-K Item 2 Properties manufacturing facilities locations`,
      `${name} factories production sites capacity by location`,
    ],
    keys: ["gigafactory", "factory", "facility", "facilities", "properties", "plant", "manufactur", "capacity", "launch", "data center", "工厂", "产能", "基地"],
  },
  supplier: {
    label: "供应商：关键零部件、原材料、芯片、电池等的主要供应商",
    queries: (name) => [`${name} key suppliers battery cells chips sole source supplier`, `${name} 主要供应商`],
    keys: ["supplier", "suppliers", "supply", "sourced", "sole", "cells", "chips", "供应商", "供货"],
  },
  customer: {
    label: "客户：大客户、重要合同的买方",
    queries: (name) => [`${name} largest customers major customer contract`],
    keys: ["customer", "customers", "contract", "awarded", "purchase", "客户", "订单", "合同"],
  },
  partner: {
    label: "合作：合资、战略合作、政府或机构合同（只当商业客户看）",
    queries: (name) => [`${name} strategic partnership joint venture agreement`, `${name} government contract award`],
    keys: ["partner", "partnership", "joint venture", "agreement", "collaborat", "contract", "合作", "合资", "协议"],
  },
  investment: {
    label: "投资：机构对外投资，以及机构背后的主要投资方",
    queries: (name) => [`${name} investors funding round raised valuation`, `${name} invested in stake in company`],
    keys: ["invest", "investor", "funding", "raised", "stake", "valuation", "round", "投资", "融资", "估值"],
  },
};

type Extracted = {
  target?: string;
  target_zh?: string;
  country?: string;
  metric_kind?: string;
  metric_text?: string;
  metric_unit?: string;
  metric_year?: number | string;
  started?: string;
  ended?: string;
  quote?: string;
};

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

// Tables come through as rows of bare numbers ("China 21,745 18,145"); the unit sits in the table header.
// Only a stated unit word is accepted, and only to scale a number that is itself copied from the sentence.
function metricValue(kind: string, text: string | undefined, unit: string | undefined, quote: string) {
  const raw = (text ?? "").trim();
  if (!raw || !quote.replace(/\s+/g, " ").includes(raw.replace(/\s+/g, " "))) return null;
  if (kind === "revenue_share" || kind === "production_share" || kind === "stake_pct") return parseScale(raw, quote, "pct");
  const direct = parseScale(raw, quote, "usd");
  if (direct !== null) return direct;
  const number = Number((raw.match(/^\$?\s*\d[\d,]*(\.\d+)?$/)?.[0] ?? "").replace(/[$,\s]/g, ""));
  const scale = { thousand: 1e3, million: 1e6, billion: 1e9 }[(unit ?? "").trim().toLowerCase()];
  return Number.isFinite(number) && number > 0 && scale ? number * scale : null;
}

async function extract(org: { key: string; name: string }, dimension: Dimension, page: Snapshot) {
  const answer = (await arkJson(
    [
      "你是事实核查员。只能依据用户给出的网页原文，不能用你自己的记忆补充事实。",
      `任务：列出原文里明确写到的、${org.name} 这家机构的外部利益牵连，只收这一类：${PLAN[dimension].label}。`,
      "不收：政治立场、政治捐款、传闻、计划中尚未落地的事、别家公司的情况。在某国建厂、营收、税收或土地协议属于商业牵连，可以收。",
      "target：对方名称（国家/地区、工厂名、供应商或客户公司名、合作方、被投公司或投资方），用原文写法；target_zh：中文常用叫法，没有通行中文名就留空。",
      "country：target 所在国家或地区的 ISO 两位代码（如 US、CN、DE），不确定就留空。",
      "metric_kind：revenue_share（营收占比）/ production_share（产量占比）/ amount_usd（金额）/ stake_pct（持股比例），原文没有数字就留空。",
      "metric_text：quote 里写明的那个数字的原文片段（如「21,745」「$1.2 billion」「22%」），必须从 quote 里逐字复制；metric_unit：仅当 quote 里是裸数字、而原文表头写明单位时填 thousand / million / billion，否则留空。不要计算、换算或估算占比。",
      "metric_year：数字对应的年份（如财年 2024），原文没写就留空。started / ended：原文写明的起止时间，格式 YYYY 或 YYYY-MM，仍在进行填 present，没写留空。",
      "quote：从原文逐字复制一句或表格的一行（20 到 300 字），要能单独说明这条牵连，并出现 target。不要改写、翻译或拼接。",
      '输出 JSON：{"exposures":[{"target":"","target_zh":"","country":"","metric_kind":"","metric_text":"","metric_unit":"","metric_year":"","started":"","ended":"","quote":""}]}',
    ].join("\n"),
    JSON.stringify({ organisation: org.name, url: page.final_url, title: page.title, text: excerpt(page.text, [org.name.toLowerCase(), ...PLAN[dimension].keys], 12000) }),
    3500,
  )) as { exposures?: Extracted[] };
  return answer.exposures ?? [];
}

async function collect(org: { key: string; name: string }) {
  const cache = new Map<string, Snapshot | null>();
  let kept = 0;
  let rejected = 0;
  for (const dimension of DIMENSIONS) {
    const urls: string[] = [];
    for (const query of PLAN[dimension].queries(org.name)) urls.push(...(await search(query)));
    const pages: Snapshot[] = [];
    for (const url of usableLinks(urls).slice(0, 10)) {
      if (pages.length >= PAGES_PER_DIMENSION) break;
      if (!cache.has(url)) cache.set(url, await snapshot(url, hostOf(url) === "sec.gov" ? FILING_CHARS : undefined));
      const page = cache.get(url);
      if (page && page.http_status < 400 && page.text.length >= 400 && normalize(page.text).includes(normalize(org.name))) pages.push(page);
    }
    for (const page of pages) {
      let items: Extracted[] = [];
      try {
        items = await extract(org, dimension, page);
      } catch (error) {
        console.log(`  抽取失败 ${dimension} ${page.final_url}：${(error as Error).message.slice(0, 100)}`);
        continue;
      }
      for (const item of items) {
        const target = (item.target ?? "").trim();
        const quote = (item.quote ?? "").trim();
        const names = [target, (item.target_zh ?? "").trim()].filter(Boolean).map(normalize);
        if (!target || !quoteOnPage(quote, page.text) || !names.some((name) => normalize(quote).includes(name))) {
          rejected += 1;
          continue;
        }
        const kind = METRICS.has((item.metric_kind ?? "").trim()) ? (item.metric_kind as string).trim() : null;
        const value = kind ? metricValue(kind, item.metric_text, item.metric_unit, quote) : null;
        const year = Number(String(item.metric_year ?? "").match(/\d{4}/)?.[0] ?? NaN);
        const country = (item.country ?? "").trim().toUpperCase();
        const ended = (item.ended ?? "").trim().toLowerCase() === "present" ? "present" : cleanDate(item.ended);
        const rows = await sql`
          INSERT INTO org_exposures (org_key, dimension, target, target_zh, country, metric_kind, metric_value, metric_year,
                                     started, ended, source_url, source_id, quote, publication)
          VALUES (
            ${org.key}, ${dimension}, ${target}, ${(item.target_zh ?? "").trim()}, ${/^[A-Z]{2}$/.test(country) ? country : null},
            ${value === null ? null : kind}, ${value}, ${value !== null && Number.isFinite(year) ? year : null},
            ${cleanDate(item.started)}, ${ended}, ${page.final_url}, ${page.id}, ${quote}, ${publish ? "published" : "proposed"}
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (rows.length) kept += 1;
      }
    }
    console.log(`  ${dimension}：存档 ${pages.length} 页`);
  }
  return { kept, rejected };
}

// An exposure counts on the day a claim was said if its own dates cover that day; with no dates,
// only a figure for that year (± 1) says it existed then.
export function exposureActiveOn(item: { started: string | null; ended: string | null; metric_year: number | null }, said: string) {
  if (item.started) {
    if (said.slice(0, item.started.length) < item.started) return false;
    if (!item.ended || item.ended === "present") return true;
    return said.slice(0, item.ended.length) <= item.ended;
  }
  if (item.metric_year) return Math.abs(Number(said.slice(0, 4)) - item.metric_year) <= 1;
  return false;
}

export async function linkExposures(personId: string) {
  const relations = await sql<{ org_key: string; started: string | null; ended: string | null }[]>`
    SELECT org_key, started, ended FROM interests
    WHERE person_id = ${personId} AND publication = 'published' AND kind IN ('role', 'holding') AND org_key IS NOT NULL
  `;
  const orgKeys = [...new Set(relations.map((item) => item.org_key))];
  const claims = await sql<{ id: string; category: string; quote_en: string; quote_zh: string; published_date: string }[]>`
    SELECT id, category, quote_en, quote_zh, to_char(published_date, 'YYYY-MM-DD') AS published_date
    FROM claims WHERE person_id = ${personId} AND publication = 'published'
  `;
  if (claims.length) await sql`DELETE FROM claim_exposures WHERE claim_id IN ${sql(claims.map((claim) => claim.id))}`;
  if (!orgKeys.length || !claims.length) return 0;
  const exposures = await sql<{ id: number; org_key: string; dimension: string; target: string; country: string | null; started: string | null; ended: string | null; metric_year: number | null }[]>`
    SELECT id::int AS id, org_key, dimension, target, country, started, ended, metric_year
    FROM org_exposures WHERE org_key IN ${sql(orgKeys)} AND publication = 'published'
  `;
  if (!exposures.length) return 0;

  // The model only says which exposures a claim is about; whether relation and exposure held that day is checked here.
  const answer = (await arkJson(
    [
      "下面是一个人公开说过的若干主张，以及他所控制或持有的机构的外部利益牵连（地域营收、工厂、供应商、客户、合作、投资）。",
      "对每条主张，找出它涉及的牵连：",
      "- direct：主张谈的就是这件事本身（如主张关于特斯拉在中国的销量 → 特斯拉的中国营收、上海工厂）。",
      "- indirect：主张没直接提到，但它的结果会明显影响这项牵连（如主张关于电池技术突破 → 特斯拉的电池供应商）。",
      "只按主张内容判断，不考虑时间；牵连很弱的不要列。reason 用一句中文，说明为什么相关，措辞中性。",
      '输出 JSON：{"links":[{"claim_id":"","exposure_id":1,"level":"direct","reason":""}]}，没有牵连的主张不用列。',
    ].join("\n"),
    JSON.stringify({
      exposures: exposures.map((item) => ({ id: item.id, organisation: item.org_key, dimension: item.dimension, target: item.target, country: item.country })),
      claims: claims.map((claim) => ({ claim_id: claim.id, domain: claim.category, quote: claim.quote_en || claim.quote_zh })),
    }),
    6000,
  )) as { links?: { claim_id?: string; exposure_id?: number; level?: string; reason?: string }[] };

  const byId = new Map(exposures.map((item) => [item.id, item]));
  const byClaim = new Map(claims.map((claim) => [claim.id, claim]));
  let linked = 0;
  for (const link of answer.links ?? []) {
    const claim = byClaim.get(link.claim_id ?? "");
    const exposure = byId.get(Number(link.exposure_id));
    if (!claim || !exposure) continue;
    const held = relations.some((item) => item.org_key === exposure.org_key && activeOn(item, claim.published_date));
    if (!held || !exposureActiveOn(exposure, claim.published_date)) continue;
    await sql`
      INSERT INTO claim_exposures (claim_id, exposure_id, level, reason)
      VALUES (${claim.id}, ${exposure.id}, ${link.level === "direct" ? "direct" : "indirect"}, ${(link.reason ?? "").trim()})
      ON CONFLICT DO NOTHING
    `;
    linked += 1;
  }
  return linked;
}

async function resolveOrgs() {
  const listed = (arg("orgs") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const people = (arg("people") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const rows = await sql<{ org_key: string; counterparty: string }[]>`
    SELECT DISTINCT ON (org_key) org_key, counterparty FROM interests
    WHERE publication = 'published' AND org_key IS NOT NULL
      AND (${listed.length ? sql`org_key IN ${sql(listed)}` : sql`kind IN ('role', 'holding') AND person_id IN ${sql(people.length ? people : [""])}`})
    ORDER BY org_key, (counterparty ~ '[A-Za-z]{3}') DESC, length(counterparty)
  `;
  const known = new Map(rows.map((row) => [row.org_key, row.counterparty]));
  return (listed.length ? listed : [...known.keys()]).map((key) => ({ key, name: known.get(key) ?? key }));
}

async function main() {
  await migrate();
  const preflight = await arkPreflight({ search: crawl });
  if (!preflight.ok) {
    console.log(`启动预检没通过，不开始：\n  ${preflight.problems.join("\n  ")}`);
    return;
  }
  if (!crawl) console.log("全量爬取已冻结（美股营收改用 pnpm api:sec）；只给主张挂敞口。确需重新爬取请加 --crawl。");
  if (!linkOnly) {
    const orgs = await resolveOrgs();
    console.log(`外部敞口：${orgs.map((org) => org.name).join("、")} · ${publish ? "通过核对的直接公开（机器核对）" : "结果进审核台"}`);
    for (const org of orgs) {
      console.log(`\n${org.name}（${org.key}）`);
      const result = await collect(org);
      console.log(`  新增敞口 ${result.kept} 条，丢弃 ${result.rejected} 条（依据句对不上或没提到对象）`);
    }
  }
  const people = (arg("people") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  for (const personId of people) console.log(`\n${personId}：主张挂上敞口 ${await linkExposures(personId)} 条`);
  await sql.end();
}

if (import.meta.main) {
  main().catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
}
