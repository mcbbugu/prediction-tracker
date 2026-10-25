import { describe, expect, test } from "bun:test";
import { claimSummary, listClaims, page, sortKey } from "../src/queries/claim-list";
import { explainChanges } from "../src/queries/score-changes";
import type { ClaimRow } from "../src/queries/records";

const TODAY = "2026-10-25";

function claim(i: number, over: Partial<ClaimRow> = {}): ClaimRow {
  const status = ["已兑现", "未兑现", "待定", "证据不足", "部分兑现"][i % 5];
  return {
    id: `c${String(i).padStart(3, "0")}`,
    person_id: i % 3 ? "a" : "b",
    person_name: "",
    category: i % 2 ? "AI" : "汽车",
    claim_type: "",
    quote_en: "long english",
    quote_zh: `第 ${i} 句`,
    source_url: "https://example.com",
    // Many share a date, so the id has to break ties.
    published_date: `20${String(10 + (i % 7)).padStart(2, "0")}-0${1 + (i % 9)}-01`,
    deadline: `20${String(18 + (i % 12)).padStart(2, "0")}-06-01`,
    actual_result: "",
    status,
    publication: "published",
    rationale: "long rationale",
    evidence: [],
    provenance: "agent",
    reviewed: i % 4 === 0,
    quote_kind: "direct",
    thread_id: i % 6 === 0 ? `t${i % 12}` : null,
    kind: i % 2 ? "promise" : "forecast",
    kind_reason: "",
    disputed: false,
    recheck_note: null,
    curation: "public",
    disagreed: false,
    ...over,
  };
}

const all = Array.from({ length: 137 }, (_, i) => claim(i));

function walk(input: Parameters<typeof listClaims>[1]) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 1000; guard += 1) {
    const result = listClaims(all, { ...input, cursor }, TODAY);
    seen.push(...result.claims.map((row) => row.id));
    if (!result.next_cursor) return { seen, total: result.total };
    cursor = result.next_cursor;
  }
  throw new Error("翻页没有结束");
}

describe("游标分页（025）", () => {
  for (const sort of ["record", "said", "deadline", "deadline_desc"] as const) {
    for (const limit of [1, 7, 20, 100]) {
      test(`${sort} 每页 ${limit} 条：连续翻页不重不漏，顺序和一次排好的一致`, () => {
        const { seen, total } = walk({ sort, limit });
        expect(seen.length).toBe(total);
        expect(new Set(seen).size).toBe(seen.length);
        const expected = [...all].sort((a, b) => (sortKey(a, sort, TODAY) < sortKey(b, sort, TODAY) ? -1 : 1)).map((row) => row.id);
        expect(seen).toEqual(expected);
      });
    }
  }

  test("带筛选翻页也不重不漏", () => {
    const { seen, total } = walk({ status: "judged", domain: "AI", limit: 3 });
    expect(seen.length).toBe(total);
    expect(total).toBe(all.filter((row) => row.category === "AI" && ["已兑现", "未兑现", "部分兑现"].includes(row.status)).length);
  });

  test("record 排序：已到期的在前（最近的在上），未到期的在后（最早的在上）", () => {
    const { seen } = walk({ sort: "record", limit: 100 });
    const rows = seen.map((id) => all.find((row) => row.id === id)!);
    const firstFuture = rows.findIndex((row) => row.deadline >= TODAY);
    expect(rows.slice(firstFuture).every((row) => row.deadline >= TODAY)).toBe(true);
    expect(rows[0].deadline >= rows[firstFuture - 1].deadline).toBe(true);
  });

  test("limit 默认 20、最多 100；坏游标从头开始", () => {
    expect(listClaims(all, {}, TODAY).claims.length).toBe(20);
    expect(listClaims(all, { limit: "500" }, TODAY).claims.length).toBe(100);
    expect(listClaims(all, { cursor: "%%%" }, TODAY).claims[0].id).toBe(listClaims(all, {}, TODAY).claims[0].id);
  });

  test("分面计数忽略自己这一维，尊重其他维", () => {
    const result = listClaims(all, { domain: "AI", status: "fulfilled" }, TODAY);
    expect(result.counts.domain["汽车"]).toBe(all.filter((row) => row.category === "汽车" && row.status === "已兑现").length);
    expect(result.counts.status.fulfilled).toBe(result.total);
  });

  test("列表行不带长字段", () => {
    const row = listClaims(all, {}, TODAY).claims[0] as Record<string, unknown>;
    expect(row.rationale).toBeUndefined();
    expect(row.quote_en).toBeUndefined();
    expect(row.quote_zh).toBeDefined();
  });

  test("通用 page：空列表、刚好一页", () => {
    expect(page([], (x: string) => x, undefined, 5)).toEqual({ items: [], next_cursor: null });
    expect(page(["a", "b"], (x) => x, undefined, 2).next_cursor).toBeNull();
  });
});

describe("人物页概览", () => {
  test("计数和全量一致，只带 5 条最近主张和 3 条即将到期", () => {
    const mine = all.filter((row) => row.person_id === "a");
    const summary = claimSummary(mine, TODAY);
    expect(summary.total).toBe(mine.length);
    expect(summary.recent.length).toBe(5);
    expect(summary.soon.length).toBeLessThanOrEqual(3);
    expect(Object.values(summary.by_domain).reduce((sum, row) => sum + row.total, 0)).toBe(mine.length);
    expect(Object.values(summary.months).reduce((sum, n) => sum + n, 0)).toBe(mine.length);
    expect(summary.judged + summary.overdue + summary.upcoming + summary.unclear).toBe(mine.length);
  });
});

describe("分数变化原因", () => {
  test("新判定、改判、撤回各自成行，新的在上", () => {
    const snap = (at: string, basis: { id: string; status: string }[]) => ({
      domain: "AI", value: 50, low: 40, high: 60, n: basis.length, confidence: "", formula_version: "v1.3", computed_at: at, basis,
    });
    const changes = explainChanges(
      [snap("2026-10-01T00:00:00.000Z", [{ id: "x", status: "已兑现" }]), snap("2026-10-02T00:00:00.000Z", [{ id: "x", status: "未兑现" }, { id: "y", status: "已兑现" }])],
      new Map([["x", { id: "x", quote_zh: "x", status: "未兑现" }]]),
      new Set(["AI"]),
    );
    expect(changes.map((change) => change.at)).toEqual(["2026-10-02T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
    expect(changes[0].lines.map((line) => line.kind).sort()).toEqual(["added", "changed"]);
  });
});
