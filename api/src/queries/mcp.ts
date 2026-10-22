// MCP 服务（POST /mcp，JSON-RPC 2.0，无状态）：给别的 AI 一个只读工具 get_prior。
// 按 2026-07-28 规范：没有会话，server/discover 直接给出能力和工具；tools/list 带缓存时长、工具顺序固定；
// tools/call 返回 structuredContent（符合 outputSchema）和一段文字摘要。
// 仍在用旧握手（initialize）的客户端也能连上。
import { PRIOR_OUTPUT_SCHEMA, PriorError, priorAsOf } from "./prior";

const PROTOCOL = "2026-07-28";
const SUPPORTED = [PROTOCOL, "2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER = { name: "prior-tracker", title: "先验 · 公众人物说法的兑现记录", version: "0.1.0" };
const TOOLS_TTL_MS = 60 * 60 * 1000;

const GET_PRIOR = {
  name: "get_prior",
  title: "取一个人在某领域的先验",
  description:
    "在采信一个公众人物的新说法之前，查他在这个领域过去带期限的预测和承诺兑现得怎么样。" +
    "返回 0–100 的兑现率先验、80% 区间、已判定和作废条数、改期率、当时的任职与持股，以及计入分数的原话和出处链接。" +
    "只查库、不调模型；as_of 可查过去某一天的记录。分数只在领域内成立。",
  inputSchema: {
    type: "object",
    properties: {
      person: { type: "string", description: "人物 id、中文名或英文名，例如 musk、埃隆·马斯克、Elon Musk" },
      domain: { type: "string", description: "领域，例如「自动驾驶」；不填则返回所有领域" },
      as_of: { type: "string", format: "date", description: "YYYY-MM-DD，站在这一天看他的记录；不填为今天" },
    },
    required: ["person"],
    additionalProperties: false,
  },
  outputSchema: PRIOR_OUTPUT_SCHEMA,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function summary(data: Awaited<ReturnType<typeof priorAsOf>>) {
  const lines = Object.entries(data.domains).map(([domain, d]) =>
    d.score != null
      ? `${domain}：兑现率先验 ${d.score}（80% 区间 ${d.interval_80?.low}–${d.interval_80?.high}），已判定 ${d.judged} 条，作废 ${d.voided} 条`
      : `${domain}：截至 ${data.as_of} 还没有已判定的主张（作废 ${d.voided} 条）`,
  );
  return `${data.person.name}（截至 ${data.as_of}，公式 ${data.formula_version}）\n${lines.join("\n")}\n详情：${data.person.url}`;
}

async function callTool(id: Rpc["id"], params: Record<string, unknown>) {
  if (params.name !== GET_PRIOR.name) return fail(id, -32602, `没有这个工具：${String(params.name)}`);
  const args = (params.arguments ?? {}) as { person?: string; domain?: string; as_of?: string };
  try {
    const data = await priorAsOf({ person: args.person ?? "", domain: args.domain, as_of: args.as_of });
    return ok(id, { content: [{ type: "text", text: summary(data) }], structuredContent: data });
  } catch (error) {
    // Tool-level failures (unknown person, bad date) are results with isError, so the model can read and retry.
    if (error instanceof PriorError) {
      const hint = error.candidates.length ? `\n候选：${error.candidates.map((c) => `${c.id}（${c.name}）`).join("、")}` : "";
      return ok(id, { content: [{ type: "text", text: `${error.message}${hint}` }], isError: true });
    }
    throw error;
  }
}

// Returns the JSON-RPC response, or null for a notification (HTTP 202, no body).
export async function handleMcp(message: Rpc) {
  const id = message.id;
  const params = message.params ?? {};
  switch (message.method) {
    case "server/discover":
      return ok(id, { protocolVersion: PROTOCOL, supportedVersions: SUPPORTED, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER });
    case "initialize": {
      const asked = String(params.protocolVersion ?? PROTOCOL);
      return ok(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: "调用 get_prior 查一个人在某领域的兑现记录，再决定对他的新说法给多大权重。",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: [GET_PRIOR], ttlMs: TOOLS_TTL_MS });
    case "tools/call":
      return callTool(id, params);
    default:
      if (message.method?.startsWith("notifications/")) return null;
      return fail(id, -32601, `不支持的方法：${message.method}`);
  }
}
