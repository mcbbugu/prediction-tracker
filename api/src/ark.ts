const base = () => (process.env.ARK_BASE_URL || "").replace(/\/$/, "");

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
    sys.stdout.write(exc.read().decode())
    raise SystemExit(1)
`;

// Ark answers bursts with RequestBurstTooFast / 429; those clear after a pause, so wait and retry.
const RETRYABLE = /RequestBurstTooFast|request burst|429|Too Many Requests|RateLimit|ServerOverloaded/i;
const BACKOFF_SECONDS = [15, 30, 60, 120];

export async function arkPost(path: string, payload: Record<string, unknown>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await arkPostOnce(path, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= BACKOFF_SECONDS.length || !RETRYABLE.test(message)) throw error;
      await Bun.sleep(BACKOFF_SECONDS[attempt] * 1000);
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
