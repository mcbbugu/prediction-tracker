import { describe, expect, test } from "bun:test";
import { daysBetween, delaySentence, estimateDelay, kaplanMeier, predictWhen, promiseObservations, survivalQuantile, type SurvivalClaim } from "../src/scoring/survival";

// 乘积极限的手算例：6 人，时刻 1、2 发生，3 删失，4 发生，5 删失，6 发生。
// S(1)=5/6，S(2)=5/6×4/5=2/3，S(4)=2/3×2/3=4/9，S(6)=0。中位数是 S 首次 ≤ 0.5 的时刻 4。
describe("Kaplan–Meier", () => {
  const rows = [
    { time: 1, event: true },
    { time: 2, event: true },
    { time: 3, event: false },
    { time: 4, event: true },
    { time: 5, event: false },
    { time: 6, event: true },
  ];

  test("含删失的乘积极限和手算一致", () => {
    const curve = kaplanMeier(rows);
    expect(curve.find((point) => point.time === 1)?.survival).toBeCloseTo(5 / 6, 4);
    expect(curve.find((point) => point.time === 2)?.survival).toBeCloseTo(2 / 3, 4);
    expect(curve.find((point) => point.time === 4)?.survival).toBeCloseTo(4 / 9, 4);
    expect(curve.find((point) => point.time === 6)?.survival).toBe(0);
    expect(survivalQuantile(curve, 0.5)).toBe(4);
    expect(survivalQuantile(curve, 0.9)).toBe(6);
  });

  test("全部删失时中位数是无穷", () => {
    const curve = kaplanMeier([
      { time: 1, event: false },
      { time: 2, event: false },
    ]);
    expect(survivalQuantile(curve, 0.5)).toBeNull();
  });

  test("改期串从第一次说的日期起算一条，部分兑现算兑现", () => {
    const claims: SurvivalClaim[] = [
      { id: "a", person_id: "m", category: "自动驾驶", status: "未兑现", kind: "promise", published_date: "2020-01-01", deadline: "2020-06-01", thread_id: "t", resolved_on: null },
      { id: "b", person_id: "m", category: "自动驾驶", status: "部分兑现", kind: "promise", published_date: "2021-01-01", deadline: "2021-06-01", thread_id: "t", resolved_on: "2021-09-01" },
      { id: "c", person_id: "m", category: "航天", status: "待定", kind: "forecast", published_date: "2024-01-01", deadline: "2025-01-01", thread_id: null, resolved_on: null },
    ];
    const rows = promiseObservations(claims, "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe(true);
    expect(rows[0].partial).toBe(true);
    expect(rows[0].promised).toBe(daysBetween("2020-01-01", "2021-06-01"));
    expect(rows[0].time).toBeCloseTo(daysBetween("2020-01-01", "2021-09-01") / rows[0].promised, 3);
  });

  test("不到 8 条时和同领域混合，上分位无穷就不给日期", () => {
    const person = [{ person_id: "m", category: "芯片", promised: 100, time: 2, event: true, partial: false }];
    const domain = [
      { person_id: "o", category: "芯片", promised: 100, time: 8, event: true, partial: false },
      { person_id: "p", category: "芯片", promised: 100, time: 8, event: true, partial: false },
      { person_id: "q", category: "芯片", promised: 100, time: 8, event: true, partial: false },
    ];
    const estimate = estimateDelay(person, domain);
    expect(estimate.shrunk).toBe(true);
    expect(estimate.median).toBeCloseTo(2 / 9 + (8 * 8) / 9, 3);
    const open = estimateDelay(
      [{ person_id: "m", category: "芯片", promised: 100, time: 1.2, event: false, partial: false }],
      [{ person_id: "m", category: "芯片", promised: 100, time: 1.2, event: false, partial: false }],
    );
    expect(predictWhen("2024-01-01", "2025-01-01", open).note).toBe("多数同类承诺至今未兑现");
    expect(delaySentence(open)).toContain("至今未兑现");
  });
});
