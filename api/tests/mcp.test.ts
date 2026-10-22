import { describe, expect, test } from "bun:test";
import { handleMcp } from "../src/queries/mcp";
import { PRIOR_OUTPUT_SCHEMA } from "../src/queries/prior";

type RpcResult = { jsonrpc: string; id: string | number | null; result: Record<string, unknown> };
type RpcError = { jsonrpc: string; id: string | number | null; error: { code: number; message: string } };

function asResult(response: Awaited<ReturnType<typeof handleMcp>>): RpcResult {
  if (response == null || !("result" in response)) throw new Error("应返回 JSON-RPC result");
  return response as RpcResult;
}

function asError(response: Awaited<ReturnType<typeof handleMcp>>): RpcError {
  if (response == null || !("error" in response)) throw new Error("应返回 JSON-RPC error");
  return response as RpcError;
}

describe("handleMcp", () => {
  test("initialize 收到旧版本号时回同一个版本", async () => {
    for (const protocolVersion of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
      const response = asResult(
        await handleMcp({ jsonrpc: "2.0", id: protocolVersion, method: "initialize", params: { protocolVersion } }),
      );
      expect(response.result.protocolVersion).toBe(protocolVersion);
    }
  });

  test("server/discover 返回当前协议和能力", async () => {
    const response = asResult(await handleMcp({ jsonrpc: "2.0", id: 1, method: "server/discover" }));
    const result = response.result as {
      protocolVersion: string;
      supportedVersions: string[];
      capabilities: { tools: { listChanged: boolean } };
      serverInfo: { name: string };
    };
    expect(result.protocolVersion).toBe("2026-07-28");
    expect(result.supportedVersions).toContain("2026-07-28");
    expect(result.supportedVersions).toContain("2025-03-26");
    expect(result.capabilities.tools.listChanged).toBe(false);
    expect(result.serverInfo.name).toBe("prior-tracker");
  });

  test("tools/list 只有 get_prior，带 ttlMs、inputSchema 和 outputSchema", async () => {
    const response = asResult(await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const result = response.result as {
      ttlMs: number;
      tools: { name: string; inputSchema: { type?: string; required?: string[] }; outputSchema: { type?: string; required?: readonly string[] } }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual(["get_prior"]);
    expect(typeof result.ttlMs).toBe("number");
    expect(result.ttlMs).toBeGreaterThan(0);
    const tool = result.tools[0];
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.required).toContain("person");
    expect(tool.outputSchema.type).toBe("object");
    expect(tool.outputSchema.required).toEqual([...PRIOR_OUTPUT_SCHEMA.required]);
  });

  test("tools/call 的 structuredContent 含 outputSchema 必填字段，content[0].type 为 text", async () => {
    const response = asResult(
      await handleMcp({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_prior", arguments: { person: "musk" } },
      }),
    );
    const result = response.result as {
      isError?: boolean;
      content: { type: string; text: string }[];
      structuredContent: Record<string, unknown>;
    };
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text.length).toBeGreaterThan(0);
    for (const key of PRIOR_OUTPUT_SCHEMA.required) expect(result.structuredContent[key]).toBeDefined();
    expect((result.structuredContent.person as { id: string }).id).toBe("musk");
  });

  test("人物不存在时 isError 为 true，而不是 JSON-RPC 错误", async () => {
    const response = await handleMcp({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_prior", arguments: { person: "no-such-person-zzqq" } },
    });
    const result = asResult(response).result as { isError?: boolean; content: { type: string; text: string }[] };
    expect("error" in (response as object)).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("no-such-person-zzqq");
  });

  test("notifications/* 返回 null", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } })).toBeNull();
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/progress" })).toBeNull();
  });

  test("未知方法返回 -32601", async () => {
    const response = asError(await handleMcp({ jsonrpc: "2.0", id: 5, method: "prompts/list" }));
    expect(response.error.code).toBe(-32601);
  });

  test("未知工具返回 -32602", async () => {
    const response = asError(
      await handleMcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search_web", arguments: {} } }),
    );
    expect(response.error.code).toBe(-32602);
  });
});
