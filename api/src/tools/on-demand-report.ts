// bun --env-file=.env run src/tools/on-demand-report.ts <run.json>
// 041：线上实时调研的成绩单。run.json 里记着这一轮的任务 id（{ "jobs": [{ "query", "job_id" }] }），
// 其余全部从 jobs、job_events、claims、score_snapshots 重算，所以随时可以再跑一遍核对。
import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "../core/db";

type Event = { step: string; status: string; message: string; data: Record<string, unknown>; created_at: Date };

const STEPS = ["识别人物", "搜索公开发言", "存档网页", "抽取预测", "核对原话", "结构化", "到期核对", "利益关系", "可信度对照", "财务与敞口", "分数与旁证"];

const seconds = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 1000);

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Seconds each step took: from its first event to its last done/failed event.
export function stepSeconds(events: Event[]) {
  const out: Record<string, number> = {};
  for (const step of new Set(events.map((event) => event.step))) {
    const mine = events.filter((event) => event.step === step);
    const end = [...mine].reverse().find((event) => event.status === "done" || event.status === "failed") ?? mine[mine.length - 1];
    out[step] = seconds(mine[0].created_at, end.created_at);
  }
  return out;
}

// Seconds until the claims are usable: identified, collected, checked, structured and due ones judged.
// Everything after (interests, consistency, filings) adds context but the reader already has the record.
export function secondsToClaims(events: Event[]) {
  if (!events.length) return null;
  const core = events.filter((event) => ["识别人物", "搜索公开发言", "存档网页", "抽取预测", "核对原话", "结构化", "到期核对"].includes(event.step));
  if (!core.length) return null;
  return seconds(events[0].created_at, core[core.length - 1].created_at);
}

export function dropReasons(events: Event[]) {
  const done = events.find((event) => event.step === "核对原话" && event.status === "done");
  const dropped = (done?.data.dropped as { reason?: string }[] | undefined) ?? [];
  const counts: Record<string, number> = {};
  for (const row of dropped) counts[row.reason ?? "未写原因"] = (counts[row.reason ?? "未写原因"] ?? 0) + 1;
  return counts;
}

async function row(query: string, jobId: string) {
  const [job] = await sql<{ state: string; person_id: string | null; created_at: Date; updated_at: Date; result: Record<string, unknown> }[]>`
    SELECT state, person_id, created_at, updated_at, result FROM jobs WHERE id = ${jobId}
  `;
  if (!job) return { query, job_id: jobId, state: "missing" };
  const events = await sql<Event[]>`
    SELECT step, status, message, data, created_at FROM job_events WHERE job_id = ${jobId} ORDER BY id
  `;
  const find = (step: string) => events.find((event) => event.step === step && event.status === "done");
  const urls = (find("搜索公开发言")?.data.urls as string[] | undefined) ?? [];
  const candidates = (find("抽取预测")?.data.candidates as unknown[] | undefined) ?? [];
  const kept = (find("核对原话")?.data.kept as unknown[] | undefined) ?? [];
  const verdicts = (job.result.verdicts as { status: string }[] | undefined) ?? [];
  const scored = job.person_id
    ? await sql<{ domain: string; value: number; n: number }[]>`
        SELECT DISTINCT ON (domain) domain, value::float8 AS value, n FROM score_snapshots
        WHERE person_id = ${job.person_id} AND slice = 'all' ORDER BY domain, computed_at DESC
      `
    : [];
  const live = scored.filter((score) => score.value != null);
  const first = events[0]?.created_at ?? null;
  const last = events[events.length - 1]?.created_at ?? null;
  return {
    query,
    job_id: jobId,
    state: job.state,
    failure: job.state === "done" ? null : String(job.result.message ?? ""),
    person_id: job.person_id,
    queue_wait_s: first ? seconds(job.created_at, first) : null,
    total_s: first && last ? seconds(first, last) : null,
    to_claims_s: secondsToClaims(events),
    steps_s: stepSeconds(events),
    searches: Number(job.result.search_count ?? 0),
    documents: urls.length,
    candidates: candidates.length,
    claims: kept.length,
    dropped: dropReasons(events),
    due_judged: verdicts.filter((verdict) => verdict.status !== "证据不足").length,
    due_void: verdicts.filter((verdict) => verdict.status === "证据不足").length,
    scored: live.length > 0,
    scored_domains: live.map((score) => `${score.domain} ${score.value}（${score.n} 条）`),
  };
}

export async function report(jobs: { query: string; job_id: string }[]) {
  const rows = [];
  for (const job of jobs) rows.push(await row(job.query, job.job_id));
  const done = rows.filter((item) => item.state === "done") as Extract<Awaited<ReturnType<typeof row>>, { total_s: unknown }>[];
  const finished = rows.filter((item) => item.state === "done" || item.state === "failed" || item.state === "rejected");
  const num = (pick: (item: (typeof done)[number]) => number | null) => done.map(pick).filter((value): value is number => value != null);
  return {
    people: rows.length,
    finished: finished.length,
    success: done.length,
    success_rate: finished.length ? Math.round((1000 * done.length) / finished.length) / 10 : null,
    median_total_s: median(num((item) => item.total_s)),
    max_total_s: num((item) => item.total_s).reduce((max, value) => Math.max(max, value), 0) || null,
    median_to_claims_s: median(num((item) => item.to_claims_s)),
    median_queue_wait_s: median(num((item) => item.queue_wait_s)),
    median_claims: median(num((item) => item.claims)),
    median_searches: median(num((item) => item.searches)),
    scored: done.filter((item) => item.scored).length,
    median_step_s: Object.fromEntries(STEPS.map((step) => [step, median(num((item) => (item.steps_s as Record<string, number>)[step] ?? null))])),
    rows,
  };
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("用法：on-demand-report.ts <run.json>");
  const run = JSON.parse(readFileSync(file, "utf8")) as { jobs: { query: string; job_id: string }[] };
  const result = await report(run.jobs);
  writeFileSync(file, JSON.stringify({ ...run, report: result }, null, 2));
  const fmt = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 60)} 分 ${s % 60} 秒`);
  console.log(`完成 ${result.finished}/${result.people}，成功率 ${result.success_rate ?? "—"}%，出分 ${result.scored} 人`);
  console.log(`中位总耗时 ${fmt(result.median_total_s)}（最长 ${fmt(result.max_total_s)}），到拿到主张 ${fmt(result.median_to_claims_s)}，排队 ${fmt(result.median_queue_wait_s)}`);
  console.log(`中位主张 ${result.median_claims} 条，中位搜索 ${result.median_searches} 次`);
  console.log(`各步中位耗时：${Object.entries(result.median_step_s).filter(([, s]) => s != null).map(([step, s]) => `${step} ${fmt(s)}`).join("，")}`);
  for (const item of result.rows) {
    if (!("total_s" in item)) {
      console.log(`  ${item.query}：${item.state}`);
      continue;
    }
    console.log(`  ${item.query}：${item.state}${item.failure ? `（${item.failure.slice(0, 60)}）` : ""} · ${fmt(item.total_s)} · 主张 ${item.claims}/${item.candidates} · 到期判定 ${item.due_judged}，作废 ${item.due_void} · 搜索 ${item.searches} · ${item.scored ? "出分" : "未出分"}`);
  }
  await sql.end();
}
