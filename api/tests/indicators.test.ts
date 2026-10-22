import { describe, expect, test } from "bun:test";
import { rescheduling, testability, type IndicatorClaim } from "../src/scoring/indicators";

function claim(extra: Partial<IndicatorClaim> & Pick<IndicatorClaim, "id">): IndicatorClaim {
  return {
    category: "科技",
    status: "待定",
    published_date: "2024-01-01",
    deadline: "2025-01-01",
    thread_id: null,
    ...extra,
  };
}

describe("rescheduling", () => {
  test("后一次说的期限更晚，才算一次改期", () => {
    // 数组顺序故意和发表顺序相反：按发表日期排，不按传入顺序。
    const result = rescheduling([
      claim({ id: "a3", thread_id: "roadster", published_date: "2024-12-01", deadline: "2026-07-01" }),
      claim({ id: "a1", thread_id: "roadster", published_date: "2024-01-01", deadline: "2025-01-01" }),
      claim({ id: "a2", thread_id: "roadster", published_date: "2024-06-01", deadline: "2025-07-01" }),
      claim({ id: "solo", published_date: "2023-01-01", deadline: "2024-01-01" }),
    ]);
    expect(result.commitments).toBe(2);
    expect(result.rescheduled).toBe(1);
    expect(result.pushes).toBe(2);
    expect(result.rate).toBeCloseTo(0.5);
    // 2025-01-01 → 2025-07-01，再 → 2026-07-01，两次推迟平均 9.0 个月。
    expect(result.avg_delay_months).toBe(9);
  });

  test("期限提前不算改期", () => {
    const result = rescheduling([
      claim({ id: "b1", thread_id: "t", published_date: "2024-01-01", deadline: "2026-12-01" }),
      claim({ id: "b2", thread_id: "t", published_date: "2024-08-01", deadline: "2025-06-01" }),
    ]);
    expect(result.commitments).toBe(1);
    expect(result.rescheduled).toBe(0);
    expect(result.pushes).toBe(0);
    expect(result.rate).toBe(0);
    expect(result.avg_delay_months).toBeNull();
  });

  test("期限没变不算改期", () => {
    const result = rescheduling([
      claim({ id: "c1", thread_id: "t", published_date: "2024-01-01", deadline: "2026-01-01" }),
      claim({ id: "c2", thread_id: "t", published_date: "2024-08-01", deadline: "2026-01-01" }),
    ]);
    expect(result.pushes).toBe(0);
    expect(result.rescheduled).toBe(0);
  });

  test("只有一条主张时不算改期", () => {
    const result = rescheduling([
      claim({ id: "only", thread_id: "t", published_date: "2024-01-01", deadline: "2028-01-01" }),
    ]);
    expect(result.commitments).toBe(1);
    expect(result.rescheduled).toBe(0);
    expect(result.pushes).toBe(0);
    expect(result.rate).toBe(0);
  });

  test("没有 thread_id 串在一起的两条主张，期限更晚也不算改期", () => {
    const result = rescheduling([
      claim({ id: "d1", published_date: "2024-01-01", deadline: "2025-01-01" }),
      claim({ id: "d2", published_date: "2024-06-01", deadline: "2027-01-01" }),
    ]);
    expect(result.commitments).toBe(2);
    expect(result.rescheduled).toBe(0);
    expect(result.pushes).toBe(0);
  });

  test("没有主张时改期率为空", () => {
    const result = rescheduling([]);
    expect(result.commitments).toBe(0);
    expect(result.rescheduled).toBe(0);
    expect(result.rate).toBeNull();
    expect(result.pushes).toBe(0);
    expect(result.avg_delay_months).toBeNull();
  });
});

describe("testability", () => {
  test("已兑现、部分兑现、未兑现算能判定，证据不足算作废，待定不计入", () => {
    const result = testability([
      claim({ id: "1", status: "已兑现" }),
      claim({ id: "2", status: "部分兑现" }),
      claim({ id: "3", status: "未兑现" }),
      claim({ id: "4", status: "证据不足" }),
      claim({ id: "5", status: "待定" }),
    ]);
    expect(result).toEqual({ resolved: 4, judged: 3, voided: 1, rate: 0.75 });
  });

  test("没有已了结的主张时，可检验度为空", () => {
    expect(testability([]).rate).toBeNull();
    expect(testability([claim({ id: "1", status: "待定" })]).rate).toBeNull();
    expect(testability([claim({ id: "1", status: "待定" })]).resolved).toBe(0);
  });

  test("全部证据不足时，能判定的比例是 0", () => {
    const result = testability([
      claim({ id: "1", status: "证据不足" }),
      claim({ id: "2", status: "证据不足" }),
    ]);
    expect(result.judged).toBe(0);
    expect(result.voided).toBe(2);
    expect(result.resolved).toBe(2);
    expect(result.rate).toBe(0);
  });
});
