// bun --env-file=.env run src/evidence/refetch.ts -- [--apply] [--limit=10] [--garbled]
// 重抓最新一份存档质量差的网址：正文以 %PDF 开头、大量 U+FFFD、HTTP 状态 >= 400，或正文少于 400 字。
// 排除 sec.gov 的 XBRL 文件（那是申报数据，不是抓坏的网页）。
// 默认试运行，只打印；--apply 才对每个网址调用 snapshot(url)，追加一条新存档，不改旧行。
// 网址之间间隔 1 秒。重抓后用 quoteOnPage 复核 source_url 相同的主张
// （原话取 quote_original，为空则用 quote_en），只报告「原来对不上、现在对得上」和「仍对不上」，不改 claims。
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { hostOf, quoteOnPage, snapshot, type Snapshot } from "./sources";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const apply = process.argv.includes("--apply");
const garbledOnly = process.argv.includes("--garbled");
const limitArg = arg("limit");
const limit = limitArg && Number.isFinite(Number(limitArg)) && Number(limitArg) > 0 ? Math.floor(Number(limitArg)) : null;
const GAP_MS = 1_000;

type Latest = {
  id: number;
  url: string;
  http_status: number;
  title: string;
  content_type: string | null;
  len: number;
  pdf: boolean;
  garbled: boolean;
  fetched_at: Date;
};

type Claim = {
  id: string;
  source_url: string;
  quote_original: string;
  quote_en: string;
};

type Report = { id: string; url: string; quote: string; note: string };

function quoteOf(claim: Claim) {
  return claim.quote_original.trim() || claim.quote_en.trim();
}

function isSecXbrl(row: Latest) {
  const host = hostOf(row.url);
  if (host !== "sec.gov" && !host.endsWith(".sec.gov")) return false;
  if (/xbrl/i.test(row.title)) return true;
  if (/\.xml(?:$|\?)/i.test(row.url)) return true;
  const type = row.content_type ?? "";
  return /xml/i.test(type) && !/html/i.test(type);
}

function badCopy(row: Pick<Latest, "pdf" | "garbled" | "http_status" | "len">) {
  return row.pdf || row.garbled || row.http_status >= 400 || row.len < 400;
}

function reasons(row: Latest) {
  const parts: string[] = [];
  if (row.pdf) parts.push("正文以 %PDF 开头");
  if (row.garbled) parts.push("大量不可读字符");
  if (row.http_status >= 400) parts.push(`HTTP ${row.http_status}`);
  if (row.len < 400) parts.push(`正文 ${row.len} 字`);
  return parts.join(" · ");
}

function replacementCount(text: string) {
  let count = 0;
  const sample = text.slice(0, 4000);
  for (const char of sample) if (char === "\uFFFD") count += 1;
  return count;
}

function outcome(saved: Snapshot | null) {
  if (!saved) return "重抓失败";
  if (saved.text.startsWith("%PDF")) return "仍是 %PDF";
  if (replacementCount(saved.text) > 40) return "仍是乱码";
  if (saved.http_status >= 400) return `HTTP ${saved.http_status}`;
  if (saved.text.length < 400) return "正文仍短";
  return "已改善";
}

function snippet(quote: string) {
  return quote.replace(/\s+/g, " ").slice(0, 80);
}

async function main() {
  await migrate();
  const latest = await sql<Latest[]>`
    SELECT DISTINCT ON (url)
      id, url, http_status, title, content_type,
      char_length(text)::int AS len,
      starts_with(text, '%PDF') AS pdf,
      (char_length(left(text, 4000)) - char_length(replace(left(text, 4000), chr(65533), ''))) > 40 AS garbled,
      fetched_at
    FROM sources
    ORDER BY url, fetched_at DESC, id DESC
  `;
  const rows = latest.map((row) => ({
    ...row,
    id: Number(row.id),
    http_status: Number(row.http_status),
    len: Number(row.len),
    pdf: Boolean(row.pdf),
    garbled: Boolean(row.garbled),
    fetched_at: new Date(row.fetched_at),
  }));
  const skipped = rows.filter((row) => badCopy(row) && isSecXbrl(row));
  const bad = rows.filter((row) => badCopy(row) && !isSecXbrl(row) && (!garbledOnly || row.garbled));

  const claims = bad.length
    ? await sql<Claim[]>`
        SELECT id, source_url, quote_original, quote_en
        FROM claims
        WHERE source_url IN ${sql(bad.map((row) => row.url))}
        ORDER BY id
      `
    : [];
  const byUrl = new Map<string, Claim[]>();
  for (const claim of claims) {
    const list = byUrl.get(claim.source_url) ?? [];
    list.push(claim);
    byUrl.set(claim.source_url, list);
  }

  bad.sort((a, b) => {
    const claimRank = (row: Latest) => (byUrl.has(row.url) ? 0 : 1);
    const kindRank = (row: Latest) => (row.pdf ? 0 : row.http_status >= 400 ? 1 : 2);
    return claimRank(a) - claimRank(b) || kindRank(a) - kindRank(b) || a.fetched_at.getTime() - b.fetched_at.getTime() || a.id - b.id;
  });
  const batch = limit ? bad.slice(0, limit) : bad;

  const pdfN = bad.filter((row) => row.pdf).length;
  const garbledN = bad.filter((row) => row.garbled).length;
  const httpN = bad.filter((row) => row.http_status >= 400).length;
  const shortN = bad.filter((row) => row.len < 400).length;
  console.log(
    `符合条件 ${bad.length} 个网址（排除 sec.gov XBRL ${skipped.length} 个）· 本次 ${batch.length} 个 · ${apply ? "重抓" : "试运行（加 --apply 才重抓）"}`,
  );
  console.log(`其中正文以 %PDF 开头 ${pdfN} · 大量不可读字符 ${garbledN} · HTTP ≥ 400 ${httpN} · 正文少于 400 字 ${shortN} · 关联主张 ${claims.length} 条（${byUrl.size} 个网址）`);

  if (!apply) {
    for (const [index, row] of batch.entries()) {
      console.log(`${index + 1}. ${reasons(row)} · 主张 ${byUrl.get(row.url)?.length ?? 0} · 旧 sources#${row.id} · ${row.url}`);
    }
    const watched = batch.filter((row) => byUrl.has(row.url));
    if (!watched.length) {
      console.log("这批网址没有关联主张。试运行不重抓。");
      return;
    }
    const texts = await sql<{ id: number; text: string }[]>`SELECT id, text FROM sources WHERE id IN ${sql(watched.map((row) => row.id))}`;
    const oldText = new Map(texts.map((row) => [Number(row.id), row.text]));
    const missed = watched.flatMap((row) =>
      (byUrl.get(row.url) ?? []).flatMap((claim) => {
        const quote = quoteOf(claim);
        return quoteOnPage(quote, oldText.get(row.id) ?? "") ? [] : [{ id: claim.id, url: row.url, quote }];
      }),
    );
    console.log(`这批关联主张当前对不上旧存档 ${missed.length} 条。试运行不重抓，还不核对新正文。`);
    for (const item of missed) console.log(`  当前对不上 ${item.id} · ${snippet(item.quote)} · ${item.url}`);
    return;
  }

  const watched = batch.filter((row) => byUrl.has(row.url));
  const oldText = new Map<number, string>();
  if (watched.length) {
    const texts = await sql<{ id: number; text: string }[]>`SELECT id, text FROM sources WHERE id IN ${sql(watched.map((row) => row.id))}`;
    for (const row of texts) oldText.set(Number(row.id), row.text);
  }

  const recovered: Report[] = [];
  const still: Report[] = [];
  const tallies = new Map<string, number>();
  let opened = 0;

  for (const [index, row] of batch.entries()) {
    if (index) await Bun.sleep(GAP_MS);
    const label = `${index + 1}/${batch.length}`;
    let saved: Snapshot | null = null;
    let failed = "";
    try {
      saved = await snapshot(row.url);
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    }
    const kind = failed ? "出错" : outcome(saved);
    tallies.set(kind, (tallies.get(kind) ?? 0) + 1);
    if (saved) {
      opened += 1;
      console.log(
        `${label} ${kind} · 新 sources#${saved.id} · ${saved.fetched_via} · HTTP ${saved.http_status} · ${saved.text.length} 字（旧 sources#${row.id} · ${reasons(row)}）· ${row.url}`,
      );
    } else {
      console.log(`${label} ${failed ? `出错 ${failed.slice(0, 160)}` : "重抓失败"} · 旧 sources#${row.id} · ${reasons(row)} · ${row.url}`);
    }

    for (const claim of byUrl.get(row.url) ?? []) {
      const quote = quoteOf(claim);
      const before = quoteOnPage(quote, oldText.get(row.id) ?? "");
      const after = saved ? quoteOnPage(quote, saved.text) : false;
      if (!before && after) {
        recovered.push({ id: claim.id, url: row.url, quote, note: "" });
        console.log(`  原来对不上、现在对得上 ${claim.id}`);
      } else if (!after) {
        const note = failed ? "出错" : !saved ? "重抓失败" : before ? "旧存档对得上" : "";
        still.push({ id: claim.id, url: row.url, quote, note });
        console.log(`  仍对不上 ${claim.id}${note ? `（${note}）` : ""}`);
      }
    }
  }

  console.log(`完成 · 新存档 ${opened}/${batch.length}`);
  for (const [kind, count] of [...tallies.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${kind} ${count}`);
  console.log(`原来对不上、现在对得上 ${recovered.length}`);
  for (const item of recovered) console.log(`  ${item.id} · ${snippet(item.quote)} · ${item.url}`);
  console.log(`仍对不上 ${still.length}`);
  for (const item of still) console.log(`  ${item.id}${item.note ? `（${item.note}）` : ""} · ${snippet(item.quote)} · ${item.url}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
