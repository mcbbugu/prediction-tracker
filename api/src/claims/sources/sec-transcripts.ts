import { sql } from "../../core/db";
import { textFromHtml } from "../../evidence/sources";
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

function mentioned(person: SourcePerson, text: string) {
  const hay = text.toLowerCase();
  const tokens = [person.name_zh, person.name_en, ...person.name_en.split(/\s+/)].filter((token) => token && token.length >= 4);
  return tokens.some((token) => hay.includes(token.toLowerCase()));
}

export async function findSecTranscripts(person: SourcePerson): Promise<AdapterResult> {
  const interests = await sql<{ org_key: string }[]>`
    SELECT DISTINCT org_key FROM interests
    WHERE person_id = ${person.id} AND org_key IS NOT NULL AND superseded_at IS NULL
  `;
  const keys = [...new Set([...interests.map((row) => row.org_key), ...(OFFICER_ORGS[person.id] ?? [])])];
  const tickers = await tickerMap();
  const docs: AdapterResult["docs"] = [];
  const notes: string[] = [];
  for (const key of keys) {
    const ticker = tickers.get(key);
    if (!ticker || docs.length >= 4) continue;
    try {
      const cik = (await ciks()).get(ticker);
      if (!cik) continue;
      const subs = (await (await secGet(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as {
        filings?: { recent?: { form?: string[]; accessionNumber?: string[] } };
      };
      const forms = subs.filings?.recent?.form ?? [];
      const accessions = subs.filings?.recent?.accessionNumber ?? [];
      const filings = forms.flatMap((form, index) => (form === "8-K" ? [accessions[index]].filter(Boolean) : [])).slice(0, 4);
      for (const accession of filings) {
        if (docs.length >= 4) break;
        const folder = accession.replaceAll("-", "");
        const indexUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${folder}/${accession}-index.json`;
        const index = (await (await secGet(indexUrl)).json()) as { directory?: { item?: { name?: string }[] } };
        const items = index.directory?.item ?? [];
        const exhibit = items.find((item) => /ex-?99|press|exhibit/i.test(item.name ?? "") && /\.html?$/i.test(item.name ?? ""));
        const name = exhibit?.name;
        if (!name) continue;
        const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${folder}/${name}`;
        const response = await secGet(url);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const html = new TextDecoder().decode(bytes);
        const extracted = textFromHtml(html);
        if (!mentioned(person, extracted.text) || extracted.text.length < 400) continue;
        docs.push({ url, title: extracted.title || `${ticker} 8-K ${name}`, text: extracted.text, bytes, contentType: "text/html" });
      }
    } catch (error) {
      notes.push(`${key}：${error instanceof Error ? error.message.slice(0, 80) : error}`);
    }
  }
  return { docs, searches: 0, detail: notes.join("；"), searchLog: [] };
}
