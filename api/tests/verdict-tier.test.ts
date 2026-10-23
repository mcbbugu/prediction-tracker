import { describe, expect, test } from "bun:test";
import { sql } from "../src/core/db";
import { admitAnalyze, hashClientIp } from "../src/jobs/analyze-limit";
import { challengeReview, verdictTier } from "../src/queries/verdict-tier";

describe("判定来源层级", () => {
  test("人工裁定、种子自动核对、按需分析和其余机器判定分开", () => {
    expect(verdictTier({ status: "待定", provenance: "manual" })).toBeNull();
    expect(verdictTier({ status: "已兑现", provenance: "manual", events: [{ action: "imported" }] })).toBe("human");
    expect(verdictTier({ status: "已兑现", provenance: "manual", events: [{ action: "seed_autochecked" }] })).toBe("seed_autocheck");
    expect(verdictTier({ status: "未兑现", provenance: "agent", events: [{ action: "verdict_accepted", actor: "reviewer" }] })).toBe("human");
    expect(verdictTier({ status: "已兑现", provenance: "agent", events: [{ action: "proposed", note: "按需分析 · 机器核对后公开" }] })).toBe("on_demand");
    expect(verdictTier({ status: "已兑现", provenance: "agent", events: [{ action: "verdict_auto_applied" }] })).toBe("machine");
  });

  test("反证复核：结论变了标有争议，没变就说明结论不变", () => {
    expect(challengeReview("已兑现", "未兑现").label).toBe("有争议");
    expect(challengeReview("已兑现", "已兑现").label).toBe("已复核，结论不变");
  });
});

describe("分析名额并发", () => {
  test("并发 10 个请求不超过单 IP 上限", async () => {
    const clientIp = hashClientIp(`198.51.100.${Date.now() % 200}`, "race-salt");
    const stamp = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => admitAnalyze({ query: `race-${stamp}-${index}`, clientIp, dailyLimit: 10_000 })),
    );
    const created = results.flatMap((result) => (!("error" in result) && !result.reused ? [result.job_id] : []));
    expect(created.length).toBe(3);
    expect(results.filter((result) => "error" in result && result.error === "ip").length).toBe(7);
    const ids = created;
    if (ids.length) {
      await sql`UPDATE jobs SET created_at = now() - interval '30 days', state = 'failed' WHERE id IN ${sql(ids)}`;
    }
  });
});
