import { describe, expect, test } from "bun:test";
import { classifyArkError } from "../src/core/ark";

describe("classifyArkError", () => {
  test("网络：连不上、超时、DNS", () => {
    expect(classifyArkError("NETWORK: URLError: [Errno 61] Connection refused")).toBe("network");
    expect(classifyArkError("The read operation timed out")).toBe("network");
    expect(classifyArkError("ConnectionRefusedError")).toBe("network");
    expect(classifyArkError("ConnectionResetError")).toBe("network");
    expect(classifyArkError("IncompleteRead")).toBe("network");
    expect(classifyArkError("Name or service not known")).toBe("network");
    expect(classifyArkError("Temporary failure in name resolution")).toBe("network");
    expect(classifyArkError("Network is unreachable")).toBe("network");
  });

  test("服务端：5xx、Bad Gateway、服务不可用", () => {
    expect(classifyArkError("InternalServerError")).toBe("server");
    expect(classifyArkError("InternalServiceError")).toBe("server");
    expect(classifyArkError("ServiceUnavailable")).toBe("server");
    expect(classifyArkError("Bad Gateway")).toBe("server");
    expect(classifyArkError("HTTP 500")).toBe("server");
    expect(classifyArkError("HTTP 502")).toBe("server");
    expect(classifyArkError("HTTP 503")).toBe("server");
    expect(classifyArkError("HTTP 504")).toBe("server");
  });

  test("Gateway Timeout 应算服务端错误，不是我们这边断网", () => {
    expect(classifyArkError("Gateway Timeout")).toBe("server");
    expect(classifyArkError("HTTP 504 Gateway Timeout")).toBe("server");
  });

  test("限流：429、突发过快、ServerOverloaded", () => {
    expect(classifyArkError("RequestBurstTooFast")).toBe("rate");
    expect(classifyArkError("429 Too Many Requests")).toBe("rate");
    expect(classifyArkError("RateLimit")).toBe("rate");
    expect(classifyArkError("ServerOverloaded")).toBe("rate");
  });

  test("拒绝：密钥、权限、欠费、额度", () => {
    expect(classifyArkError("AccessDenied")).toBe("denied");
    expect(classifyArkError("Unauthorized")).toBe("denied");
    expect(classifyArkError("AuthenticationError")).toBe("denied");
    expect(classifyArkError("InvalidApiKey")).toBe("denied");
    expect(classifyArkError("账号欠费，余额不足")).toBe("denied");
    expect(classifyArkError("quota exceeded")).toBe("denied");
  });

  test("其余归请求本身", () => {
    expect(classifyArkError("InvalidParameter: messages is required")).toBe("request");
    expect(classifyArkError("")).toBe("request");
  });
});
