import { sql } from "../../core/db";
import { textFromHtml } from "../../evidence/sources";
import { mentions } from "./chunk";
import type { AdapterResult, SourcePerson } from "./types";

const OFFICER_ORGS: Record<string, string[]> = {
  "marc-benioff": ["salesforce"],
  "kevin-scott": ["microsoft"],
};

async function tickerMap() {
  const source = await Bun.file(new URL("../../interests/sec.ts", import.meta.url)).text();
  const block = source.match(/const TICKERS: Record<string, string> = \{([\s\S]*?)\n\};/);
  const pairs = [...(block?.[1] ?? "").matchAll(/^\s*"?([A-Za-z0-9-]+)"?:\s*"([A-Z.]+)"/gm)].map(([, key, ticker]) => [key, ticker] as const);
  return new Map(pairs);
}

let cikByTicker: Map<string, string> | null = null;

async function ciks() {
  if (cikByTicker) return cikByTicker;
  const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`SEC 公司表 HTTP ${response.status}`);
  const body = (await response.json()) as Record<string, { cik_str: number; ticker: string }>;
  cikByTicker = new Map(Object.values(body).map((row) => [row.ticker, String(row.cik_str)]));
  return cikByTicker;
}

async function secGet(url: string) {
  await Bun.sleep(200);
  const response = await fetch(url, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "", Accept: "*/*" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response;
}

// 8-K items that carry press releases with executives' own words: results (2.02), Reg FD (7.01), other events (8.01).
const RELEASE_ITEMS = /\b(2\.02|7\.01|8\.01)\b/;
const SCAN = 12;

type Recent = { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; items?: string[] };

// 8-Ks of this company filed while the person held a role there, newest first.
export function pickFilings(recent: Recent, tenure: { started: string | null; ended: string | null }[], scan = SCAN) {
  const forms = recent.form ?? [];
  const within = (date: string) =>
    tenure.some((span) => (!span.started || span.started.slice(0, 10) <= date) && (!span.ended || span.ended === "present" || date.slice(0, span.ended.length) <= span.ended));
  return forms
    .map((form, index) => ({ form, accession: recent.accessionNumber?.[index] ?? "", date: recent.filingDate?.[index] ?? "", items: recent.items?.[index] ?? "" }))
    .filter((row) => row.form === "8-K" && row.accession && RELEASE_ITEMS.test(row.items) && within(row.date))
    .slice(0, scan);
}

// The press release is an exhibit (EX-99.x), not the 8-K cover document.
export function pickExhibit(names: string[]) {
  const html = names.filter((name) => /\.html?$/i.test(name));
  return (
    html.find((name) => /ex(?:hibit)?[-_]?99/i.test(name)) ??
    html.find((name) => /press|pr\.htm/i.test(name)) ??
    // Some filers name the release freely (NVIDIA: q3fy26pr.htm); anything but the cover, index and XBRL viewer pages.
    html.find((name) => !/8-?k|index|^R\d+\.htm/i.test(name)) ??
    null
  );
}

export async function findSecTranscripts(person: SourcePerson): Promise<AdapterResult> {
  const roles = await sql<{ org_key: string; started: string | null; ended: string | null }[]>`
    SELECT org_key, started, ended FROM interests
    WHERE person_id = ${person.id} AND kind = 'role' AND org_key IS NOT NULL AND superseded_at IS NULL
  `;
  const tenure = new Map<string, { started: string | null; ended: string | null }[]>();
  for (const row of roles) tenure.set(row.org_key, [...(tenure.get(row.org_key) ?? []), row]);
  // Hand-listed officers without a recorded role are taken as current.
  for (const key of OFFICER_ORGS[person.id] ?? []) if (!tenure.has(key)) tenure.set(key, [{ started: null, ended: null }]);
  const tickers = await tickerMap();
  const docs: AdapterResult["docs"] = [];
  const notes: string[] = [];
  let scanned = 0;
  let unnamed = 0;
  for (const [key, spans] of tenure) {
    const ticker = tickers.get(key);
    if (!ticker || docs.length >= 4) continue;
    try {
      const cik = (await ciks()).get(ticker);
      if (!cik) continue;
      const subs = (await (await secGet(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as { filings?: { recent?: Recent } };
      for (const filing of pickFilings(subs.filings?.recent ?? {}, spans)) {
        if (docs.length >= 4) break;
        scanned += 1;
        const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replaceAll("-", "")}`;
        const index = (await (await secGet(`${folder}/index.json`)).json()) as { directory?: { item?: { name?: string }[] } };
        const name = pickExhibit((index.directory?.item ?? []).map((item) => item.name ?? ""));
        if (!name) continue;
        const url = `${folder}/${name}`;
        const response = await secGet(url);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const extracted = textFromHtml(new TextDecoder().decode(bytes));
        if (extracted.text.length < 400) continue;
        if (!mentions(person, extracted.text)) {
          unnamed += 1;
          continue;
        }
        docs.push({ url, finalUrl: response.url || url, status: response.status, title: extracted.title || `${ticker} 8-K ${filing.date}`, text: extracted.text, bytes, contentType: "text/html" });
      }
    } catch (error) {
      notes.push(`${key}：${error instanceof Error ? error.message.slice(0, 120) : error}`);
    }
  }
  if (!tenure.size) notes.push("没有登记任职");
  if (scanned) notes.push(`看了 ${scanned} 份新闻稿类 8-K，${unnamed} 份没有提到本人`);
  return { docs, searches: 0, detail: notes.join("；"), searchLog: [] };
}
