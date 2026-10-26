// bun --env-file=.env run src/tools/on-demand-run.ts <run 名> <人名1> <人名2> …
// 041：按用户的方式跑一轮按需分析，再出成绩单。
// 和线上一样：经过 admitAnalyze（同名去重、每日总量），排进 runner = 'api' 的队列，最多同时跑 ANALYZE_MAX_RUNNING 个，
// 由 runAnalyzeJob 执行。唯一的不同：每人用一个假的客户端地址，否则同一台机器一天只能发起 3 次（每 IP 限流）。
// 任务在这个进程里执行（API 进程只在收到请求时才取队列），所以要等全部跑完这个脚本才退出。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { admitAnalyze, hashClientIp, pumpApiQueue } from "../jobs/analyze-limit";
import { report } from "./on-demand-report";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main() {
  const [name, ...queries] = process.argv.slice(2);
  if (!name || !queries.length) throw new Error("用法：on-demand-run.ts <run 名> <人名…>");
  await migrate();
  const file = join(root, `data/eval/on-demand/${name}.json`);
  const jobs: { query: string; job_id: string }[] = [];
  for (const [index, query] of queries.entries()) {
    const admitted = await admitAnalyze({ query, clientIp: hashClientIp(`eval-${name}-${index}`, process.env.IP_HASH_SALT ?? ""), dailyLimit: Number(process.env.ANALYZE_DAILY_LIMIT || 30) });
    if ("error" in admitted) throw new Error(`${query} 没能入队：${admitted.error}`);
    jobs.push({ query, job_id: admitted.job_id });
  }
  const started = new Date().toISOString();
  writeFileSync(file, JSON.stringify({ run: name, started, jobs }, null, 2));
  console.log(`入队 ${jobs.length} 人，记录在 ${file}`);
  const ids = jobs.map((job) => job.job_id);
  for (;;) {
    await pumpApiQueue();
    const states = await sql<{ state: string; n: number }[]>`SELECT state, count(*)::int AS n FROM jobs WHERE id IN ${sql(ids)} GROUP BY state`;
    const open = states.filter((row) => row.state === "queued" || row.state === "running").reduce((sum, row) => sum + row.n, 0);
    console.log(`${new Date().toISOString().slice(11, 19)} ${states.map((row) => `${row.state} ${row.n}`).join("，")}`);
    if (!open) break;
    await Bun.sleep(30_000);
  }
  const result = await report(jobs);
  writeFileSync(file, JSON.stringify({ run: name, started, jobs, report: result }, null, 2));
  console.log(`完成。成绩单写进 ${file}，用 on-demand-report.ts 可以重算。`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
