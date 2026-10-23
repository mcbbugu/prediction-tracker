// bun --env-file=.env run src/tools/replay.ts -- --job=<id> [--model=<名字>] [--prompt=<版本>]
// 用缓存重跑一个分析任务里已经记下的模型调用。不加 --model / --prompt 时，输出必须和库里的主张、判定、利益关系一致。
// 换模型或提示词版本时不写主张，只打印差异：新增、消失、改判。
import { arkJson, arkSearch, contentAddress, sha256Text, type ModelCallSpec } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

export const PROMPT_PATCH: Record<string, string> = {
  EXTRACT_V2: "\n拿不准的句子不要收。",
  JUDGE_V2: "\n证据不够就写证据不足，不要推测。",
};

type Db = any;

type Stored = {
  id: string;
  model: string;
  prompt_version: string;
  prompt: string;
  params: unknown;
  input: unknown;
  output_text: string;
  output_hash: string;
  kind: string;
};

type ClaimRow = { id: string; quote_original: string; quote_en: string; quote_zh: string; model_call_id: string };
type ProposalRow = { id: number; claim_id: string; status: string; model_call_id: string };
type InterestRow = { id: number; quote: string; model_call_id: string };

function family(version: string) {
  return version.replace(/_V\d+$/, "");
}

export function alternateSpec(row: Pick<Stored, "model" | "prompt" | "prompt_version" | "params" | "input">, opts: { model?: string; prompt?: string }): Pick<ModelCallSpec, "model" | "prompt" | "promptVersion" | "params" | "input"> {
  const promptVersion = opts.prompt && family(row.prompt_version) === family(opts.prompt) ? opts.prompt : row.prompt_version;
  const prompt = promptVersion === row.prompt_version ? row.prompt : `${row.prompt}${PROMPT_PATCH[promptVersion] ?? ""}`;
  return { model: opts.model ?? row.model, prompt, promptVersion, params: row.params, input: row.input };
}

function parseOutput(text: string) {
  return JSON.parse(text) as unknown;
}

function claimQuotes(output: unknown) {
  if (!output || typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  const quotes: string[] = [];
  for (const key of ["claims", "relations"]) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const quote = String(row.quote ?? row.quote_en ?? row.quote_zh ?? "").trim();
      if (quote) quotes.push(quote);
    }
  }
  return quotes;
}

function verdicts(input: unknown, output: unknown) {
  if (!output || typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  if (typeof record.status !== "string" || !record.status) return [];
  if (Array.isArray(record.claims) || Array.isArray(record.relations)) return [];
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      parsed = input;
    }
  }
  const claim = parsed && typeof parsed === "object" ? (parsed as { claim?: Record<string, unknown> }).claim : null;
  const quote = String(claim?.quote_en ?? claim?.quote_zh ?? claim?.quote ?? "").trim();
  return [{ quote, status: record.status }];
}

function snippet(quote: string) {
  return quote.replace(/\s+/g, " ").slice(0, 80);
}

async function loadCalls(ids: string[], db: Db): Promise<Stored[]> {
  if (!ids.length) return [];
  const rows = await db`
    SELECT id, model, prompt_version, prompt, params, input, output_text, output_hash, kind
    FROM model_calls WHERE id IN ${db(ids)}
  `;
  return rows as Stored[];
}

async function outputFor(row: Stored, opts: { model?: string; prompt?: string }, db: Db) {
  const spec = alternateSpec(row, opts);
  const id = contentAddress(spec);
  if (id === row.id) return parseOutput(row.output_text);
  const hit = (await db`SELECT output_text FROM model_calls WHERE id = ${id} AND output_text IS NOT NULL`) as { output_text: string }[];
  if (hit.length) return parseOutput(hit[0].output_text);
  const previousModel = process.env.ARK_MODEL;
  const previousDay = process.env.ARK_CACHE_DAY;
  process.env.ARK_MODEL = spec.model;
  try {
    if (row.kind === "search") {
      const input = row.input as { query?: string; day?: string };
      if (input?.day) process.env.ARK_CACHE_DAY = input.day;
      return await arkSearch(String(input?.query ?? ""), spec.promptVersion);
    }
    const maxTokens = Number((row.params as { max_tokens?: number } | null)?.max_tokens ?? 2000);
    const user = typeof row.input === "string" ? row.input : JSON.stringify(row.input);
    return await arkJson(spec.prompt, user, maxTokens, spec.promptVersion);
  } finally {
    if (previousModel === undefined) delete process.env.ARK_MODEL;
    else process.env.ARK_MODEL = previousModel;
    if (previousDay === undefined) delete process.env.ARK_CACHE_DAY;
    else process.env.ARK_CACHE_DAY = previousDay;
  }
}

function diffReport(before: Stored[], after: { input: unknown; output: unknown }[], label: string) {
  const oldQuotes = new Set(before.flatMap((row) => claimQuotes(parseOutput(row.output_text))));
  const newQuotes = new Set(after.flatMap((row) => claimQuotes(row.output)));
  const oldVerdicts = new Map(before.flatMap((row) => verdicts(row.input, parseOutput(row.output_text)).map((item) => [item.quote, item.status] as const)));
  const newVerdicts = new Map(after.flatMap((row) => verdicts(row.input, row.output).map((item) => [item.quote, item.status] as const)));
  const added = [...newQuotes].filter((quote) => !oldQuotes.has(quote));
  const removed = [...oldQuotes].filter((quote) => !newQuotes.has(quote));
  const changed: string[] = [];
  for (const [quote, status] of oldVerdicts) {
    const next = newVerdicts.get(quote);
    if (next && next !== status) changed.push(`${snippet(quote) || "（没有原话）"}：${status} → ${next}`);
  }
  const lines = [`差异报告（${label}）`, "新增主张", ...(added.length ? added.map((quote) => `- ${snippet(quote)}`) : ["（无）"]), "消失主张", ...(removed.length ? removed.map((quote) => `- ${snippet(quote)}`) : ["（无）"]), "改判", ...(changed.length ? changed.map((line) => `- ${line}`) : ["（无）"])];
  return lines.join("\n");
}

export async function replayJob(jobId: string, opts: { model?: string; prompt?: string; db?: Db } = {}) {
  const db = opts.db ?? sql;
  const jobs = (await db`
    SELECT id::text AS id, person_id, query FROM jobs WHERE id = ${jobId}
  `) as { id: string; person_id: string | null; query: string }[];
  const job = jobs[0];
  if (!job) return `找不到任务 ${jobId}`;
  if (!job.person_id) return `任务 ${jobId} 没有人物，没法对照库里的产物`;

  const claims = (await db`
    SELECT id, quote_original, quote_en, quote_zh, model_call_id
    FROM claims WHERE person_id = ${job.person_id} AND model_call_id IS NOT NULL
  `) as ClaimRow[];
  const proposals = (await db`
    SELECT id::int AS id, claim_id, status, model_call_id
    FROM verdict_proposals WHERE person_id = ${job.person_id} AND model_call_id IS NOT NULL
  `) as ProposalRow[];
  const interests = (await db`
    SELECT id::int AS id, quote, model_call_id
    FROM interests WHERE person_id = ${job.person_id} AND model_call_id IS NOT NULL
  `) as InterestRow[];
  const ids = [...new Set([...claims.map((row) => row.model_call_id), ...proposals.map((row) => row.model_call_id), ...interests.map((row) => row.model_call_id)])];
  if (!ids.length) return "这个任务没有可重放的模型调用。主张、判定和利益关系上还没有 model_call_id（缓存上线之前的任务就是这样）。";

  const calls = await loadCalls(ids, db);
  const byId = new Map(calls.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return `缓存里缺少模型调用 ${missing.map((id) => id.slice(0, 12)).join("、")}`;

  if (opts.model || opts.prompt) {
    const produced: { input: unknown; output: unknown }[] = [];
    for (const row of calls) produced.push({ input: row.input, output: await outputFor(row, opts, db) });
    const label = [opts.model ? `模型 ${opts.model}` : "", opts.prompt ? `提示词 ${opts.prompt}` : ""].filter(Boolean).join("，");
    return diffReport(calls, produced, label);
  }

  const problems: string[] = [];
  for (const row of calls) {
    if (!row.output_text || sha256Text(row.output_text) !== row.output_hash) problems.push(`输出哈希不一致 ${row.id.slice(0, 12)}`);
    else if (JSON.stringify(parseOutput(row.output_text)) !== row.output_text) problems.push(`输出不是逐字节 JSON ${row.id.slice(0, 12)}`);
  }
  for (const claim of claims) {
    const row = byId.get(claim.model_call_id);
    if (!row) continue;
    const quotes = claimQuotes(parseOutput(row.output_text));
    const needles = [claim.quote_original, claim.quote_en, claim.quote_zh].map((quote) => quote.trim()).filter(Boolean);
    if (!needles.some((needle) => quotes.includes(needle))) problems.push(`主张 ${claim.id} 的原话不在模型输出里`);
  }
  for (const proposal of proposals) {
    const row = byId.get(proposal.model_call_id);
    if (!row) continue;
    const found = verdicts(row.input, parseOutput(row.output_text));
    if (!found.some((item) => item.status === proposal.status)) problems.push(`判定 ${proposal.claim_id} 库里是 ${proposal.status}，缓存对不上`);
  }
  for (const interest of interests) {
    const row = byId.get(interest.model_call_id);
    if (!row) continue;
    if (!claimQuotes(parseOutput(row.output_text)).includes(interest.quote.trim())) problems.push(`利益关系 #${interest.id} 的原话不在模型输出里`);
  }
  if (!problems.length) return "一致";
  return problems.join("\n");
}

async function main() {
  const job = arg("job");
  if (!job) {
    console.error("需要 --job=<id>");
    process.exitCode = 1;
    return;
  }
  await migrate();
  console.log(await replayJob(job, { model: arg("model"), prompt: arg("prompt") }));
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
