import { describe, expect, test } from "bun:test";
import { scoreConsistency } from "../src/scoring/consistency";

const day = "2026-10-23";

describe("可信度", () => {
  test("5 条都一致、权重都是 1 时，分数是 77.8，区间包住它", () => {
    const rows = Array.from({ length: 5 }, () => ({ domain: "自动驾驶", consistent: true, date: day }));
    const scored = scoreConsistency(rows, new Date(`${day}T00:00:00Z`));
    expect(scored.status).toBe("scored");
    expect(scored.value).toBe(77.8);
    expect(scored.low).toBeLessThan(scored.value!);
    expect(scored.high).toBeGreaterThan(scored.value!);
  });

  test("5 条都不一致时分数低于 50", () => {
    const rows = Array.from({ length: 5 }, () => ({ domain: "自动驾驶", consistent: false, date: day }));
    const scored = scoreConsistency(rows, new Date(`${day}T00:00:00Z`));
    expect(scored.value).toBeLessThan(50);
    expect(scored.low).toBeLessThan(scored.high!);
  });

  test("少于 5 条不出分", () => {
    const scored = scoreConsistency(
      Array.from({ length: 4 }, () => ({ domain: "航天", consistent: true, date: day })),
      new Date(`${day}T00:00:00Z`),
    );
    expect(scored.status).toBe("examples_only");
    expect(scored.value).toBeNull();
    expect(scored.n).toBe(4);
  });
});
