// 往统一队列里加任务，由 pnpm api:worker 执行。
//   pnpm api:enqueue -- due                     所有已过期、仍待定、还没有待审判定的公开主张 → verify_claim
//   pnpm api:enqueue -- people [--file=data/batches/ai-tech-100.txt] [--limit=40] [--retry-empty]
//                                               名单里的人 → analyze_person（7 天内分析过的跳过，规则同 batch）
//   pnpm api:enqueue -- status                  队列和今日 AFP
// 已在队列或正在执行的同一任务不会重复加入。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afpUsedToday } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const mode = process.argv.slice(2).find((item) => !item.startsWith("--")) ?? "status";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function enqueueDue() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await sql<{ id: string; person_id: string; quote_zh: string }[]>`
    SELECT c.id, c.person_id, c.quote_zh FROM claims c
    WHERE c.publication = 'published' AND c.status = '待定' AND c.deadline < ${today}
      AND NOT EXISTS (SELECT 1 FROM verdict_proposals v WHERE v.claim_id = c.id AND v.state = 'pending')
      AND NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.kind = 'verify_claim' AND j.state IN ('queued', 'running') AND j.payload->>'claim_id' = c.id
      )
    ORDER BY c.deadline
  `;
  for (const row of rows) {
    await sql`
      INSERT INTO jobs (kind, query, person_id, runner, payload)
      VALUES ('verify_claim', ${row.quote_zh.slice(0, 80)}, ${row.person_id}, 'worker', ${sql.json({ claim_id: row.id })})
    `;
  }
  console.log(`加入到期核对 ${rows.length} 条`);
}

async function enqueuePeople() {
  const file = arg("file") ?? "data/batches/ai-tech-100.txt";
  const limit = Number(arg("limit") ?? 1000);
  const retryEmpty = process.argv.includes("--retry-empty");
  const people = readFileSync(join(root, file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, limit)
    .map((line) => {
      const [zh, en] = line.split("|").map((part) => part.trim());
      return en ? `${zh}（${en}）` : zh;
    });
  let added = 0;
  for (const query of people) {
    const busy = await sql`
      SELECT 1 FROM jobs
      WHERE kind = 'analyze_person' AND query = ${query}
        AND (
          state IN ('queued', 'running')
          OR (
            state IN ('done', 'rejected') AND created_at > now() - interval '7 days'
            AND NOT (${retryEmpty} AND state = 'done' AND coalesce((result->>'claims_found')::int, 0) = 0)
          )
        )
      LIMIT 1
    `;
    if (busy.length > 0) continue;
    await sql`INSERT INTO jobs (kind, query, runner) VALUES ('analyze_person', ${query}, 'worker')`;
    added += 1;
  }
  console.log(`名单 ${people.length} 人，加入分析 ${added} 人（其余 7 天内已分析或已在队列）`);
}

async function status() {
  const rows = await sql<{ kind: string; state: string; n: number }[]>`
    SELECT kind, state, count(*)::int AS n FROM jobs
    WHERE state IN ('queued', 'running') OR updated_at > now() - interval '1 day'
    GROUP BY kind, state ORDER BY kind, state
  `;
  for (const row of rows) console.log(`${row.kind.padEnd(16)} ${row.state.padEnd(9)} ${row.n}`);
  const afp = await afpUsedToday();
  console.log(`今日 AFP ${afp.used}/${afp.budget} · 联网搜索 ${afp.searches} 次`);
}

async function main() {
  await migrate();
  if (mode === "due") await enqueueDue();
  else if (mode === "people") await enqueuePeople();
  else if (mode === "status") await status();
  else console.log(`未知用法：${mode}（due | people | status）`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
