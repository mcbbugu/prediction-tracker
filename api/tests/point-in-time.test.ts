import { describe, expect, test } from "bun:test";
import { claimAt, pairsAt, type PairRow } from "../src/queries/point-in-time";
import { priorAsOf } from "../src/queries/prior";
import { survivalAt } from "../src/scoring/score";
import { promiseObservations, type SurvivalClaim } from "../src/scoring/survival";
import { bootstrapDiff, parseEvidenceScore } from "../src/tools/downstream-eval";

const T = "2024-01-01";

describe("严格时点：T 之后的信息不能进来（#8）", () => {
  const judgedAt = new Map([
    ["before", "2023-06-01"],
    ["after", "2026-10-21"],
  ]);
  const claim = (id: string, status: string) => ({
    id,
    status,
    evidence: [
      { url: "https://a", fetched_at: "2023-05-01T00:00:00Z" },
      { url: "https://b", fetched_at: "2026-10-21T00:00:00Z" },
      { url: "https://c" },
    ],
  });

  test("T 之后才判定的主张回到待定，证据清空", () => {
    const rolled = claimAt(claim("after", "未兑现"), judgedAt, T);
    expect(rolled.status).toBe("待定");
    expect(rolled.evidence).toEqual([]);
  });

  test("没有判定事件的主张当作没判", () => {
    expect(claimAt(claim("unknown", "已兑现"), judgedAt, T).status).toBe("待定");
  });

  test("T 之前判定的保留，只留 T 之前抓取、带时间的证据", () => {
    const kept = claimAt(claim("before", "已兑现"), judgedAt, T);
    expect(kept.status).toBe("已兑现");
    expect(kept.evidence.map((item) => item.url)).toEqual(["https://a"]);
  });

  test("T 之后录入或 T 之后才说的一致性对照不计；T 之后的人工标签不用", () => {
    const base: PairRow = { id: "p", domain: "AI", topic: "", proposed_label: "consistent", label: null, a_date: "2020-01-01", date: "2022-01-01", created_at: "2023-01-01", reviewed_at: null };
    const rows = pairsAt(
      [
        base,
        { ...base, id: "late-record", created_at: "2026-10-21" },
        { ...base, id: "late-quote", date: "2025-01-01" },
        { ...base, id: "no-date", date: null },
        { ...base, id: "late-label", label: "inconsistent", reviewed_at: "2026-10-21" },
      ],
      T,
    );
    expect(rows.map((row) => row.id)).toEqual(["p", "late-label"]);
    expect(rows[1].label).toBeNull();
  });

  test("T 之后的兑现事件不算兑现，在 T 删失", () => {
    const promise = (id: string, resolved: string | null): SurvivalClaim => ({
      id,
      person_id: "x",
      category: "AI",
      status: "已兑现",
      kind: "promise",
      published_date: "2020-01-01",
      deadline: "2021-01-01",
      thread_id: null,
      resolved_on: resolved,
    });
    const claims = [promise("before", "2021-06-01"), promise("after", "2025-01-01"), { ...promise("said-later", null), published_date: "2025-01-01" }];
    const rows = promiseObservations(survivalAt(claims, new Map([["before", "2023-06-01"], ["after", "2026-10-21"]]), T), T);
    expect(rows.length).toBe(2);
    expect(rows.filter((row) => row.event).length).toBe(1);
    const censored = rows.find((row) => !row.event);
    expect(censored?.time).toBeCloseTo(1461 / 366, 2);
  });

  test("库里的真实数据：严格模式下没有 T 之后判定的证据", async () => {
    const strict = await priorAsOf({ person: "musk", as_of: "2024-01-01", strict: true });
    expect(strict.as_of_semantics).toBe("strict");
    for (const domain of Object.values(strict.domains)) {
      expect(domain.judged).toBe(0);
      expect(domain.evidence).toEqual([]);
    }
    const retro = await priorAsOf({ person: "musk", as_of: "2024-01-01" });
    expect(retro.as_of_semantics).toBe("retrospective");
  });
});

describe("证据分 0–2（#9）", () => {
  test("0、1、2 原样保留", () => {
    expect(parseEvidenceScore(0)).toBe(0);
    expect(parseEvidenceScore(1)).toBe(1);
    expect(parseEvidenceScore(2)).toBe(2);
    expect(parseEvidenceScore("2")).toBe(2);
  });

  test("越界、小数、非法值记 null，不夹到范围里", () => {
    for (const value of [3, -1, 1.5, "high", "", null, undefined, true, Number.NaN]) expect(parseEvidenceScore(value)).toBeNull();
  });

  test("bootstrap 区间包住点估计，种子固定可复现", () => {
    const pairs = [
      { a: 0.3, b: 0.2 },
      { a: 0.25, b: 0.3 },
      { a: 0.4, b: 0.1 },
    ];
    const first = bootstrapDiff(pairs);
    expect(first).toEqual(bootstrapDiff(pairs));
    expect(first!.low! <= first!.b_minus_a! && first!.b_minus_a! <= first!.high!).toBe(true);
  });
});
