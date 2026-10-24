// bun --env-file=.env run src/tools/expand.ts
// 生成当日计划，先入队到期核对，再入队少量名单里还没有的人，然后让 worker 跑到今日 AFP 的 80% 停。
// 定时：deploy/com.prediction-tracker.expand.plist 每天早上跑。不要自动 launchctl load，由人决定是否启用。
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../core/db";
import { isProduction } from "../core/env";
import { migrate } from "../core/migrate";
import { buildPlan, expansionMetrics } from "./expand-plan";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRoot = join(root, "api");
const DISCOVER_LIMIT = 3;

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function enqueue() {
  const plan = await buildPlan();
  let verifies = 0;
  for (const row of plan.verifies) {
    await sql`
      INSERT INTO jobs (kind, query, person_id, runner, payload)
      VALUES ('verify_claim', ${row.quote_zh.slice(0, 80)}, ${row.person_id}, 'worker', ${sql.json({ claim_id: row.id })})
    `;
    verifies += 1;
  }
  let consistency = 0;
  for (const row of plan.consistency) {
    if (consistency >= DISCOVER_LIMIT) break;
    const busy = await sql`
      SELECT 1 FROM jobs
      WHERE kind = 'consistency_collect' AND person_id = ${row.id}
        AND (state IN ('queued', 'running') OR (state IN ('done', 'rejected', 'failed') AND created_at > now() - interval '1 day'))
      LIMIT 1
    `;
    if (busy.length) continue;
    await sql`
      INSERT INTO jobs (kind, query, person_id, runner, payload)
      VALUES ('consistency_collect', ${row.name}, ${row.id}, 'worker', ${sql.json({ person_id: row.id })})
    `;
    consistency += 1;
  }
  let discovered = 0;
  for (const row of plan.missing) {
    if (discovered >= DISCOVER_LIMIT) break;
    const busy = await sql`
      SELECT 1 FROM jobs
      WHERE kind = 'analyze_person' AND query = ${row.query}
        AND (state IN ('queued', 'running') OR (state IN ('done', 'rejected') AND created_at > now() - interval '7 days'))
      LIMIT 1
    `;
    if (busy.length) continue;
    await sql`INSERT INTO jobs (kind, query, runner) VALUES ('analyze_person', ${row.query}, 'worker')`;
    discovered += 1;
  }
  console.log(`入队到期核对 ${verifies} 条，补可信度 ${consistency} 人，新人物 ${discovered} 人`);
}

function runWorker() {
  const args = ["--env-file=.env", "run", "src/jobs/worker.ts", "--", "--once"];
  if (!isProduction) args.push("--publish");
  const child = Bun.spawn(["bun", ...args], {
    cwd: apiRoot,
    env: { ...process.env, EXPAND_AFP_STOP: "0.8" },
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function main() {
  await migrate();
  const before = await expansionMetrics();
  console.log(`开始 · 有分数的人 ${before.scored_people} · 领域 ${before.scored_domains} · 主张 ${before.claims} · 已判定 ${before.judged} · 有可信度分 ${before.scored_consistency} · AFP ${before.afp_used}/${before.afp_budget}`);
  await enqueue();
  const code = await runWorker();
  const after = await expansionMetrics();
  const line = {
    date: shanghaiDate(),
    scored_people: after.scored_people,
    scored_domains: after.scored_domains,
    claims: after.claims,
    judged: after.judged,
    scored_consistency: after.scored_consistency,
    afp_used: after.afp_used,
    afp_budget: after.afp_budget,
    before,
  };
  const dir = join(root, "data/expansion");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "history.jsonl"), `${JSON.stringify(line)}\n`);
  console.log(`结束 · 有分数的人 ${after.scored_people} · 领域 ${after.scored_domains} · 主张 ${after.claims} · 已判定 ${after.judged} · 有可信度分 ${after.scored_consistency} · AFP ${after.afp_used}/${after.afp_budget} · worker ${code}`);
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
