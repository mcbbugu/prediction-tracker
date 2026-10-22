import { describe, expect, test } from "bun:test";
import { cohenKappa, wilson } from "../src/scoring/calibration";

describe("wilson", () => {
  test("90/100 的 95% 区间下界约 0.826、上界约 0.945", () => {
    const bound = wilson(90, 100);
    expect(bound.low).toBeCloseTo(0.826, 3);
    expect(bound.high).toBeCloseTo(0.945, 3);
    expect(bound.low).toBeLessThan(0.9);
    expect(bound.high).toBeGreaterThan(0.9);
  });

  test("97/100 的下界约 0.915", () => {
    expect(wilson(97, 100).low).toBeCloseTo(0.915, 3);
  });

  test("没有样本时区间是 0 到 1", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("cohenKappa", () => {
  test("完全一致时 κ 为 1", () => {
    const oneLabel = Array.from({ length: 8 }, () => ({ model: "已兑现", human: "已兑现" }));
    expect(cohenKappa(oneLabel)).toBe(1);

    const twoLabels = [
      ...Array.from({ length: 5 }, () => ({ model: "已兑现", human: "已兑现" })),
      ...Array.from({ length: 5 }, () => ({ model: "未兑现", human: "未兑现" })),
    ];
    expect(cohenKappa(twoLabels)).toBe(1);
  });

  test("两类各半、一致率 90% 时 κ 约为 0.8", () => {
    // 9 条都判已兑现、9 条都判未兑现、各交叉 1 条：两边都是 10/10，一致 18/20。
    const pairs = [
      ...Array.from({ length: 9 }, () => ({ model: "已兑现", human: "已兑现" })),
      ...Array.from({ length: 9 }, () => ({ model: "未兑现", human: "未兑现" })),
      { model: "已兑现", human: "未兑现" },
      { model: "未兑现", human: "已兑现" },
    ];
    expect(pairs.length).toBe(20);
    expect(cohenKappa(pairs)).toBeCloseTo(0.8, 10);
  });

  test("没有成对判定时 κ 为空", () => {
    expect(cohenKappa([])).toBeNull();
  });
});
