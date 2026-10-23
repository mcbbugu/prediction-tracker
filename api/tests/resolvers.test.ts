import { describe, expect, test } from "bun:test";
import { normalizeProposition } from "../src/claims/structure";
import { compareNumber } from "../src/scoring/resolvers/compare";
import { parseStooqCsv, resolvePriceBars } from "../src/scoring/resolvers/price";
import { resolveSecFiling } from "../src/scoring/resolvers/sec-xbrl";

const CSV = `Date,Open,High,Low,Close,Volume,MarketCap
2024-12-30,100,110,90,105,1000,900
2025-01-02,106,112,104,108,1000,950
`;

const filing = {
  period_end: "2024-12-31",
  revenue_usd: 100_000_000_000,
  source_id: 7,
  source_url: "https://www.sec.gov/Archives/example",
  fiscal_year: 2024,
};

describe("确定性判定器", () => {
  test("同一份年报和阈值，两次结果相同", () => {
    const proposition = { comparator: ">=", threshold: 80_000_000_000, deadline: "2025-06-01", field: "revenue_usd" };
    const first = resolveSecFiling(proposition, [filing]);
    const second = resolveSecFiling(proposition, [filing]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.status).toBe("已兑现");
    expect(first.computed_value).toBe(100_000_000_000);
    expect(first.evidence_ids).toEqual([7]);
  });

  test("营收低于阈值是未兑现，截止日之前没有年报是证据不足", () => {
    expect(resolveSecFiling({ comparator: ">=", threshold: 200_000_000_000, deadline: "2025-06-01", field: "revenue_usd" }, [filing]).status).toBe("未兑现");
    expect(resolveSecFiling({ comparator: ">=", threshold: 1, deadline: "2024-01-01", field: "revenue_usd" }, [filing]).status).toBe("证据不足");
    expect(resolveSecFiling({ comparator: "exists_by", threshold: null, deadline: "2025-06-01", field: "revenue_usd" }, [filing]).status).toBe("已兑现");
    expect(compareNumber("<=", 3, 3)).toBe("已兑现");
    expect(compareNumber("=", 3, 4)).toBe("未兑现");
  });

  test("日线收盘价按截止日前最近一根 K 线比较，市值列缺失就是证据不足", () => {
    const bars = parseStooqCsv(CSV);
    const hit = resolvePriceBars({ comparator: ">=", threshold: 100, deadline: "2024-12-31", field: "close" }, bars);
    const again = resolvePriceBars({ comparator: ">=", threshold: 100, deadline: "2024-12-31", field: "close" }, bars);
    expect(JSON.stringify(hit)).toBe(JSON.stringify(again));
    expect(hit.status).toBe("已兑现");
    expect(hit.computed_value).toBe(105);
    expect(resolvePriceBars({ comparator: ">=", threshold: 200, deadline: "2024-12-31", field: "close" }, bars).status).toBe("未兑现");
    expect(resolvePriceBars({ comparator: ">=", threshold: 1, deadline: "2024-01-01", field: "close" }, bars).status).toBe("证据不足");
    expect(resolvePriceBars({ comparator: ">=", threshold: 800, deadline: "2024-12-31", field: "market_cap" }, bars).status).toBe("已兑现");
    const closeOnly = parseStooqCsv("Date,Open,High,Low,Close,Volume\n2024-12-30,1,1,1,105,1\n");
    expect(resolvePriceBars({ comparator: ">=", threshold: 1, deadline: "2024-12-31", field: "market_cap" }, closeOnly).status).toBe("证据不足");
  });

  test("转不成数字门槛的命题记成模型判定", () => {
    const model = normalizeProposition({ id: "c1", deadline: "2030-12-31" }, { resolver: "story", subject: "FSD" }, "call-1");
    expect(model.resolver).toBe("model");
    expect(model.comparator).toBeNull();
    expect(model.deadline).toBe("2030-12-31");
    expect(model.model_call_id).toBe("call-1");
    const revenue = normalizeProposition(
      { id: "c2", deadline: "2025-12-31" },
      { resolver: "sec_xbrl", comparator: ">=", threshold: 1e11, subject: "Tesla", org_key: "Tesla, Inc.", field: "revenue_usd", metric: "revenue", unit: "USD" },
      null,
    );
    expect(revenue.resolver).toBe("sec_xbrl");
    expect(revenue.resolver_args.org_key).toBe("tesla");
    expect(revenue.threshold).toBe(1e11);
  });
});
