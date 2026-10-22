import { describe, expect, test } from "bun:test";
import { betaQuantile, scoreDomain, type ScoredRow } from "../src/scoring/score";

// 期限就在 now 当天，时间衰减权重是 1。先验是 Beta(4 × 0.5, 4 × 0.5) = Beta(2, 2)，
// alpha、beta 比 2 多出来的部分才是主张本身贡献的权重。
const NOW = new Date("2026-10-22T00:00:00Z");

function row(status: string, extra: Partial<ScoredRow> = {}): ScoredRow {
  return {
    category: "科技",
    status,
    deadline: "2026-10-22",
    evidence_count: 1,
    thread_id: null,
    ...extra,
  };
}

function evidenceWeight(rows: ScoredRow[]) {
  const scored = scoreDomain(rows, NOW);
  return scored.alpha + scored.beta - 4;
}

describe("scoreDomain", () => {
  test("已兑现记 1", () => {
    const scored = scoreDomain([row("已兑现")], NOW);
    expect(scored.n).toBe(1);
    expect(scored.voided).toBe(0);
    expect(scored.alpha - 2).toBe(1);
    expect(scored.beta - 2).toBe(0);
    expect(scored.value).toBe(60);
  });

  test("部分兑现记 0.5", () => {
    const scored = scoreDomain([row("部分兑现")], NOW);
    expect(scored.n).toBe(1);
    expect(scored.alpha - 2).toBe(0.5);
    expect(scored.beta - 2).toBe(0.5);
    expect(scored.value).toBe(50);
  });

  test("未兑现记 0", () => {
    const scored = scoreDomain([row("未兑现")], NOW);
    expect(scored.n).toBe(1);
    expect(scored.alpha - 2).toBe(0);
    expect(scored.beta - 2).toBe(1);
    expect(scored.value).toBe(40);
  });

  test("证据不足不计分，但计入 voided", () => {
    const onlyVoid = scoreDomain([row("证据不足"), row("证据不足")], NOW);
    expect(onlyVoid.n).toBe(0);
    expect(onlyVoid.voided).toBe(2);
    expect(onlyVoid.value).toBeNull();
    expect(evidenceWeight([row("证据不足"), row("证据不足")])).toBe(0);

    const mixed = scoreDomain([row("证据不足"), row("已兑现"), row("证据不足")], NOW);
    expect(mixed.n).toBe(1);
    expect(mixed.voided).toBe(2);
    expect(mixed.value).toBe(60);
  });

  test("待定不计分，也不计入 voided", () => {
    const pending = scoreDomain([row("待定"), row("待定")], NOW);
    expect(pending.n).toBe(0);
    expect(pending.voided).toBe(0);
    expect(pending.value).toBeNull();

    const mixed = scoreDomain([row("待定"), row("已兑现")], NOW);
    expect(mixed.n).toBe(1);
    expect(mixed.voided).toBe(0);
    expect(mixed.value).toBe(60);
  });

  test("一条都没判定时 value 为 null", () => {
    const batches = [[], [row("证据不足")], [row("待定")], [row("待定"), row("证据不足")]];
    for (const rows of batches) {
      const scored = scoreDomain(rows, NOW);
      expect(scored.n).toBe(0);
      expect(scored.value).toBeNull();
      expect(scored.low).toBeNull();
      expect(scored.high).toBeNull();
    }
  });

  test("同一 thread_id 的 k 条已判定，合计权重是 √k；没有 thread 的各算各的", () => {
    const together = Array.from({ length: 4 }, () => row("已兑现", { thread_id: "same" }));
    const apart = Array.from({ length: 4 }, () => row("已兑现"));
    expect(evidenceWeight(together)).toBe(2);
    expect(evidenceWeight(apart)).toBe(4);
    expect(scoreDomain(together, NOW).value).toBeLessThan(scoreDomain(apart, NOW).value!);

    const pair = [row("已兑现", { thread_id: "pair" }), row("未兑现", { thread_id: "pair" })];
    expect(evidenceWeight(pair)).toBeCloseTo(Math.sqrt(2), 10);
  });

  test("证据不足不占同一串里的 k", () => {
    const scored = scoreDomain(
      [
        row("已兑现", { thread_id: "t" }),
        row("已兑现", { thread_id: "t" }),
        row("证据不足", { thread_id: "t" }),
      ],
      NOW,
    );
    expect(scored.n).toBe(2);
    expect(scored.voided).toBe(1);
    expect(evidenceWeight([
      row("已兑现", { thread_id: "t" }),
      row("已兑现", { thread_id: "t" }),
      row("证据不足", { thread_id: "t" }),
    ])).toBeCloseTo(Math.sqrt(2), 10);
  });

  test("没有证据的权重减半，有证据不按条数加码", () => {
    expect(evidenceWeight([row("已兑现", { evidence_count: 0 })])).toBe(0.5);
    expect(evidenceWeight([row("已兑现", { evidence_count: 1 })])).toBe(1);
    expect(evidenceWeight([row("已兑现", { evidence_count: 4 })])).toBe(1);
  });
});

describe("betaQuantile", () => {
  test("概率越大，分位数越大", () => {
    const quantiles = [0.05, 0.2, 0.5, 0.8, 0.95].map((p) => betaQuantile(p, 2, 5));
    for (let i = 1; i < quantiles.length; i += 1) expect(quantiles[i]).toBeGreaterThan(quantiles[i - 1]);
  });

  test("对称先验的中位数是 0.5", () => {
    expect(betaQuantile(0.5, 2, 2)).toBeCloseTo(0.5, 6);
    expect(betaQuantile(0.5, 8, 8)).toBeCloseTo(0.5, 6);
    expect(betaQuantile(0.1, 2, 2) + betaQuantile(0.9, 2, 2)).toBeCloseTo(1, 6);
  });
});
