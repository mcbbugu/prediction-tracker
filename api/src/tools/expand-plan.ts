// bun --env-file=.env run src/tools/expand-plan.ts
// 只读。按「离出分最近」列出今天该补的人：还没出分、但已有过期未判定主张的优先；其次是名单里还没收录的人。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afpUsedToday } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { MIN_JUDGED } from "../scoring/score";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const JUDGED = ["已兑现", "部分兑现", "未兑现"];

export const ROSTER_FILES = [
  "data/batches/ai-tech-100.txt",
  "data/batches/ai-tech-200.txt",
  "data/batches/investors-100.txt",
  "data/batches/crypto-50.txt",
  "data/batches/science-sports-culture-50.txt",
];

export type GapRow = { id: string; name: string; judged: number; overdue: number };

export function rankGaps(rows: GapRow[], minJudged = MIN_JUDGED) {
  return rows
    .map((row) => ({ ...row, gap: Math.max(0, minJudged - row.judged), scored: row.judged >= minJudged }))
    .filter((row) => !row.scored)
    .sort((a, b) => b.overdue - a.overdue || a.gap - b.gap || a.name.localeCompare(b.name, "zh"));
}

export function rosterNames(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [zh, en] = line.split("|").map((part) => part.trim());
      return { zh, en: en ?? "", query: en ? `${zh}（${en}）` : zh };
    });
}

export function foldName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

export function samePerson(candidate: { zh: string; en: string }, known: { name: string; name_en: string }) {
  const en = foldName(candidate.en);
  const knownEn = foldName(known.name_en);
  if (candidate.zh && candidate.zh === known.name) return true;
  if (en && knownEn && en === knownEn) return true;
  const surname = en.split(/\s+/).at(-1) ?? "";
  const knownSurname = knownEn.split(/\s+/).at(-1) ?? "";
  if (surname.length < 5 || surname !== knownSurname) return false;
  const given = en.slice(0, -surname.length).trim();
  const knownGiven = knownEn.slice(0, -knownSurname.length).trim();
  if (!given || !knownGiven) return true;
  return given.startsWith(knownGiven) || knownGiven.startsWith(given);
}

export function concatRosters(files: { text: string }[]) {
  const seen = new Set<string>();
  const rows: ReturnType<typeof rosterNames> = [];
  for (const file of files) {
    for (const row of rosterNames(file.text)) {
      const key = foldName(row.en) || row.zh;
      if (seen.has(key) || seen.has(row.zh)) continue;
      seen.add(key);
      if (row.zh) seen.add(row.zh);
      rows.push(row);
    }
  }
  return rows;
}

export async function expansionMetrics() {
  const [claims] = await sql<{ claims: number; judged: number }[]>`
    SELECT count(*)::int AS claims,
           count(*) FILTER (WHERE status IN ${sql(JUDGED)})::int AS judged
    FROM claims WHERE publication = 'published'
  `;
  const domains = await sql<{ person_id: string; category: string; judged: number }[]>`
    SELECT person_id, category,
           count(*) FILTER (WHERE status IN ${sql(JUDGED)} AND jsonb_array_length(evidence) > 0)::int AS judged
    FROM claims
    WHERE publication = 'published'
    GROUP BY person_id, category
  `;
  const scoredDomains = domains.filter((row) => row.judged >= MIN_JUDGED);
  const afp = await afpUsedToday();
  return {
    scored_people: new Set(scoredDomains.map((row) => row.person_id)).size,
    scored_domains: scoredDomains.length,
    claims: claims?.claims ?? 0,
    judged: claims?.judged ?? 0,
    afp_used: afp.used,
    afp_budget: afp.budget,
  };
}

export async function buildPlan(rosterFiles = ROSTER_FILES) {
  const today = new Date().toISOString().slice(0, 10);
  const people = await sql<GapRow[]>`
    SELECT p.id, p.name,
           count(c.id) FILTER (
             WHERE c.status IN ${sql(JUDGED)} AND jsonb_array_length(c.evidence) > 0
           )::int AS judged,
           count(c.id) FILTER (WHERE c.status = '待定' AND c.deadline < ${today})::int AS overdue
    FROM people p
    LEFT JOIN claims c ON c.person_id = p.id AND c.publication = 'published'
    GROUP BY p.id, p.name
  `;
  const ranked = rankGaps(people);
  const verifies = await sql<{ id: string; person_id: string; name: string; quote_zh: string }[]>`
    SELECT c.id, c.person_id, p.name, c.quote_zh
    FROM claims c
    JOIN people p ON p.id = c.person_id
    WHERE c.publication = 'published' AND c.status = '待定' AND c.deadline < ${today}
      AND NOT EXISTS (SELECT 1 FROM verdict_proposals v WHERE v.claim_id = c.id AND v.state = 'pending')
      AND NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.kind = 'verify_claim' AND j.state IN ('queued', 'running') AND j.payload->>'claim_id' = c.id
      )
    ORDER BY c.deadline
  `;
  const order = new Map(ranked.map((row, index) => [row.id, index]));
  verifies.sort((a, b) => (order.get(a.person_id) ?? 999) - (order.get(b.person_id) ?? 999));

  const known = await sql<{ name: string; name_en: string }[]>`SELECT name, name_en FROM people`;
  const roster = rosterFiles.flatMap((file) => {
    try {
      return [{ text: readFileSync(join(root, file), "utf8") }];
    } catch {
      return [];
    }
  });
  const missing = concatRosters(roster).filter((row) => !known.some((person) => samePerson(row, person)));
  return { ranked, verifies, missing };
}

async function main() {
  await migrate();
  const plan = await buildPlan();
  const metrics = await expansionMetrics();
  console.log(
    `现在有分数的人 ${metrics.scored_people} · 领域 ${metrics.scored_domains} · 主张 ${metrics.claims} · 已判定 ${metrics.judged} · AFP ${metrics.afp_used}/${metrics.afp_budget}`,
  );
  console.log(`离出分最近（还没出分）${plan.ranked.length} 人，其中有过期未判定的排在前面`);
  for (const row of plan.ranked.filter((item) => item.overdue > 0).slice(0, 20)) {
    console.log(`  差 ${row.gap} 条 · 过期 ${row.overdue} · ${row.name}`);
  }
  console.log(`可入队的到期核对 ${plan.verifies.length} 条`);
  console.log(`名单里还没收录 ${plan.missing.length} 人`);
  for (const row of plan.missing.slice(0, 15)) console.log(`  ${row.query}`);
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await sql.end();
    });
}
