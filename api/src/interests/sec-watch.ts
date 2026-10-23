// cd api && bun run src/interests/sec-watch.ts [--orgs=tesla,nvidia] [--apply] [--dry-run] [--years=1]
// 盯着 SEC 的申报流水，只在公司交了新的 10-K / 10-Q 时才去导营收（SPEC 利益关系的三层数据）。
// sec.ts 只能手动全量跑；这里先比对，再把「有新申报」的机构交给它，于是导入变成事件驱动的增量。
//
// - 对照表 TICKERS 在 sec.ts 里，既没导出、这个文件又不能改它，所以直接从源码里读那张表，免得两边各写一份、慢慢对不上。
// - 每家公司取 submissions 里申报日最新的 10-K（没有 10-K 的公司取最新 10-Q，和 sec.ts 的取舍一致），
//   拿它的 accession 和 org_financials 里这家机构已有的 accession 比；库里没有这一份就是「待导入」。
// - 默认只打印清单，不碰库。--apply 才起子进程跑 `bun run src/interests/sec.ts --orgs=...`，跑完回查 accession 有没有真的进库。
//   --apply --dry-run 会把 --dry-run 透传给 sec.ts：照样抓 XBRL、算出数字，但不写库，可以先看一眼要写什么。
// - 默认只补最新那一份（--years=1）；想顺手回填历史年份就自己传 --years=12。
// SEC 要求请求头声明联系方式：api/.env 里的 SEC_USER_AGENT。全站限速每秒 10 次，这里每次请求之间停 300ms，远低于此。
import { sql } from "../core/db";
import { migrate } from "../core/migrate";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run");
const years = arg("years") ?? "1";
const UA = process.env.SEC_USER_AGENT ?? "";
const GAP_MS = 300;
const API_ROOT = new URL("../../", import.meta.url);

async function get(url: string) {
  await Bun.sleep(GAP_MS);
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response;
}

// sec.ts 是个脚本，import 它就会直接开跑，所以按源码文本读 TICKERS 这张手工对照表。
async function readTickers() {
  const source = await Bun.file(new URL("./sec.ts", import.meta.url)).text();
  const block = source.match(/const TICKERS: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("没在 sec.ts 里找到 TICKERS 对照表（是不是改名了？）");
  const pairs = [...block[1].matchAll(/^\s*"?([A-Za-z0-9-]+)"?:\s*"([A-Z.]+)"/gm)].map(([, key, ticker]) => [key, ticker] as const);
  if (!pairs.length) throw new Error("sec.ts 的 TICKERS 读出来是空的");
  return new Map(pairs);
}

type Filing = { accession: string; form: "10-K" | "10-Q"; reportDate: string; filed: string };

type FilingBlock = {
  form?: string[];
  accessionNumber?: string[];
  reportDate?: string[];
  filingDate?: string[];
  isXBRL?: Array<number | string | null>;
};

// 只看 filings.recent（近千条）：要的只是最新一份，不用翻历史分页。没有 XBRL 的申报 sec.ts 导不了，跳过。
function latestOf(block: FilingBlock, form: "10-K" | "10-Q"): Filing | undefined {
  const forms = block.form ?? [];
  const rows: Filing[] = [];
  for (let i = 0; i < forms.length; i += 1) {
    const accession = block.accessionNumber?.[i] ?? "";
    const flag = block.isXBRL?.[i];
    if (forms[i] !== form || !accession || (flag != null && flag !== "" && Number(flag) === 0)) continue;
    rows.push({ accession, form, reportDate: block.reportDate?.[i] ?? "", filed: block.filingDate?.[i] ?? "" });
  }
  rows.sort((a, b) => (b.reportDate || b.filed).localeCompare(a.reportDate || a.filed) || b.filed.localeCompare(a.filed));
  return rows[0];
}

// 和 sec.ts 一样：有 10-K 的公司只认 10-K，后来的 10-Q 不顶替；还没有 10-K 的新上市公司才用最新的 10-Q。
async function latestFiling(cik: string) {
  const subs = (await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as {
    filings: { recent: FilingBlock };
  };
  return latestOf(subs.filings.recent, "10-K") ?? latestOf(subs.filings.recent, "10-Q");
}

type Row = { form: string; fiscal_year: number; period_end: Date; accession: string };

const day = (value: Date) => value.toISOString().slice(0, 10);
const describe = (row: Row) => `${row.form} FY${row.fiscal_year}（截至 ${day(row.period_end)}）${row.accession}`;

const latestInDb = async (orgKey: string) =>
  (
    await sql<Row[]>`
      SELECT form, fiscal_year, period_end, accession FROM org_financials
      WHERE org_key = ${orgKey}
      ORDER BY period_end DESC, id DESC
      LIMIT 1
    `
  )[0];

const inDb = async (orgKey: string, accession: string) =>
  (
    await sql<Row[]>`
      SELECT form, fiscal_year, period_end, accession FROM org_financials
      WHERE org_key = ${orgKey} AND accession = ${accession}
      LIMIT 1
    `
  )[0];

type Target = { key: string; ticker: string; cik: string };
type Pending = Target & { filing: Filing };

async function review(targets: Target[]) {
  const seen = new Map<string, Filing | undefined>();
  const pending: Pending[] = [];
  let current = 0;
  for (const target of targets) {
    const name = `${target.ticker} ${target.key}`;
    let filing: Filing | undefined;
    try {
      // alphabet 和 google 是同一个 CIK，submissions 只取一次。
      if (seen.has(target.cik)) filing = seen.get(target.cik);
      else seen.set(target.cik, (filing = await latestFiling(target.cik)));
    } catch (error) {
      console.log(`${name}：查不到申报 · ${error instanceof Error ? error.message.slice(0, 160) : error}`);
      continue;
    }
    const mine = await latestInDb(target.key);
    const here = mine ? describe(mine) : "没有记录";
    if (!filing) {
      console.log(`${name}：库里 ${here} → SEC 没有带 XBRL 的 10-K 或 10-Q → 跳过`);
      continue;
    }
    const there = `${filing.form} 报告期 ${filing.reportDate || "—"}（申报于 ${filing.filed}）${filing.accession}`;
    const have = await inDb(target.key, filing.accession);
    if (have) current += 1;
    else pending.push({ ...target, filing });
    console.log(`${name}：库里 ${here} → SEC ${there} → ${have ? "不用更新" : mine ? "需要更新" : "需要首次导入"}`);
  }
  return { pending, current };
}

// 交给 sec.ts 去导：它自己会跳过已有的 (org_key, period_end, form)，所以一次把待导入的机构都传进去就行。
async function runImport(keys: string[]) {
  const args = ["run", "src/interests/sec.ts", `--orgs=${keys.join(",")}`, `--years=${years}`, ...(dryRun ? ["--dry-run"] : [])];
  console.log(`\n执行 bun ${args.join(" ")}`);
  const child = Bun.spawn(["bun", ...args], { cwd: API_ROOT.pathname, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) console.log(`sec.ts 退出码 ${code}`);
  return code;
}

async function main() {
  await migrate();
  if (!/\S+@\S+/.test(UA)) {
    console.log('请在 api/.env 设置 SEC_USER_AGENT="名称 联系邮箱"（SEC 要求声明联系方式）');
    return;
  }
  const tickers = await readTickers();
  const wanted = (arg("orgs") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const key of wanted) if (!tickers.has(key)) console.log(`${key} 不在 sec.ts 的 TICKERS 里，跳过`);
  const keys = (wanted.length ? wanted.filter((key) => tickers.has(key)) : [...tickers.keys()]).sort();

  const all = (await (await get("https://www.sec.gov/files/company_tickers.json")).json()) as Record<string, { cik_str: number; ticker: string }>;
  const byTicker = new Map(Object.values(all).map((item) => [item.ticker, item]));
  const targets: Target[] = [];
  for (const key of keys) {
    const ticker = tickers.get(key)!;
    const company = byTicker.get(ticker);
    if (!company) {
      console.log(`${ticker} ${key}：SEC 的代码表里没有这个代码，跳过`);
      continue;
    }
    targets.push({ key, ticker, cik: String(company.cik_str) });
  }
  console.log(`盯 ${targets.length} 家公司的最新申报${apply ? `（--apply${dryRun ? " --dry-run" : ""} · --years=${years}）` : "（只看不导）"}\n`);

  const { pending, current } = await review(targets);
  console.log(`\n共 ${targets.length} 家 · 已是最新 ${current} 家 · 待导入 ${pending.length} 家${pending.length ? `：${pending.map((item) => item.key).join("、")}` : ""}`);
  if (!pending.length) return;
  if (!apply) {
    console.log("加 --apply 才会真的导入（--apply --dry-run 可以先空跑一遍）");
    return;
  }

  await runImport(pending.map((item) => item.key));
  if (dryRun) {
    console.log("\n试运行，没写库，不核对 accession");
    return;
  }
  console.log("");
  let landed = 0;
  for (const item of pending) {
    const row = await inDb(item.key, item.filing.accession);
    if (row) landed += 1;
    console.log(`核对 ${item.ticker} ${item.key} ${item.filing.form} ${item.filing.accession} → ${row ? `已入库（FY${row.fiscal_year}，截至 ${day(row.period_end)}）` : "仍没进库"}`);
  }
  console.log(`\n完成 · ${landed}/${pending.length} 家出现了新的 accession`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
