// pnpm api:sec -- [--orgs=tesla,nvidia] [--dry-run]
// 美股机构的营收数据直接取自 SEC：最新一份 10-K 的 XBRL（带单位、带维度），不再爬网页（SPEC 利益关系的三层数据）。
//   - 机构年营收 → org_financials（推算「归他名下的营收」要用）；
//   - 按地区拆分的营收 → org_exposures（dimension = region，basis = 'sec_xbrl'，占比 = 地区营收 ÷ 总营收）。
// XBRL 原文件整份存档进 sources（原始字节 + 哈希）；每条数据的「原句」是从中读出的那一条事实，逐行写在存档正文里。
// SEC 要求请求头声明联系方式：api/.env 里的 SEC_USER_AGENT（「名称 邮箱」）。全站限速每秒 10 次，这里远低于此。
import { sql } from "./db";
import { migrate } from "./migrate";
import { archiveDocument } from "./sources";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const dryRun = process.argv.includes("--dry-run");
const UA = process.env.SEC_USER_AGENT ?? "";

// org_key → ticker, maintained by hand. Matching by company name picked wrong securities (an ETF for "spacex"),
// so an organisation is imported only once someone has written its ticker here.
const TICKERS: Record<string, string> = {
  reddit: "RDDT",
  coursera: "COUR",
  oklo: "OKLO",
  starbucks: "SBUX",
  tesla: "TSLA",
  nvidia: "NVDA",
  microsoft: "MSFT",
  alphabet: "GOOGL",
  google: "GOOGL",
  meta: "META",
  amd: "AMD",
  amazon: "AMZN",
  apple: "AAPL",
  intel: "INTC",
  oracle: "ORCL",
  salesforce: "CRM",
  ibm: "IBM",
  "applied-materials": "AMAT",
  airbnb: "ABNB",
  coreweave: "CRWV",
  instacart: "CART",
  "jpmorgan-chase": "JPM",
  netflix: "NFLX",
  palantir: "PLTR",
  qualcomm: "QCOM",
  broadcom: "AVGO",
  cisco: "CSCO",
  uber: "UBER",
  adobe: "ADBE",
};

// Total revenue concepts, most specific first.
const REVENUE = [
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:Revenues",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "us-gaap:SalesRevenueNet",
];
const GEO_AXIS = /StatementGeographicalAxis$/;

const COUNTRY: Record<string, [string, string]> = {
  US: ["United States", "美国"],
  CN: ["China", "中国"],
  JP: ["Japan", "日本"],
  TW: ["Taiwan", "台湾"],
  KR: ["South Korea", "韩国"],
  SG: ["Singapore", "新加坡"],
  DE: ["Germany", "德国"],
  GB: ["United Kingdom", "英国"],
  IE: ["Ireland", "爱尔兰"],
  IN: ["India", "印度"],
  CA: ["Canada", "加拿大"],
  NL: ["Netherlands", "荷兰"],
  HK: ["Hong Kong", "香港"],
  FR: ["France", "法国"],
  CH: ["Switzerland", "瑞士"],
  MX: ["Mexico", "墨西哥"],
  AU: ["Australia", "澳大利亚"],
  IL: ["Israel", "以色列"],
  BR: ["Brazil", "巴西"],
  MY: ["Malaysia", "马来西亚"],
};
const REGION: Record<string, string> = {
  Europe: "欧洲",
  "Asia Pacific": "亚太",
  Asia: "亚洲",
  Americas: "美洲",
  "North America": "北美",
  "Latin America": "拉丁美洲",
  "Europe Middle East And Africa": "欧洲、中东和非洲",
  "Non Us": "美国以外",
  "Greater China": "大中华区",
  "Rest Of World": "其他地区",
  EMEA: "欧洲、中东和非洲",
  "Americas Excluding United States": "美洲（不含美国）",
  "China Including Hong Kong": "中国（含香港）",
  "US Canada": "美国和加拿大",
  "United States And Canada": "美国和加拿大",
  "Southeast Asia": "东南亚",
};

// Companies often report two splits at once (regions and US / non-US, or a subtotal such as "Total International"),
// so the members overlap. Keep the finest set of members that adds up to the total (within 0.5%).
function partition<T extends { value: number }>(items: T[], total: number): T[] {
  if (items.length > 14) return [];
  let best: T[] = [];
  for (let mask = 1; mask < 1 << items.length; mask += 1) {
    const subset = items.filter((_, i) => mask & (1 << i));
    const sum = subset.reduce((acc, item) => acc + item.value, 0);
    if (Math.abs(sum - total) <= total * 0.005 && subset.length > best.length) best = subset;
  }
  return best;
}

type Fact = { concept: string; context: string; value: number };
type Context = { start: string | null; end: string | null; dims: [string, string][] };

class SecError extends Error {}

async function get(url: string) {
  await Bun.sleep(150);
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new SecError(`${url} → HTTP ${response.status}`);
  return response;
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

function parseInstance(xml: string) {
  const contexts = new Map<string, Context>();
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = m[2];
    contexts.set(m[1], {
      start: body.match(/<(?:xbrli:)?startDate>\s*([^<\s]+)/)?.[1] ?? null,
      end: body.match(/<(?:xbrli:)?endDate>\s*([^<\s]+)/)?.[1] ?? null,
      dims: [...body.matchAll(/<(?:xbrldi:)?explicitMember\b[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((d) => [d[1], d[2]]),
    });
  }
  const facts: Fact[] = [];
  for (const concept of REVENUE) {
    const tag = concept.replace(":", "\\:");
    for (const m of xml.matchAll(new RegExp(`<${tag}\\b[^>]*contextRef="([^"]+)"[^>]*>\\s*([-0-9.]+)\\s*<`, "g"))) {
      facts.push({ concept, context: m[1], value: Number(m[2]) });
    }
  }
  return { contexts, facts };
}

// "tsla:OtherCountriesMember" → "Other Countries"; "country:CN" → China.
function memberLabel(member: string, rest = false) {
  const code = member.match(/^country:([A-Z]{2})$/)?.[1];
  if (code) return { en: COUNTRY[code]?.[0] ?? code, zh: COUNTRY[code]?.[1] ?? code, country: code };
  const en = member
    .replace(/^[^:]+:/, "")
    .replace(/Member$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  if (rest && /^Non Us$/.test(en)) return { en: "Other countries", zh: "其他国家", country: null };
  const zh = REGION[en] ?? (/^Other\b|Rest Of/i.test(en) ? "其他地区" : en);
  return { en, zh, country: null };
}

async function latestTenK(cik: string) {
  const subs = (await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as {
    filings: { recent: { form: string[]; accessionNumber: string[]; reportDate: string[]; filingDate: string[] } };
  };
  const recent = subs.filings.recent;
  const index = recent.form.findIndex((form) => form === "10-K");
  if (index < 0) return null;
  return { accession: recent.accessionNumber[index], reportDate: recent.reportDate[index], filed: recent.filingDate[index] };
}

async function instanceUrl(cik: string, accession: string) {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
  const index = (await (await get(`${base}/index.json`)).json()) as { directory: { item: { name: string }[] } };
  const names = index.directory.item.map((item) => item.name);
  const name =
    names.find((n) => n.endsWith("_htm.xml")) ??
    names.find((n) => n.endsWith(".xml") && !/_(cal|def|lab|pre)\.xml$|FilingSummary|MetaLinks/i.test(n));
  return name ? `${base}/${name}` : null;
}

async function importOrg(orgKeyValue: string, ticker: string, cik: string) {
  const filing = await latestTenK(cik);
  if (!filing) return `${ticker}：没有 10-K（可能是外国公司，交 20-F）`;
  const url = await instanceUrl(cik, filing.accession);
  if (!url) return `${ticker}：申报里找不到 XBRL 数据文件`;
  const bytes = new Uint8Array(await (await get(url)).arrayBuffer());
  const { contexts, facts } = parseInstance(new TextDecoder().decode(bytes));

  // The fiscal year: a ~one-year period with no dimensions, ending on the report date.
  const annual = facts.filter((fact) => {
    const ctx = contexts.get(fact.context);
    return ctx && ctx.start && ctx.end && ctx.dims.length === 0 && Math.abs(days(ctx.start, ctx.end) - 365) < 20 && ctx.end === filing.reportDate;
  });
  const totalFact = REVENUE.map((concept) => annual.find((fact) => fact.concept === concept)).find(Boolean);
  if (!totalFact) return `${ticker}：10-K 里找不到年度总营收`;
  const period = contexts.get(totalFact.context)!;
  const fiscalYear = Number(period.end!.slice(0, 4));

  // Revenue split by the geographic axis only, same period; prefer the concept the total uses.
  const geo = new Map<string, Fact>();
  for (const concept of [totalFact.concept, ...REVENUE.filter((c) => c !== totalFact.concept)]) {
    for (const fact of facts) {
      const ctx = contexts.get(fact.context);
      if (fact.concept !== concept || !ctx || ctx.start !== period.start || ctx.end !== period.end) continue;
      if (ctx.dims.length !== 1 || !GEO_AXIS.test(ctx.dims[0][0])) continue;
      if (!geo.has(ctx.dims[0][1])) geo.set(ctx.dims[0][1], fact);
    }
    if (geo.size) break;
  }

  const line = (fact: Fact) => {
    const ctx = contexts.get(fact.context)!;
    const dim = ctx.dims.length ? ` [${ctx.dims.map(([d, m]) => `${d}=${m}`).join(", ")}]` : "";
    return `${fact.concept} ${ctx.start}..${ctx.end}${dim} = ${fact.value} USD`;
  };
  const text = [`${ticker} 10-K FY${fiscalYear} (accession ${filing.accession}, filed ${filing.filed})`, line(totalFact), ...[...geo.values()].map(line)].join("\n");
  const parts = partition([...geo.entries()].map(([member, fact]) => ({ member, fact, value: fact.value })), totalFact.value);
  // "Non-US" next to individual countries means "the rest", not "everything outside the US".
  const hasOtherCountries = parts.some((p) => /^country:(?!US)/.test(p.member));
  const shares = parts.map(({ member, fact }) => ({ member, fact, share: Math.round((fact.value / totalFact.value) * 10_000) / 100, rest: hasOtherCountries }));
  const summary = `${ticker} FY${fiscalYear} 营收 $${(totalFact.value / 1e9).toFixed(1)}B · ${shares.map((s) => `${memberLabel(s.member, s.rest).zh} ${s.share}%`).join("、") || (geo.size ? "地区数据互相重叠、凑不出总数，跳过" : "没有按地区拆分")}`;
  if (dryRun) return `${summary}（试运行，不写库）`;

  const source = await archiveDocument({ url, bytes, contentType: "application/xml", status: 200, title: `${ticker} 10-K FY${fiscalYear} XBRL`, text });
  await sql`
    INSERT INTO org_financials (org_key, fiscal_year, period_start, period_end, revenue_usd, concept, form, accession, source_url, source_id)
    VALUES (${orgKeyValue}, ${fiscalYear}, ${period.start}, ${period.end}, ${totalFact.value}, ${totalFact.concept}, '10-K',
            ${filing.accession}, ${url}, ${source.id})
    ON CONFLICT (org_key, period_end, form) DO NOTHING
  `;
  let added = 0;
  for (const { member, fact, share, rest } of shares) {
    const label = memberLabel(member, rest);
    const [exists] = await sql`
      SELECT 1 FROM org_exposures
      WHERE org_key = ${orgKeyValue} AND dimension = 'region' AND basis = 'sec_xbrl' AND target = ${label.en} AND metric_year = ${fiscalYear}
    `;
    if (exists) continue;
    await sql`
      INSERT INTO org_exposures (org_key, dimension, target, target_zh, country, metric_kind, metric_value, metric_year,
                                 source_url, source_id, quote, publication, provenance, basis)
      VALUES (${orgKeyValue}, 'region', ${label.en}, ${label.zh}, ${label.country}, 'revenue_share', ${share}, ${fiscalYear},
              ${url}, ${source.id}, ${`${line(fact)}; total ${line(totalFact)}`}, 'published', 'sec', 'sec_xbrl')
    `;
    added += 1;
  }
  return `${summary} · 新增地区 ${added} 条`;
}

async function main() {
  await migrate();
  if (!/\S+@\S+/.test(UA)) {
    console.log("请在 api/.env 设置 SEC_USER_AGENT=\"名称 联系邮箱\"（SEC 要求声明联系方式）");
    return;
  }
  const tickers = (await (await get("https://www.sec.gov/files/company_tickers.json")).json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const byTicker = new Map(Object.values(tickers).map((t) => [t.ticker, t]));

  const wanted = (arg("orgs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const keys = wanted.length
    ? wanted
    : (await sql<{ org_key: string }[]>`SELECT DISTINCT org_key FROM interests WHERE publication = 'published' AND org_key IS NOT NULL`).map((r) => r.org_key);
  const targets = keys
    .map((key) => ({ key, company: TICKERS[key] ? byTicker.get(TICKERS[key]) : undefined }))
    .filter((t): t is { key: string; company: { cik_str: number; ticker: string; title: string } } => Boolean(t.company));
  console.log(`美股机构 ${targets.length} 家：${targets.map((t) => `${t.key}=${t.company.ticker}`).join("、")}${dryRun ? " · 试运行" : ""}`);
  for (const target of targets) {
    try {
      console.log(await importOrg(target.key, target.company.ticker, String(target.company.cik_str)));
    } catch (error) {
      console.log(`${target.company.ticker}：失败 · ${error instanceof Error ? error.message.slice(0, 160) : error}`);
    }
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
