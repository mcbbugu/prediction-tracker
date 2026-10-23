// pnpm api:wayback -- [--limit=50] [--dry-run] [--max-minutes=60]
// 把存档过的网页再提交给 Internet Archive（Wayback Machine），拿一个第三方快照链接当佐证（SPEC 证据存档）。
// 逐字核对仍以我们自己存的原始字节为准；Wayback 只用来证明「这个页面当时确实是这样」。
//
// - 分两趟：先把每个网址在 Wayback 上有没有近 30 天的快照问一遍，有就直接记下来；剩下的才排队提交。
//   查询和提交是两套接口，提交被限流时查询照样能用，所以先把不用提交的捡干净。
// - 设置了 IA_ACCESS_KEY / IA_SECRET_KEY（archive.org 账号的 S3 key）就走 SPN2 接口，更稳；否则走匿名的 /save/。
// - 提交节奏自适应：每 8 秒 1 个起步，连续成功逐步收到每 5 秒 1 个；遇到 429 就把间隔加倍、整体冷却一段再接着跑，不退出。
// - 523（Wayback 连不上源站）、5xx、超时算暂时性失败，同一网址退避重试 3 次；仍失败才记 wayback_error，7 天后才会再排到它。
// - --max-minutes 到点就停（默认 60）；一轮里提交一个都没成、又连着栽了 4 个，说明整条提交通道不通，提前收工，
//   免得把后面网址也打上 7 天冷却。
import { sql } from "../core/db";
import { migrate } from "../core/migrate";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const limit = Math.max(1, Number(arg("limit") ?? 50));
const dryRun = process.argv.includes("--dry-run");
const maxMinutes = Math.max(1, Number(arg("max-minutes") ?? 60));
const deadline = Date.now() + maxMinutes * 60_000;
const key = process.env.IA_ACCESS_KEY && process.env.IA_SECRET_KEY ? `LOW ${process.env.IA_ACCESS_KEY}:${process.env.IA_SECRET_KEY}` : null;

const SNAPSHOT = /https?:\/\/web\.archive\.org\/web\/\d{14}[^\s"']*/;
const UA = "prediction-tracker evidence archiver";
const FRESH_DAYS = 30;
const LOOKUP_GAP_MS = 1_500;
const START_GAP_MS = 8_000;
const MIN_GAP_MS = 5_000;
const MAX_GAP_MS = 120_000;
const SPEEDUP = 0.85;
const WINS_BEFORE_SPEEDUP = 3;
const BASE_COOLDOWN_MS = 120_000;
const MAX_COOLDOWN_MS = 1_800_000;
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000];
const COOLDOWNS_PER_URL = 3;
const GIVE_UP_AFTER = 4;
const SAVE_TIMEOUT_MS = 120_000;

type Reason = "unreachable" | "server" | "timeout" | "other";
const REASON_ZH: Record<Reason, string> = {
  unreachable: "Wayback 连不上源站（523）",
  server: "Wayback 服务端出错（5xx）",
  timeout: "超时",
  other: "其它（连不上、拿不到快照地址等）",
};

// Bun 的网络错误信息后面跟着一长串 "pass `verbose: true` ..."，没必要存进库里。
const brief = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split(/\n|\. For more information/)[0]!.trim().slice(0, 200);

// 过一会儿重试就可能成功的失败，和「这个网址本身存不了」区分开。
class Transient extends Error {
  constructor(
    message: string,
    readonly reason: Reason,
  ) {
    super(message);
  }
}

class RateLimited extends Error {
  constructor(readonly retryAfterMs: number | null) {
    super("Wayback 限流（HTTP 429）");
  }
}

const isTimeout = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

function retryAfterMs(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function describe(error: unknown) {
  if (error instanceof Transient) return { message: error.message, reason: error.reason };
  const message = brief(error);
  if (/523/.test(message)) return { message, reason: "unreachable" as Reason };
  if (/HTTP 5\d\d/.test(message)) return { message, reason: "server" as Reason };
  if (/超时|timeout|timed out/i.test(message)) return { message, reason: "timeout" as Reason };
  return { message, reason: "other" as Reason };
}

// 节奏：一路顺就慢慢加快，撞上限流就退回去。
const pace = {
  gap: START_GAP_MS,
  cooldown: BASE_COOLDOWN_MS,
  wins: 0,
  slowest: START_GAP_MS,
  ok() {
    this.cooldown = BASE_COOLDOWN_MS;
    this.wins += 1;
    if (this.wins >= WINS_BEFORE_SPEEDUP && this.gap > MIN_GAP_MS) {
      this.gap = Math.max(MIN_GAP_MS, Math.round(this.gap * SPEEDUP));
      this.wins = 0;
    }
  },
  // 返回这次该停多久。Retry-After 说了就听它的，没说就 2 分钟起、每次翻倍、最长 30 分钟。
  limited(headerMs: number | null) {
    this.wins = 0;
    this.gap = Math.min(MAX_GAP_MS, this.gap * 2);
    this.slowest = Math.max(this.slowest, this.gap);
    const stop = headerMs ?? this.cooldown;
    if (headerMs == null) this.cooldown = Math.min(MAX_COOLDOWN_MS, this.cooldown * 2);
    return Math.min(Math.max(stop, 1_000), MAX_COOLDOWN_MS);
  },
};

let cooledMs = 0;
let lastSubmitAt = 0;

// 等待；返回 false 表示 --max-minutes 到了，不用等了。
async function hold(ms: number, why: string) {
  if (ms <= 0) return Date.now() < deadline;
  if (Date.now() + ms > deadline) return false;
  if (ms >= 20_000) console.log(`  等 ${Math.round(ms / 1_000)} 秒 · ${why}`);
  await Bun.sleep(ms);
  return true;
}

const secs = (ms: number) => (ms / 1_000).toFixed(1).replace(/\.0$/, "");

type Snapshot = { url: string; timestamp: string };

const stamp = (date: Date) => date.toISOString().replace(/[-:T]/g, "").slice(0, 14);

function daysOld(timestamp: string) {
  const date = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
  const time = `${timestamp.slice(8, 10) || "00"}:${timestamp.slice(10, 12) || "00"}:${timestamp.slice(12, 14) || "00"}`;
  const at = Date.parse(`${date}T${time}Z`);
  return Number.isNaN(at) ? Infinity : (Date.now() - at) / 86_400_000;
}

// undefined = 接口没答上来（限流/挂了），null = 确实没有快照。
type Lookup = Snapshot | null | undefined;

async function availableApi(url: string): Promise<Lookup> {
  try {
    const query = new URLSearchParams({ url, timestamp: stamp(new Date()) });
    const response = await fetch(`https://archive.org/wayback/available?${query}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { archived_snapshots?: { closest?: { url?: string; timestamp?: string; available?: boolean } } };
    const closest = body.archived_snapshots?.closest;
    if (!closest?.url || !closest.timestamp || closest.available === false) return null;
    return { url: closest.url.replace(/^http:/, "https:"), timestamp: closest.timestamp };
  } catch {
    return undefined;
  }
}

// available 接口比 CDX 更容易被限流，被挡掉时换 CDX 问同一件事（取最后一条 200 的抓取）。
async function cdxApi(url: string): Promise<Lookup> {
  try {
    const query = new URLSearchParams({ url, output: "json", limit: "-1", fl: "timestamp,original", filter: "statuscode:200" });
    const response = await fetch(`https://web.archive.org/cdx/search/cdx?${query}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": UA },
    });
    if (!response.ok) return undefined;
    const text = (await response.text()).trim();
    if (!text) return null;
    const rows = JSON.parse(text) as string[][];
    const last = rows.at(-1);
    if (!last || !/^\d{14}$/.test(last[0] ?? "") || !last[1]) return null;
    return { url: `https://web.archive.org/web/${last[0]}/${last[1]}`, timestamp: last[0]! };
  } catch {
    return undefined;
  }
}

async function existingSnapshot(url: string): Promise<Lookup> {
  const first = await availableApi(url);
  if (first !== undefined) return first;
  return await cdxApi(url);
}

// 匿名 Save Page Now：响应会跳到（或在头里给出）新快照的地址。
async function saveAnonymous(url: string) {
  let response: Response;
  try {
    response = await fetch(`https://web.archive.org/save/${url}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      headers: { "User-Agent": UA },
    });
  } catch (error) {
    if (isTimeout(error)) throw new Transient(`提交超时（${SAVE_TIMEOUT_MS / 1_000} 秒没响应）`, "timeout");
    throw new Transient(`连不上 Wayback：${brief(error)}`, "other");
  }
  if (response.status === 429) throw new RateLimited(retryAfterMs(response));
  if (response.status === 523) throw new Transient("Wayback 连不上源站（HTTP 523）", "unreachable");
  if (response.status >= 500) throw new Transient(`Wayback 服务端出错（HTTP ${response.status}）`, "server");
  const located = response.headers.get("content-location");
  const capture = SNAPSHOT.exec(response.url)?.[0] ?? (located ? `https://web.archive.org${located}` : null);
  if (!capture) throw new Error(`没有拿到快照地址（HTTP ${response.status}）`);
  return capture;
}

// SPN2 with keys: submit, then poll the job until it finishes.
async function saveWithKeys(url: string) {
  const headers = { Authorization: key!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
  let submit: Response;
  try {
    submit = await fetch("https://web.archive.org/save", {
      method: "POST",
      headers,
      body: new URLSearchParams({ url, skip_first_archive: "1" }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (isTimeout(error)) throw new Transient("提交超时（60 秒没响应）", "timeout");
    throw new Transient(`连不上 Wayback：${brief(error)}`, "other");
  }
  if (submit.status === 429) throw new RateLimited(retryAfterMs(submit));
  if (submit.status === 523) throw new Transient("Wayback 连不上源站（HTTP 523）", "unreachable");
  if (submit.status >= 500) throw new Transient(`Wayback 服务端出错（HTTP ${submit.status}）`, "server");
  const job = (await submit.json().catch(() => ({}))) as { job_id?: string; message?: string };
  if (!job.job_id) {
    const message = job.message || `提交失败（HTTP ${submit.status}）`;
    if (/too many|rate limit/i.test(message)) throw new RateLimited(null);
    throw new Error(message);
  }
  for (let i = 0; i < 24; i += 1) {
    await Bun.sleep(5_000);
    const status = (await fetch(`https://web.archive.org/save/status/${job.job_id}`, { headers, signal: AbortSignal.timeout(30_000) })
      .then((r) => r.json())
      .catch(() => ({}))) as { status?: string; status_ext?: string; timestamp?: string; original_url?: string; message?: string };
    if (status.status === "success" && status.timestamp) return `https://web.archive.org/web/${status.timestamp}/${status.original_url ?? url}`;
    if (status.status === "error") {
      const detail = `${status.status_ext ?? ""} ${status.message || "Wayback 抓取失败"}`.trim();
      if (/too-many|too many|rate limit/i.test(detail)) throw new RateLimited(null);
      if (/523/.test(detail)) throw new Transient(detail, "unreachable");
      if (/50[0234]|bad-gateway|proxy|gateway|celery|service unavailable/i.test(detail)) throw new Transient(detail, "server");
      if (/timeout|timed out|read error|connection/i.test(detail)) throw new Transient(detail, "timeout");
      throw new Error(status.message || "Wayback 抓取失败");
    }
  }
  throw new Transient("等了 2 分钟还没完成", "timeout");
}

type Submitted =
  | { kind: "saved"; capture: string }
  | { kind: "failed"; message: string; reason: Reason }
  | { kind: "limited" }
  | { kind: "out-of-time" };

// 一个网址的完整提交：限流就冷却后原地再来，暂时性失败就退避重试，真失败才返回原因。
async function submitOnce(url: string): Promise<Submitted> {
  let tried = 0;
  let cooldowns = 0;
  while (true) {
    if (!(await hold(lastSubmitAt + pace.gap - Date.now(), `每 ${secs(pace.gap)} 秒 1 个的节奏`))) return { kind: "out-of-time" };
    lastSubmitAt = Date.now();
    try {
      const capture = key ? await saveWithKeys(url) : await saveAnonymous(url);
      pace.ok();
      return { kind: "saved", capture };
    } catch (error) {
      if (error instanceof RateLimited) {
        const stop = pace.limited(error.retryAfterMs);
        cooledMs += stop;
        cooldowns += 1;
        console.log(`  被限流 · 间隔放慢到 ${secs(pace.gap)} 秒，冷却 ${Math.round(stop / 1_000)} 秒后接着跑`);
        if (!(await hold(stop, "限流冷却"))) return { kind: "out-of-time" };
        if (cooldowns >= COOLDOWNS_PER_URL) return { kind: "limited" };
        continue;
      }
      const { message, reason } = describe(error);
      if (!(error instanceof Transient)) return { kind: "failed", message, reason };
      const delay = RETRY_DELAYS_MS[tried];
      tried += 1;
      if (delay === undefined) return { kind: "failed", message, reason };
      console.log(`  暂时失败（${message.slice(0, 80)}）· ${Math.round(delay / 1_000)} 秒后再试第 ${tried + 1} 次`);
      if (!(await hold(delay, "退避重试"))) return { kind: "out-of-time" };
    }
  }
}

async function record(url: string, capture: string) {
  if (dryRun) return;
  await sql`UPDATE sources SET wayback_url = ${capture}, wayback_at = now(), wayback_error = NULL WHERE url = ${url}`;
}

async function main() {
  await migrate();
  const rows = await sql<{ url: string }[]>`
    SELECT url FROM sources
    WHERE http_status < 400 AND wayback_url IS NULL
      AND (wayback_error IS NULL OR wayback_at < now() - interval '7 days')
    GROUP BY url
    ORDER BY max(fetched_at) DESC
    LIMIT ${limit}
  `;
  console.log(
    `待处理 ${rows.length} 个网址 · ${key ? "SPN2（有 key）" : "匿名 /save/"} · 起步每 ${secs(START_GAP_MS)} 秒 1 个 · 上限 ${maxMinutes} 分钟${dryRun ? " · 试运行（不提交、不写库）" : ""}`,
  );

  const startedAt = Date.now();
  const stats = { saved: 0, reused: 0, stale: 0, failed: 0, limited: 0, pending: 0 };
  const failures: Record<Reason, number> = { unreachable: 0, server: 0, timeout: 0, other: 0 };
  let handled = 0;
  let stopped: string | null = null;

  // 第一趟只查已有快照。查询走的是另一套接口，提交被限流时它照样能用，
  // 所以先把「不用提交」的捡干净，剩下的时间再花在提交上。
  const queue: { url: string; existing: Snapshot | null }[] = [];
  for (const [index, { url }] of rows.entries()) {
    if (index && !(await hold(LOOKUP_GAP_MS, "查已有快照"))) {
      stopped = `到了 ${maxMinutes} 分钟上限（还在查已有快照）`;
      break;
    }
    const head = `[${index + 1}/${rows.length}] ${url.slice(0, 110)}`;
    const existing = await existingSnapshot(url);
    const age = existing ? daysOld(existing.timestamp) : Infinity;
    if (existing && age <= FRESH_DAYS) {
      await record(url, existing.url);
      stats.reused += 1;
      handled += 1;
      console.log(`${head}\n  已有 ${Math.round(age)} 天前的快照，直接用 → ${existing.url}`);
      continue;
    }
    console.log(`${head}\n  ${existing ? `只有 ${Math.round(age)} 天前的旧快照` : existing === null ? "Wayback 上还没有" : "查不到已有快照（接口没答）"}，排队提交`);
    queue.push({ url, existing: existing ?? null });
  }
  stats.pending = queue.length;

  if (!dryRun && queue.length) console.log(`\n要提交 ${queue.length} 个 · 每 ${secs(pace.gap)} 秒 1 个起步`);
  let inARow = 0;
  for (const [index, { url, existing }] of (dryRun ? [] : queue).entries()) {
    if (Date.now() >= deadline) {
      stopped = `到了 ${maxMinutes} 分钟上限`;
      break;
    }
    // 一次都没成过、又连着栽了这么多个，说明是提交这条路整体不通（archive.org 掐连接或封了出口 IP），
    // 继续试只是把时间和后面网址的 7 天冷却一起浪费掉。
    if (!stats.saved && inARow >= GIVE_UP_AFTER) {
      stopped = `提交连着 ${inARow} 个都没通，这轮一个也没成，先收工`;
      break;
    }
    console.log(`提交 [${index + 1}/${queue.length}] ${url.slice(0, 110)}`);
    const result = await submitOnce(url);
    if (result.kind === "out-of-time") {
      stopped = `到了 ${maxMinutes} 分钟上限`;
      break;
    }
    handled += 1;
    inARow = result.kind === "saved" ? 0 : inARow + 1;
    if (result.kind === "saved") {
      await record(url, result.capture);
      stats.saved += 1;
      console.log(`  存档成功 → ${result.capture}`);
      continue;
    }
    if (result.kind === "limited") {
      // 限流不是这个网址的问题，不记 wayback_error，下次还排它。
      stats.limited += 1;
      console.log("  连着被限流，这个先放回队列");
      continue;
    }
    if (existing) {
      // 提交不上，但旧快照也能证明「这个页面当时存在」，比留空好。
      await record(url, existing.url);
      stats.stale += 1;
      console.log(`  提交失败（${result.message.slice(0, 80)}），退回 ${Math.round(daysOld(existing.timestamp))} 天前的旧快照 → ${existing.url}`);
      continue;
    }
    failures[result.reason] += 1;
    stats.failed += 1;
    await sql`UPDATE sources SET wayback_error = ${result.message.slice(0, 300)}, wayback_at = now() WHERE url = ${url}`;
    console.log(`  失败 · ${REASON_ZH[result.reason]} · ${result.message.slice(0, 120)}`);
  }

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  if (stopped) console.log(`提前收工：${stopped}`);
  console.log(
    [
      `完成 · 处理 ${handled}/${rows.length} · 用时 ${minutes} 分钟`,
      dryRun
        ? `会复用已有快照 ${stats.reused} · 会提交 ${stats.pending}`
        : `新存档 ${stats.saved} · 复用近 ${FRESH_DAYS} 天快照 ${stats.reused} · 退回旧快照 ${stats.stale} · 失败 ${stats.failed} · 限流放回 ${stats.limited} · 没排到 ${stats.pending - stats.saved - stats.stale - stats.failed - stats.limited}`,
    ].join("\n"),
  );
  if (stats.failed) {
    const detail = (Object.keys(failures) as Reason[]).filter((r) => failures[r]).map((r) => `${REASON_ZH[r]} ${failures[r]}`);
    console.log(`失败原因：${detail.join("、")}（都记了 wayback_error，7 天后再试）`);
  }
  if (!dryRun) console.log(`节奏 · 收尾间隔 ${secs(pace.gap)} 秒 · 最慢到过 ${secs(pace.slowest)} 秒 · 累计冷却 ${Math.round(cooledMs / 1_000)} 秒`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
