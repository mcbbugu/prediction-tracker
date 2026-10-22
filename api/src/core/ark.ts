import { basename } from "node:path";
import { sql } from "./db";

const base = () => (process.env.ARK_BASE_URL || "").replace(/\/$/, "");

// ---- Shared limiter and AFP budget, across every process that talks to Ark (batch, worker, API, scripts).
// Each call reserves a time slot in ark_calls under one advisory lock, so N processes together keep one pace.
const GAP_MS = {
  search: Number(process.env.ARK_SEARCH_GAP_MS || 2000),
  chat: Number(process.env.ARK_CHAT_GAP_MS || 700),
};
// Web search beyond the free monthly quota is charged from the Agent Plan at 5 AFP per call.
const SEARCH_AFP = Number(process.env.ARK_SEARCH_AFP || 5);
const DAILY_AFP_BUDGET = Number(process.env.AFP_DAILY_BUDGET || 3000);
const caller = basename(process.argv[1] ?? "");

// Every reason to stop calling Ark for now (budget, outage, access) shares one base, so loops that
// swallow per-call errors can still tell "this call failed" from "stop calling".
export class ArkStopped extends Error {}
export class BudgetExceeded extends ArkStopped {}
export type ArkTrouble = "network" | "server" | "denied";
export class ArkUnavailable extends ArkStopped {
  constructor(
    message: string,
    readonly trouble: ArkTrouble,
    readonly retryAt: Date | null = null,
  ) {
    super(message);
  }
}

type CallKind = keyof typeof GAP_MS;

async function reserve(kind: CallKind, path: string) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('ark_calls'))`;
    if (kind === "search") {
      const [{ used }] = await tx<{ used: number }[]>`
        SELECT coalesce(sum(afp), 0)::float8 AS used FROM ark_calls
        WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')
      `;
      if (used + SEARCH_AFP > DAILY_AFP_BUDGET) {
        throw new BudgetExceeded(`AFP 额度：今日预算 ${DAILY_AFP_BUDGET} 已用 ${used}，停止联网搜索（AFP_DAILY_BUDGET 可调）`);
      }
    }
    const [last] = await tx<{ at: Date | null }[]>`SELECT max(slot_at) AS at FROM ark_calls WHERE kind = ${kind}`;
    const slot = Math.max(Date.now(), (last?.at ? new Date(last.at).getTime() : 0) + GAP_MS[kind]);
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO ark_calls (kind, path, caller, slot_at, afp)
      VALUES (${kind}, ${path}, ${caller}, ${new Date(slot)}, ${kind === "search" ? SEARCH_AFP : 0})
      RETURNING id
    `;
    return { id: Number(row.id), wait: slot - Date.now() };
  });
}

async function finish(id: number, ok: boolean, detail: { tokens?: number; error?: string; kind?: ErrorKind }) {
  // A failed call is not charged.
  await sql`
    UPDATE ark_calls SET ok = ${ok}, tokens = ${detail.tokens ?? null}, error = ${detail.error?.slice(0, 300) ?? null},
      error_kind = ${detail.kind ?? null}, afp = CASE WHEN ${ok} THEN afp ELSE 0 END
    WHERE id = ${id}
  `.catch(() => {});
}

// ---- Circuit breaker, shared by every process through ark_calls.
// After BREAKER_STREAK consecutive network/server failures of one kind, calls of that kind stop for 5 minutes;
// each further failed probe doubles the pause (up to 80 minutes). Rate limits and bad requests don't count.
const BREAKER_STREAK = Number(process.env.ARK_BREAKER_STREAK || 8);
const BREAKER_BASE_MS = 5 * 60_000;

export async function breakerState(kind: CallKind) {
  const rows = await sql<{ ok: boolean; error_kind: string | null; created_at: Date }[]>`
    SELECT ok, error_kind, created_at FROM ark_calls
    WHERE kind = ${kind} AND ok IS NOT NULL AND created_at > now() - interval '6 hours'
    ORDER BY created_at DESC
    LIMIT 40
  `;
  let streak = 0;
  for (const row of rows) {
    if (row.ok || (row.error_kind !== "network" && row.error_kind !== "server")) break;
    streak += 1;
  }
  if (streak < BREAKER_STREAK) return { open: false, streak, retryAt: null };
  const pause = BREAKER_BASE_MS * 2 ** Math.min(4, streak - BREAKER_STREAK);
  const retryAt = new Date(new Date(rows[0].created_at).getTime() + pause);
  return { open: retryAt.getTime() > Date.now(), streak, retryAt };
}

const clock = (at: Date) => at.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });

export async function afpUsedToday() {
  const [row] = await sql<{ used: number; searches: number }[]>`
    SELECT coalesce(sum(afp), 0)::float8 AS used, count(*) FILTER (WHERE kind = 'search' AND ok)::int AS searches FROM ark_calls
    WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')
  `;
  return { ...row, budget: DAILY_AFP_BUDGET };
}

export function arkConfigured() {
  return Boolean(process.env.ARK_API_KEY && process.env.ARK_BASE_URL && process.env.ARK_MODEL);
}

// Requests go through python's urllib, which the earlier version found more reliable than Bun's fetch for Ark.
const transport = `
import json, os, sys, urllib.request, urllib.error
payload = json.load(sys.stdin)
req = urllib.request.Request(
    os.environ["ARK_BASE_URL"].rstrip("/") + os.environ["ARK_PATH"],
    data=json.dumps(payload).encode(),
    headers={
        "Authorization": "Bearer " + os.environ["ARK_API_KEY"],
        "Content-Type": "application/json",
    },
)
try:
    with urllib.request.urlopen(req, timeout=240) as resp:
        sys.stdout.write(resp.read().decode())
except urllib.error.HTTPError as exc:
    sys.stdout.write(exc.read().decode(errors="replace") or "HTTP %s" % exc.code)
    raise SystemExit(1)
except Exception as exc:
    # Connection refused/reset, DNS, timeouts, truncated reads: one line, so the cause survives in ark_calls.
    sys.stdout.write("NETWORK: %s: %s" % (type(exc).__name__, exc))
    raise SystemExit(3)
`;

// Ark answers bursts with RequestBurstTooFast / 429; those clear after a pause, so wait and retry.
const RETRYABLE = /RequestBurstTooFast|request burst|429|Too Many Requests|RateLimit|ServerOverloaded/i;
const BACKOFF_SECONDS = [15, 30, 60, 120];
// Network and server failures get a short retry; if they persist, callers are told to stop (ArkUnavailable).
const OUTAGE_BACKOFF_SECONDS = [5, 15, 30];

export type ErrorKind = "network" | "server" | "rate" | "denied" | "request";

export function classifyArkError(message: string): ErrorKind {
  // Server-side failures first: "Gateway Timeout" (504) is Ark's side, not our network, even though it says timeout.
  if (/InternalServiceError|InternalServerError|ServiceUnavailable|Bad Gateway|Gateway Timeout|HTTP 50[0234]/i.test(message)) return "server";
  if (/NETWORK:|URLError|timed out|timeout|Connection(Refused|Reset|Aborted)?Error|RemoteDisconnected|IncompleteRead|Name or service not known|nodename nor servname|Temporary failure in name resolution|Network is unreachable/i.test(message)) {
    return "network";
  }
  if (RETRYABLE.test(message)) return "rate";
  if (/AccessDenied|Access denied|Unauthorized|AuthenticationError|InvalidApiKey|InvalidAccessKey|AccountOverdue|欠费|余额不足|quota/i.test(message)) return "denied";
  return "request";
}

export async function arkPost(path: string, payload: Record<string, unknown>) {
  const kind: CallKind = path.includes("/responses") ? "search" : "chat";
  const label = kind === "search" ? "联网搜索" : "模型调用";
  for (let attempt = 0; ; attempt += 1) {
    const breaker = await breakerState(kind);
    if (breaker.open && breaker.retryAt) {
      throw new ArkUnavailable(`方舟${label}连续 ${breaker.streak} 次网络或服务端失败，暂停到 ${clock(breaker.retryAt)}`, "network", breaker.retryAt);
    }
    const slot = await reserve(kind, path);
    if (slot.wait > 0) await Bun.sleep(slot.wait);
    try {
      const body = await arkPostOnce(path, payload);
      const usage = (body as { usage?: { total_tokens?: number } }).usage;
      await finish(slot.id, true, { tokens: usage?.total_tokens });
      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorKind = classifyArkError(message);
      await finish(slot.id, false, { error: message, kind: errorKind });
      if (errorKind === "denied") throw new ArkUnavailable(`方舟拒绝了${label}（开通状态、权限或额度）：${message.slice(0, 200)}`, "denied");
      if (errorKind === "rate" && attempt < BACKOFF_SECONDS.length) {
        await Bun.sleep(BACKOFF_SECONDS[attempt] * 1000);
        continue;
      }
      if (errorKind === "network" || errorKind === "server") {
        if (attempt >= OUTAGE_BACKOFF_SECONDS.length) {
          throw new ArkUnavailable(`方舟${label}连续 ${attempt + 1} 次${errorKind === "network" ? "网络" : "服务端"}失败：${message.slice(0, 160)}`, errorKind);
        }
        await Bun.sleep(OUTAGE_BACKOFF_SECONDS[attempt] * 1000);
        continue;
      }
      throw error;
    }
  }
}

async function arkPostOnce(path: string, payload: Record<string, unknown>) {
  if (!arkConfigured()) throw new Error("缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL");
  const child = Bun.spawn(["python3", "-c", transport], {
    env: {
      ...process.env,
      ARK_API_KEY: process.env.ARK_API_KEY || "",
      ARK_BASE_URL: base(),
      ARK_PATH: path,
    },
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${path}: ${(stdout.trim() || stderr.trim() || "Ark 调用失败").slice(0, 600)}`);
  const body = JSON.parse(stdout) as Record<string, unknown> & { error?: { message?: string } };
  if (body.error?.message) throw new Error(`${path}: ${body.error.message}`);
  return body;
}

export async function arkJson(system: string, user: string, maxTokens = 2000) {
  const body = (await arkPost("/chat/completions", {
    model: process.env.ARK_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    max_tokens: maxTokens,
  })) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content || "";
  if (!content) throw new Error("Ark 没有返回正文");
  return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
}

export type SearchResult = { text: string; urls: string[]; raw: unknown };

function collectUrls(value: unknown, into: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s<>"'）)\]】，。]+/g)) into.add(match[0].replace(/[.,;:]+$/, ""));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, into);
  }
}

function collectCitations(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectCitations(item, into);
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "url_citation" && typeof record.url === "string") into.add(record.url);
    for (const item of Object.values(record)) if (typeof item === "object") collectCitations(item, into);
  }
}

function collectText(value: unknown, into: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, into);
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "output_text" && typeof record.text === "string") into.push(record.text);
    for (const item of Object.values(record)) if (typeof item === "object") collectText(item, into);
  }
}

// Web search through Ark's Responses API. The model's answer is only used to find candidate links;
// whatever it says about them is never trusted directly (see verify.ts).
export async function arkSearch(query: string): Promise<SearchResult> {
  const body = await arkPost("/responses", {
    model: process.env.ARK_MODEL,
    input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
    tools: [{ type: "web_search", max_keyword: 3 }],
    thinking: { type: "disabled" },
  });
  const texts: string[] = [];
  collectText(body.output, texts);
  // url_citation annotations come from the search tool itself; links the model writes into its answer
  // are often reconstructed from memory and 404. Cited links go first so callers that cap the list keep them.
  const cited = new Set<string>();
  collectCitations(body.output, cited);
  const urls = new Set<string>(cited);
  collectUrls(body.output, urls);
  return {
    text: texts.join("\n").trim(),
    urls: [...urls].filter((url) => !/volces\.com|volcengine\.com|bytedance\.com\/.*search/.test(url)),
    raw: body,
  };
}

// ---- Preflight: before a worker or batch script takes work, make sure chat, web search and plain page
// fetching all work. Search is only exercised when nothing has succeeded in the last 30 minutes (it costs AFP).
export async function arkPreflight({ search = true }: { search?: boolean } = {}) {
  const problems: string[] = [];
  if (!arkConfigured()) return { ok: false, problems: ["缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL（api/.env）"] };
  const run = async (label: string, check: () => Promise<unknown>) => {
    try {
      await check();
    } catch (error) {
      problems.push(`${label}：${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
    }
  };
  await run("模型调用", () =>
    arkPost("/chat/completions", {
      model: process.env.ARK_MODEL,
      messages: [{ role: "user", content: "ping" }],
      thinking: { type: "disabled" },
      max_tokens: 1,
    }),
  );
  if (search) {
    const [recent] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ark_calls WHERE kind = 'search' AND ok AND created_at > now() - interval '30 minutes'
    `;
    if (recent.n === 0) await run("联网搜索", () => arkSearch("SEC EDGAR full-text search"));
  }
  await run("打开网页", async () => {
    const response = await fetch("https://en.wikipedia.org/wiki/Special:Version", { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });
  return { ok: problems.length === 0, problems };
}
