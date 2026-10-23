// On-demand analysis caps: three new jobs per hashed IP each day, and a site-wide queue
// instead of rejecting when the API is already at ANALYZE_MAX_RUNNING.
import { createHash } from "node:crypto";
import { sql } from "../core/db";

export const IP_ANALYZE_LIMIT = 3;

// postgres.js transactions are tagged templates too, but their type is not the connection type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function hashClientIp(ip: string, salt: string) {
  return createHash("sha256").update(`${salt}\n${ip}`).digest("hex");
}

// Trust the first X-Forwarded-For hop only when the process is behind a proxy we control.
export function clientAddress(headers: Headers, trustProxy: boolean, fallback: string) {
  if (trustProxy) {
    const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  return fallback || "unknown";
}

export function ipAnalyzeAllowed(recentCount: number) {
  return recentCount < IP_ANALYZE_LIMIT;
}

export async function recentAnalyzeCount(db: Db, clientIp: string) {
  const [row] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM jobs
    WHERE kind = 'analyze_person' AND client_ip = ${clientIp}
      AND created_at > now() - interval '24 hours'
  `;
  return row?.n ?? 0;
}

// How many API analyses will run before this queued job: the ones already running, plus queued ones created earlier.
export async function queuePosition(db: Db, jobId: string) {
  const [row] = await db<{ n: number; state: string }[]>`
    SELECT j.state,
      CASE WHEN j.state = 'queued' THEN (
        (SELECT count(*) FROM jobs
          WHERE kind = 'analyze_person' AND runner = 'api' AND state = 'running')
        + (SELECT count(*) FROM jobs
          WHERE kind = 'analyze_person' AND runner = 'api' AND state = 'queued' AND created_at < j.created_at)
      )::int ELSE 0 END AS n
    FROM jobs j WHERE j.id = ${jobId}
  `;
  return row?.n ?? 0;
}

export function analyzeMaxRunning() {
  return Number(process.env.ANALYZE_MAX_RUNNING || 2);
}

// Start the oldest queued API analysis when a slot is free. Returns the job id if one was started.
const ADMIT_LOCK = "analyze-person";

export async function claimNextApiAnalysis(maxRunning = analyzeMaxRunning()) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${ADMIT_LOCK}))`;
    const [running] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM jobs
      WHERE kind = 'analyze_person' AND runner = 'api' AND state = 'running'
    `;
    if ((running?.n ?? 0) >= maxRunning) return null;
    const [next] = await tx<{ id: string }[]>`
      UPDATE jobs SET state = 'running', updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE kind = 'analyze_person' AND runner = 'api' AND state = 'queued' AND run_after <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `;
    return next?.id ?? null;
  });
}

// Check the daily cap and the per-IP cap, then insert, under one lock so concurrent requests cannot both pass.
export async function admitAnalyze(input: { query: string; clientIp: string; dailyLimit: number }) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${ADMIT_LOCK}))`;
    const same = await tx<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE kind = 'analyze_person' AND lower(query) = lower(${input.query})
        AND (state IN ('queued', 'running') OR (state = 'done' AND created_at > now() - interval '1 hour'))
      ORDER BY created_at DESC LIMIT 1
    `;
    if (same[0]) return { reused: true as const, job_id: same[0].id };
    const [today] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM jobs WHERE created_at > now() - interval '1 day' AND runner = 'api'
    `;
    if ((today?.n ?? 0) >= input.dailyLimit) return { error: "daily" as const };
    if (!ipAnalyzeAllowed(await recentAnalyzeCount(tx, input.clientIp))) return { error: "ip" as const };
    const [job] = await tx<{ id: string }[]>`
      INSERT INTO jobs (kind, query, runner, client_ip) VALUES ('analyze_person', ${input.query}, 'api', ${input.clientIp})
      RETURNING id
    `;
    return { reused: false as const, job_id: job.id };
  });
}

export async function pumpApiQueue() {
  const id = await claimNextApiAnalysis();
  if (!id) return;
  const { runAnalyzeJob } = await import("../claims/discover");
  void runAnalyzeJob(id).catch(() => {});
}
