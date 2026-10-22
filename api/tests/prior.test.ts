import { describe, expect, test } from "bun:test";
import { PriorError, priorAsOf, resolvePerson } from "../src/queries/prior";
import { latestScores } from "../src/queries/records";

function utcDay(offset: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function priorFailure(asOf: string) {
  try {
    await priorAsOf({ person: "musk", as_of: asOf });
  } catch (error) {
    if (error instanceof PriorError) return error;
    throw error;
  }
  throw new Error(`${asOf} 应该抛出 PriorError`);
}

describe("priorAsOf", () => {
  test("今天各领域的 score、interval_80、judged 和最新快照一致", async () => {
    const prior = await priorAsOf({ person: "musk" });
    const scores = await latestScores("musk");
    expect(prior.person.id).toBe("musk");
    expect(prior.as_of).toBe(utcDay(0));
    expect(Object.keys(prior.domains).sort()).toEqual(scores.map((row) => row.domain).sort());
    for (const row of scores) {
      const domain = prior.domains[row.domain];
      expect(domain.score).toBe(row.value);
      expect(domain.judged).toBe(row.n);
      expect(domain.interval_80).toEqual(row.low != null ? { low: row.low, high: row.high } : null);
    }
  });

  test("as_of 取过去的日期时，judged 和 said 都不大于今天", async () => {
    const today = await priorAsOf({ person: "musk" });
    const past = await priorAsOf({ person: "musk", as_of: "2020-01-01" });
    expect(past.as_of).toBe("2020-01-01");
    expect(past.as_of < today.as_of).toBe(true);
    expect(Object.keys(today.domains).length).toBeGreaterThan(0);
    for (const [domain, row] of Object.entries(past.domains)) {
      const current = today.domains[domain];
      expect(current).toBeDefined();
      expect(row.judged).toBeLessThanOrEqual(current.judged);
      expect(row.said).toBeLessThanOrEqual(current.said);
      for (const item of row.evidence) {
        expect(item.said_on <= past.as_of).toBe(true);
        expect(item.deadline <= past.as_of).toBe(true);
      }
    }
  });

  test("as_of 晚于今天或格式错误时抛 PriorError，status 400", async () => {
    const future = utcDay(1);
    expect(future > utcDay(0)).toBe(true);
    for (const asOf of [future, "2999-01-01", "2020/01/01", "2020-1-1", "not-a-date"]) {
      const error = await priorFailure(asOf);
      expect(error).toBeInstanceOf(PriorError);
      expect(error.status).toBe(400);
    }
  });
});

describe("resolvePerson", () => {
  test("id、中文名、英文名认出同一个人", async () => {
    const byId = await resolvePerson("musk");
    const byZh = await resolvePerson("埃隆·马斯克");
    const byEn = await resolvePerson("Elon Musk");
    expect(byId).toEqual(byZh);
    expect(byEn).toEqual(byId);
    expect(byId).toEqual({ id: "musk", name: "埃隆·马斯克", name_en: "Elon Musk" });
  });

  test("只给一个字母时因重名抛 PriorError，status 409 且带 candidates", async () => {
    let thrown: unknown;
    try {
      await resolvePerson("a");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PriorError);
    const error = thrown as PriorError;
    expect(error.status).toBe(409);
    expect(error.candidates.length).toBeGreaterThan(1);
    for (const candidate of error.candidates) {
      expect(candidate.id.length).toBeGreaterThan(0);
      expect(candidate.name.length).toBeGreaterThan(0);
      expect(candidate.name_en.length).toBeGreaterThan(0);
    }
  });

  test("不存在的人是 404", async () => {
    const missing = "no-such-person-zzqq";
    for (const run of [() => resolvePerson(missing), () => priorAsOf({ person: missing })]) {
      let thrown: unknown;
      try {
        await run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(PriorError);
      const error = thrown as PriorError;
      expect(error.status).toBe(404);
      expect(error.candidates).toEqual([]);
    }
  });
});
