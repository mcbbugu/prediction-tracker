import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../../core/db";
import { archiveDocument } from "../../evidence/sources";
import { insufficient, type Resolution } from "./compare";
import { parseStooqCsv, resolvePriceBars } from "./price";
import { resolveSecFiling, type Filing } from "./sec-xbrl";

export type LiveProposition = {
  resolver: string;
  comparator: string | null;
  threshold: number | null;
  deadline: string | null;
  resolver_args: { org_key?: string; field?: string; symbol?: string };
};

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function tickerMap() {
  const source = await Bun.file(new URL("../../interests/sec.ts", import.meta.url)).text();
  const block = source.match(/const TICKERS: Record<string, string> = \{([\s\S]*?)\n\};/);
  const pairs = [...(block?.[1] ?? "").matchAll(/^\s*"?([A-Za-z0-9-]+)"?:\s*"([A-Z.]+)"/gm)].map(([, key, ticker]) => [key, ticker] as const);
  return new Map(pairs);
}

async function filingsFor(orgKey: string): Promise<Filing[]> {
  const rows = await sql<{ period_end: string; revenue_usd: number; source_id: number | null; source_url: string; fiscal_year: number; form: string }[]>`
    SELECT to_char(period_end, 'YYYY-MM-DD') AS period_end, revenue_usd::float8 AS revenue_usd,
           source_id::int AS source_id, source_url, fiscal_year, form
    FROM org_financials
    WHERE org_key = ${orgKey}
    ORDER BY period_end DESC
  `;
  const annual = rows.filter((row) => row.form === "10-K");
  return (annual.length ? annual : rows).map((row) => ({
    period_end: row.period_end,
    revenue_usd: Number(row.revenue_usd),
    source_id: row.source_id,
    source_url: row.source_url,
    fiscal_year: row.fiscal_year,
  }));
}

function importFilings(orgKey: string) {
  const child = spawn("bun", ["--env-file=.env", "run", "src/interests/sec.ts", `--orgs=${orgKey}`, "--years=1"], {
    cwd: apiRoot,
    stdio: "ignore",
  });
  return new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

async function resolveSec(proposition: LiveProposition, fetchMissing: boolean): Promise<Resolution> {
  const orgKey = (proposition.resolver_args.org_key ?? "").trim();
  const field = proposition.resolver_args.field || "revenue_usd";
  if (!orgKey) return insufficient("命题没有机构");
  let filings = await filingsFor(orgKey);
  if (!filings.length && fetchMissing && (await tickerMap()).has(orgKey)) {
    await importFilings(orgKey);
    filings = await filingsFor(orgKey);
  }
  return resolveSecFiling(
    { comparator: proposition.comparator, threshold: proposition.threshold, deadline: proposition.deadline, field },
    filings,
  );
}

async function resolvePrice(proposition: LiveProposition, fetchMissing: boolean): Promise<Resolution> {
  const symbol = (proposition.resolver_args.symbol ?? "").trim().toLowerCase();
  const field = proposition.resolver_args.field || "close";
  if (!symbol) return insufficient("命题没有证券代码");
  if (!fetchMissing) return insufficient("没有离线日线");
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    return insufficient(`股价源打不开：${error instanceof Error ? error.message.slice(0, 120) : error}`);
  }
  if (!response.ok) return insufficient(`股价源 HTTP ${response.status}`);
  const text = await response.text();
  const saved = await archiveDocument({
    url,
    finalUrl: response.url || url,
    bytes: new TextEncoder().encode(text),
    contentType: response.headers.get("content-type") || "text/csv",
    status: response.status,
    title: `${symbol} 日线`,
    text,
  });
  const resolution = resolvePriceBars(
    { comparator: proposition.comparator, threshold: proposition.threshold, deadline: proposition.deadline, field },
    parseStooqCsv(text),
  );
  resolution.evidence_ids = [saved.id];
  resolution.evidence_url = saved.final_url || url;
  return resolution;
}

// Deterministic resolvers only. model falls through to the existing verdict path.
export async function resolveProposition(proposition: LiveProposition, options: { fetch?: boolean } = {}): Promise<Resolution | null> {
  const fetchMissing = options.fetch !== false;
  if (proposition.resolver === "sec_xbrl") return resolveSec(proposition, fetchMissing);
  if (proposition.resolver === "price") return resolvePrice(proposition, fetchMissing);
  return null;
}

export async function stooqSymbol(orgKey: string) {
  const ticker = (await tickerMap()).get(orgKey);
  return ticker ? `${ticker.toLowerCase()}.us` : null;
}
