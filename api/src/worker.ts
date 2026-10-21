// 统一任务队列的执行进程：pnpm api:worker [-- --concurrency=1] [--once]
// 所有后台工作都写成 jobs 表里的一行（state = 'queued'），由这一个进程按顺序认领执行；
// 方舟调用的全局限速和每日 AFP 预算在 ark.ts 里，跨进程生效。
// --once：队列空了就退出（适合一次性清积压）；默认一直等新任务。
// AUTO_PUBLISH=1（或 --publish）只用于本机未上线的网站，见 SPEC「核对分层」。
import { BudgetExceeded, afpUsedToday, arkConfigured } from "./ark";
import { sql } from "./db";
import { runAnalyzeJob } from "./discover";
import { migrate } from "./migrate";
import { recomputeScores } from "./score";
import { applyVerdictAutomatically, verifyClaim, type DueClaim } from "./verdict";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const concurrency = Math.max(1, Math.min(4, Number(arg("concurrency") ?? 1)));
const once = process.argv.includes("--once");
if (process.argv.includes("--publish")) process.env.AUTO_PUBLISH = "1";
const IDLE_MS = 15_000;
const BURST_DELAY = "5 minutes";
const MAX_ATTEMPTS = 3;
const RETRYABLE = /RequestBurstTooFast|request burst|429|Too Many Requests/i;

type Job = { id: string; kind: string; query: string; payload: { claim_id?: string }; attempts: number };

let stopping = false;
let stopReason = "";

async function claimNext() {
  const rows = await sql<Job[]>`
    UPDATE jobs SET state = 'running', runner = 'worker', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE state = 'queued' AND run_after <= now()
      ORDER BY run_after, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, query, payload, attempts
  `;
  return rows[0] ?? null;
}

async function verifyJob(job: Job) {
  const [claim] = await sql<DueClaim[]>`
    SELECT c.id, c.person_id, p.name_en, c.category, c.quote_en, c.quote_zh, c.source_url,
           to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
           to_char(c.deadline, 'YYYY-MM-DD') AS deadline
    FROM claims c JOIN people p ON p.id = c.person_id
    WHERE c.id = ${job.payload.claim_id ?? ""}
  `;
  if (!claim) throw new Error(`没有这条主张：${job.payload.claim_id}`);
  const outcome = await verifyClaim(claim);
  let applied = false;
  if (process.env.AUTO_PUBLISH === "1" && outcome.proposal_id) applied = await applyVerdictAutomatically(outcome.proposal_id);
  if (applied) await recomputeScores(claim.person_id, { claim_id: claim.id, action: "verdict_auto_applied" });
  const result = { claim_id: claim.id, person_id: claim.person_id, status: outcome.status, applied, proposal_id: outcome.proposal_id };
  await sql`UPDATE jobs SET state = 'done', person_id = ${claim.person_id}, result = ${sql.json(result)}, updated_at = now() WHERE id = ${job.id}`;
  return `${claim.person_id} · ${outcome.status}${applied ? " · 已生效" : " · 待审"}`;
}

async function runJob(job: Job) {
  const t0 = Date.now();
  try {
    let summary: string;
    if (job.kind === "analyze_person") {
      // runAnalyzeJob records its own state and result on the job row.
      await runAnalyzeJob(job.id);
      const [row] = await sql<{ state: string; result: { message?: string; claims_found?: number } }[]>`
        SELECT state, result FROM jobs WHERE id = ${job.id}
      `;
      if (row.state === "failed" && row.result.message) throw new Error(row.result.message);
      summary = `${job.query} · ${row.state} · 主张 ${row.result.claims_found ?? 0}`;
    } else if (job.kind === "verify_claim") {
      summary = await verifyJob(job);
    } else {
      throw new Error(`未知任务类型：${job.kind}`);
    }
    console.log(`完成 ${job.kind} · ${summary} · ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BudgetExceeded || /AccessDenied|Access denied|额度|quota/i.test(message)) {
      // Not this job's fault: put it back and stop taking new work.
      await sql`UPDATE jobs SET state = 'queued', attempts = attempts - 1, updated_at = now() WHERE id = ${job.id}`;
      stopping = true;
      stopReason = message.slice(0, 200);
      return;
    }
    if (RETRYABLE.test(message) && job.attempts < MAX_ATTEMPTS) {
      await sql`
        UPDATE jobs SET state = 'queued', run_after = now() + ${BURST_DELAY}::interval, updated_at = now() WHERE id = ${job.id}
      `;
      console.log(`限流 ${job.kind} · ${job.query} · 5 分钟后重试（第 ${job.attempts} 次）`);
      return;
    }
    await sql`
      UPDATE jobs SET state = 'failed', result = ${sql.json({ message: message.slice(0, 600) })}, updated_at = now() WHERE id = ${job.id}
    `;
    console.log(`失败 ${job.kind} · ${job.query} · ${message.slice(0, 160)}`);
  }
}

async function loop() {
  while (!stopping) {
    const job = await claimNext();
    if (!job) {
      if (once) return;
      await Bun.sleep(IDLE_MS);
      continue;
    }
    await runJob(job);
  }
}

async function main() {
  await migrate();
  if (!arkConfigured()) {
    console.log("缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL（api/.env）");
    return;
  }
  // A worker that died mid-job leaves rows stuck in 'running'; give them back to the queue.
  const revived = await sql`
    UPDATE jobs SET state = 'queued', updated_at = now()
    WHERE runner = 'worker' AND state = 'running' AND updated_at < now() - interval '30 minutes'
    RETURNING id
  `;
  const [counts] = await sql<{ queued: number }[]>`SELECT count(*)::int AS queued FROM jobs WHERE state = 'queued'`;
  const afp = await afpUsedToday();
  console.log(
    `队列 ${counts.queued} 个任务 · 并发 ${concurrency} · 今日 AFP ${afp.used}/${afp.budget}` +
      (revived.length ? ` · 回收中断任务 ${revived.length} 个` : "") +
      (process.env.AUTO_PUBLISH === "1" ? " · 本机模式自动公开" : ""),
  );
  await Promise.all(Array.from({ length: concurrency }, () => loop()));
  if (stopping) console.log(`已停止：${stopReason}。处理好之后重新启动会接着跑。`);
  const after = await afpUsedToday();
  console.log(`结束 · 今日 AFP ${after.used}/${after.budget}，联网搜索 ${after.searches} 次`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
