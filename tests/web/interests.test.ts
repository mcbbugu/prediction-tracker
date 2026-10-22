import { describe, expect, test } from "bun:test";
import { isCurrent, periodLabel, periodMonths, spanText, type Financials } from "@/lib/interests";

// 手写披露区间，不访问接口。spanText 的连接号是 en dash（U+2013）。
const dash = "\u2013";

function fin(over: Partial<Financials> = {}): Financials {
  return {
    revenue_usd: 1,
    year: null,
    source_url: "https://example.test/filing",
    ...over,
  };
}

describe("periodMonths", () => {
  test("没写起止，或只写了一端，按 12 个月", () => {
    expect(periodMonths(fin())).toBe(12);
    expect(periodMonths(fin({ period_start: "2025-01-01" }))).toBe(12);
    expect(periodMonths(fin({ period_end: "2025-12-31" }))).toBe(12);
  });

  test("全年约 12 个月，半年、前三季度和单季各算各的", () => {
    expect(periodMonths(fin({ period_start: "2025-01-01", period_end: "2025-12-31" }))).toBe(12);
    expect(periodMonths(fin({ period_start: "2025-01-01", period_end: "2025-11-30" }))).toBe(11);
    expect(periodMonths(fin({ period_start: "2026-01-01", period_end: "2026-06-30" }))).toBe(6);
    expect(periodMonths(fin({ period_start: "2026-01-01", period_end: "2026-09-30" }))).toBe(9);
    expect(periodMonths(fin({ period_start: "2026-01-01", period_end: "2026-03-31" }))).toBe(3);
  });
});

describe("periodLabel", () => {
  test("满一年写成 FY2025", () => {
    expect(
      periodLabel(fin({ year: 2025, period_start: "2025-01-01", period_end: "2025-12-31" })),
    ).toBe("FY2025");
  });

  test("半年、前三季度、单季带区间结束年", () => {
    expect(
      periodLabel(fin({ year: 2026, period_start: "2026-01-01", period_end: "2026-06-30" })),
    ).toBe("2026 上半年");
    expect(
      periodLabel(fin({ year: 2026, period_start: "2026-01-01", period_end: "2026-09-30" })),
    ).toBe("2026 前三季度");
    expect(
      periodLabel(fin({ year: 2026, period_start: "2026-01-01", period_end: "2026-03-31" })),
    ).toBe("2026 单季");
  });
});

describe("isCurrent", () => {
  test("有 current 字段时以它为准", () => {
    expect(isCurrent({ ended: "2020", current: true })).toBe(true);
    expect(isCurrent({ ended: null, current: false })).toBe(false);
    expect(isCurrent({ ended: "", current: false })).toBe(false);
    expect(isCurrent({ ended: "present", current: false })).toBe(false);
  });

  test("没有 current 时，ended 为空或 present 算现任", () => {
    expect(isCurrent({ ended: null })).toBe(true);
    expect(isCurrent({ ended: "" })).toBe(true);
    expect(isCurrent({ ended: "present" })).toBe(true);
    expect(isCurrent({ ended: "1985" })).toBe(false);
  });
});

describe("spanText", () => {
  test("结束时间未知", () => {
    expect(spanText({ started: "1993", ended: null, end_kind: "unknown", current: false })).toBe(
      `1993 ${dash} 结束时间未知`,
    );
  });

  test("至今（未记录结束）", () => {
    expect(spanText({ started: "2004", ended: null, end_kind: "unknown", current: true })).toBe(
      `2004 ${dash} 至今（未记录结束）`,
    );
  });

  test("至今", () => {
    expect(spanText({ started: "2004", ended: null })).toBe(`2004 ${dash} 至今`);
    expect(spanText({ started: "2004", ended: "present" })).toBe(`2004 ${dash} 至今`);
    expect(spanText({ started: "2016", ended: "2019", current: true })).toBe(`2016 ${dash} 至今`);
  });

  test("起止年份", () => {
    expect(spanText({ started: "1983", ended: "1985" })).toBe(`1983 ${dash} 1985`);
  });
});
