// pnpm api:consistency -- --person=<id> [--import] — 可信度对照的入库前核对（SPEC P13，格式见 data/consistency/README.md）.
//
// For every pair in data/consistency/<id>.json: archive each linked page ourselves (Internet Archive copy from
// that date as fallback) and check the quote appears word for word. Own-words sides (a, b of reversal/reaffirm,
// explanation) must not be reported speech. Without --import nothing is written except the archived pages,
// so collectors can run it repeatedly to fix quotes; pages archived in the last 3 days are reused.
// With --import, pairs whose sides all pass are upserted as proposed (label null); reviewed rows are never touched.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { DOMAINS, isReportedSpeech, speakerNames } from "../claims/discover";
import { quoteOnPage, snapshot, type Snapshot } from "../evidence/sources";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const KINDS = new Set(["reversal", "reaffirm", "walk"]);
const LABELS = new Set(["consistent", "inconsistent"]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

type Side = { quote: string; quote_zh?: string; date: string; url: string };
type Pair = {
  id: string;
  kind: string;
  domain: string;
  topic: string;
  a: Side;
  b: Side;
  explanation?: Side | null;
  proposed_label: string;
  rationale?: string;
};
type CheckedSide = Side & { source_id: number | null; fetched_via: string | null; verified: boolean; problem: string };

type Page = Pick<Snapshot, "id" | "text" | "fetched_via"> & { http_status: number };

async function recentPage(url: string): Promise<Page | null> {
  const rows = await sql<Page[]>`
    SELECT id, text, fetched_via, http_status FROM sources
    WHERE url = ${url} AND fetched_at > now() - interval '3 days'
    ORDER BY fetched_at DESC LIMIT 1
  `;
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

const usable = (page: Page | null): page is Page => !!page && page.http_status < 400 && page.text.length >= 200;

async function open(url: string) {
  return (await recentPage(url)) ?? (await snapshot(url));
}

function waybackUrl(url: string, date: string) {
  return `https://web.archive.org/web/${date.replace(/-/g, "")}id_/${url}`;
}

async function checkSide(side: Side, ownWords: boolean, names: string[]): Promise<CheckedSide> {
  const fail = (problem: string, page: Page | null = null): CheckedSide => ({
    ...side,
    source_id: page?.id ?? null,
    fetched_via: page?.fetched_via ?? null,
    verified: false,
    problem,
  });
  if (!side?.quote || !side.url || !isoDate.test(side.date ?? "")) return fail("缺 quote / url / date（YYYY-MM-DD）");
  if (ownWords && isReportedSpeech(side.quote, names)) return fail("像是转述，不是本人原话");
  let page = await open(side.url);
  if (usable(page) && quoteOnPage(side.quote, page.text)) return { ...side, source_id: page.id, fetched_via: page.fetched_via, verified: true, problem: "" };
  const copy = await open(waybackUrl(side.url, side.date));
  if (usable(copy) && quoteOnPage(side.quote, copy.text)) return { ...side, source_id: copy.id, fetched_via: "wayback", verified: true, problem: "" };
  if (!usable(page)) page = usable(copy) ? copy : page;
  return fail(usable(page) ? "页面打开了，但原话没有逐字出现" : "页面打不开或没有正文", page);
}

function shapeProblems(pair: Pair, seen: Set<string>, personId: string) {
  const problems: string[] = [];
  if (!pair.id?.startsWith(`${personId}-c`)) problems.push(`id 应为 ${personId}-cNNN`);
  if (seen.has(pair.id)) problems.push("id 重复");
  if (!KINDS.has(pair.kind)) problems.push(`kind 只能是 ${[...KINDS].join(" / ")}`);
  if (!DOMAINS.includes(pair.domain)) problems.push(`domain 不在固定列表里：${pair.domain}`);
  if (!LABELS.has(pair.proposed_label)) problems.push("proposed_label 只能是 consistent / inconsistent");
  if (!pair.topic) problems.push("缺 topic");
  if (pair.kind !== "walk" && pair.a?.date && pair.b?.date && pair.a.date > pair.b.date) problems.push("a 应早于 b");
  if (pair.kind === "reaffirm" && pair.proposed_label !== "consistent") problems.push("reaffirm 只能是 consistent");
  if (pair.explanation && pair.kind !== "reversal") problems.push("explanation 只用于 reversal");
  if (pair.kind === "reversal" && pair.proposed_label === "consistent" && !pair.explanation)
    problems.push("翻转记为 consistent 必须给出本人说明理由的 explanation");
  return problems;
}

async function main() {
  const personId = process.argv.find((arg) => arg.startsWith("--person="))?.slice(9);
  const doImport = process.argv.includes("--import");
  if (!personId) throw new Error("usage: pnpm api:consistency -- --person=<id> [--import]");
  await migrate();
  const [person] = await sql<{ name: string; name_en: string }[]>`SELECT name, name_en FROM people WHERE id = ${personId}`;
  if (!person) throw new Error(`people 表里没有 ${personId}`);
  const names = speakerNames({ name_zh: person.name, name_en: person.name_en });
  const file = JSON.parse(await readFile(join(ROOT, "data/consistency", `${personId}.json`), "utf8")) as {
    collected_by?: string;
    pairs: Pair[];
  };
  const provenance = file.collected_by === "manual" ? "manual" : (file.collected_by ?? "cursor");

  const seen = new Set<string>();
  let passed = 0;
  let imported = 0;
  for (const pair of file.pairs ?? []) {
    const problems = shapeProblems(pair, seen, personId);
    seen.add(pair.id);
    const a = await checkSide(pair.a, true, names);
    const b = await checkSide(pair.b, pair.kind !== "walk", names);
    const explanation = pair.explanation ? await checkSide(pair.explanation, true, names) : null;
    for (const [name, side] of [["a", a], ["b", b], ["explanation", explanation]] as const) {
      if (side && !side.verified) problems.push(`${name}: ${side.problem}（${side.url}）`);
    }
    const ok = problems.length === 0;
    if (ok) passed++;
    console.log(`${ok ? "通过" : "未过"}  ${pair.id}  ${pair.kind}  ${pair.topic}`);
    for (const problem of problems) console.log(`      - ${problem}`);
    if (!ok || !doImport) continue;
    const strip = ({ problem: _problem, ...side }: CheckedSide) => side;
    const rows = await sql`
      INSERT INTO consistency_pairs (id, person_id, domain, topic, kind, a, b, explanation, proposed_label, rationale, provenance)
      VALUES (${pair.id}, ${personId}, ${pair.domain}, ${pair.topic}, ${pair.kind}, ${sql.json(strip(a))}, ${sql.json(strip(b))},
              ${explanation ? sql.json(strip(explanation)) : null}, ${pair.proposed_label}, ${pair.rationale ?? ""}, ${provenance})
      ON CONFLICT (id) DO UPDATE SET
        domain = EXCLUDED.domain, topic = EXCLUDED.topic, kind = EXCLUDED.kind, a = EXCLUDED.a, b = EXCLUDED.b,
        explanation = EXCLUDED.explanation, proposed_label = EXCLUDED.proposed_label, rationale = EXCLUDED.rationale,
        updated_at = now()
      WHERE consistency_pairs.reviewed_at IS NULL
      RETURNING id
    `;
    imported += rows.length;
  }
  const total = file.pairs?.length ?? 0;
  console.log(`\n${personId}: ${passed}/${total} 条通过核对${doImport ? `，写入 ${imported} 条（已人审的不覆盖）` : "（只核对，未写入）"}`);
}

await main();
await sql.end();
