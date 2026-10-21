// 批量按需分析：pnpm api:batch -- --file=data/batches/ai-tech-100.txt [--publish] [--limit=10]
// 一行一人「中文名 | English」。顺序执行，可以中断后重跑：7 天内已完成的人会跳过。
// --retry-empty：7 天内跑过但 0 条主张的人也重跑（例如修了搜索之后）。
// --publish 只用于本机未上线的网站：结果以「机器核对」直接公开（见 SPEC.md 核对分层）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arkConfigured } from "./ark";
import { sql } from "./db";
import { runAnalyzeJob } from "./discover";
import { migrate } from "./migrate";
import { remapStrayDomains } from "./remap-domains";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const file = arg("file") ?? "data/batches/ai-tech-100.txt";
const limit = Number(arg("limit") ?? 1000);
const concurrency = Math.max(1, Math.min(6, Number(arg("concurrency") ?? 1)));
const retryEmpty = process.argv.includes("--retry-empty");
if (process.argv.includes("--publish")) process.env.AUTO_PUBLISH = "1";

function parse(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [zh, en] = line.split("|").map((part) => part.trim());
      return { zh, en: en ?? "", query: en ? `${zh}（${en}）` : zh };
    });
}

async function main() {
  await migrate();
  if (!arkConfigured()) {
    console.log("缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL（api/.env）");
    return;
  }
  const people = parse(readFileSync(join(root, file), "utf8")).slice(0, limit);
  console.log(`名单 ${people.length} 人 · ${process.env.AUTO_PUBLISH === "1" ? "结果以「机器核对」直接公开" : "结果进审核台"}`);
  const started = Date.now();
  let done = 0;
  let stopped = false;
  let next = 0;
  const retryQueue: number[] = [];
  const burstRetries = new Map<number, number>();
  const BURST_PAUSE_MS = 5 * 60_000;

  async function runOne(index: number) {
    const person = people[index];
    const tag = `[${index + 1}/${people.length}] ${person.zh}`;
    const recent = await sql<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE kind = 'analyze_person' AND query = ${person.query} AND state IN ('done', 'rejected')
        AND created_at > now() - interval '7 days'
        AND NOT (${retryEmpty} AND state = 'done' AND coalesce((result->>'claims_found')::int, 0) = 0)
      LIMIT 1
    `;
    if (recent[0]) {
      console.log(`${tag} 跳过（7 天内已分析）`);
      return;
    }
    const [job] = await sql<{ id: string }[]>`
      INSERT INTO jobs (kind, query, runner) VALUES ('analyze_person', ${person.query}, 'batch') RETURNING id
    `;
    const t0 = Date.now();
    await runAnalyzeJob(job.id);
    const [result] = await sql<{ state: string; result: { claims_found?: number; due_checked?: number; message?: string } }[]>`
      SELECT state, result FROM jobs WHERE id = ${job.id}
    `;
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (result.state === "done") {
      done += 1;
      console.log(`${tag} 完成 · 主张 ${result.result.claims_found ?? 0} · 到期判定 ${result.result.due_checked ?? 0} · ${seconds}s · /jobs/${job.id}`);
      return;
    }
    const message = result.result.message ?? "";
    console.log(`${tag} ${result.state === "rejected" ? "不收录" : "失败"} · ${message.slice(0, 120)} · ${seconds}s`);
    // A request burst clears after a pause: wait, then put this person back in the queue (twice at most).
    if (/RequestBurstTooFast|request burst/i.test(message) && (burstRetries.get(index) ?? 0) < 2) {
      burstRetries.set(index, (burstRetries.get(index) ?? 0) + 1);
      console.log(`${tag} 触发突发限流，暂停 5 分钟后重试`);
      await Bun.sleep(BURST_PAUSE_MS);
      retryQueue.push(index);
      return;
    }
    // Out of model quota or the API keeps refusing us: stop, so a rerun picks up from here.
    // Access denied (e.g. web search not enabled on the Ark account) will fail every person the same way.
    if (/429|quota|rate limit|limit exceeded|额度|限流|Too Many Requests|RequestBurstTooFast|request burst|AccessDenied|Access denied/i.test(message)) stopped = true;
  }

  async function worker() {
    while (!stopped && (retryQueue.length > 0 || next < people.length)) {
      const index = retryQueue.shift() ?? next++;
      await runOne(index);
    }
  }

  console.log(`同时分析 ${concurrency} 人`);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (stopped) console.log("模型额度、限流或权限被拒，已停止。处理好之后重跑同一条命令会从这里继续。");
  await remapStrayDomains((line) => console.log(`[领域归并] ${line}`)).catch(() => {});
  console.log(`结束 · 本次完成 ${done} 人 · 用时 ${Math.round((Date.now() - started) / 60000)} 分钟`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
