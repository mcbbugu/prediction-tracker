import { describe, expect, test } from "bun:test";
import { sql } from "../src/core/db";
import { clientAddress, hashClientIp, ipAnalyzeAllowed, queuePosition, recentAnalyzeCount } from "../src/jobs/analyze-limit";

describe("按需分析限流", () => {
  test("不信任代理时忽略 X-Forwarded-For，信任时只用第一个地址", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.1" });
    expect(clientAddress(headers, false, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientAddress(headers, true, "127.0.0.1")).toBe("203.0.113.8");
  });

  test("哈希不等于明文，换盐就变", () => {
    const hash = hashClientIp("203.0.113.8", "salt-a");
    expect(hash).not.toContain("203.0.113.8");
    expect(hash).not.toBe(hashClientIp("203.0.113.8", "salt-b"));
  });

  test("同一 IP 第 4 次被拒，另一个 IP 不受影响", async () => {
    const home = hashClientIp("203.0.113.8", "test-salt");
    const other = hashClientIp("203.0.113.9", "test-salt");
    try {
      await sql.begin(async (tx) => {
        for (let i = 0; i < 3; i++) {
          await tx`INSERT INTO jobs (kind, query, runner, client_ip) VALUES ('analyze_person', ${`limit-test-${i}`}, 'api', ${home})`;
        }
        expect(ipAnalyzeAllowed(await recentAnalyzeCount(tx, home))).toBe(false);
        expect(ipAnalyzeAllowed(await recentAnalyzeCount(tx, other))).toBe(true);
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    }
  });

  test("排队位置按创建顺序，跑着的任务算在前面", async () => {
    try {
      await sql.begin(async (tx) => {
        const [already] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM jobs WHERE kind = 'analyze_person' AND runner = 'api' AND state = 'running'
        `;
        const [running] = await tx<{ id: string }[]>`
          INSERT INTO jobs (kind, query, runner, state, created_at)
          VALUES ('analyze_person', 'queue-running', 'api', 'running', clock_timestamp()) RETURNING id
        `;
        const [first] = await tx<{ id: string }[]>`
          INSERT INTO jobs (kind, query, runner, state, created_at)
          VALUES ('analyze_person', 'queue-first', 'api', 'queued', clock_timestamp()) RETURNING id
        `;
        const [second] = await tx<{ id: string }[]>`
          INSERT INTO jobs (kind, query, runner, state, created_at)
          VALUES ('analyze_person', 'queue-second', 'api', 'queued', clock_timestamp() + interval '1 second') RETURNING id
        `;
        expect(await queuePosition(tx, running.id)).toBe(0);
        expect(await queuePosition(tx, first.id)).toBe(already.n + 1);
        expect(await queuePosition(tx, second.id)).toBe(already.n + 2);
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    }
  });
});
