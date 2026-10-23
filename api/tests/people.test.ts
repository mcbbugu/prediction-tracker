import { describe, expect, test } from "bun:test";
import { sql } from "../src/core/db";
import { PEOPLE_LIMIT_MAX, peopleSummary, type PersonSummary } from "../src/queries/people";
import { publishedClaims, type ScoreRow } from "../src/queries/records";

// /v1/home 那一套：全量拉回来，前端自己按人统计。测试用它当对照组。
const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);
const stage = (score: { value: number | null }) => (score.value != null ? 1 : 0);

async function homeStyleCards() {
  const people = await sql<{ id: string; name: string; name_en: string; title: string; portrait_path: string | null }[]>`
    SELECT id, name, name_en, title, portrait_path FROM people WHERE visibility = 'public'
  `;
  const claims = await publishedClaims();
  const snapshots = await sql<({ person_id: string } & ScoreRow)[]>`
    SELECT DISTINCT ON (person_id, domain)
      person_id, domain, value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence, formula_version, voided
    FROM score_snapshots
    WHERE slice = 'all'
    ORDER BY person_id, domain, computed_at DESC
  `;
  const scores = snapshots.filter((score) => score.confidence !== "已移除");
  return new Map(
    people.map((person) => {
      const mine = claims.filter((claim) => claim.person_id === person.id);
      // 首页 rankDomains：有分数的在前，再按已判定条数多的在前；Array.sort 稳定，所以同分按 domain 升序（SQL 的原始顺序）。
      const ranked = [...scores.filter((score) => score.person_id === person.id)].sort((a, b) => stage(b) - stage(a) || b.n - a.n);
      return [
        person.id,
        {
          ...person,
          claims: mine.length,
          judged: mine.filter((claim) => JUDGED.has(claim.status)).length,
          pending: mine.filter((claim) => claim.status === "待定").length,
          insufficient: mine.filter((claim) => claim.status === "证据不足").length,
          machine: mine.filter((claim) => claim.reviewed === false).length,
          domains: ranked.slice(0, 4).map((score) => ({ domain: score.domain, value: score.value, low: score.low, high: score.high, n: score.n })),
        },
      ];
    }),
  );
}

async function allPages(sort?: "judged" | "claims" | "name", size = PEOPLE_LIMIT_MAX) {
  const first = await peopleSummary({ limit: size, sort });
  const people = [...first.people];
  for (let offset = size; offset < first.total; offset += size) {
    const next = await peopleSummary({ limit: size, offset, sort });
    people.push(...next.people);
  }
  return { total: first.total, people };
}

describe("peopleSummary 的计数", () => {
  test("每个公开人物的各项计数和 /v1/home 全量统计出来的一致", async () => {
    const expected = await homeStyleCards();
    const { total, people } = await allPages();
    expect(total).toBe(expected.size);
    expect(people).toHaveLength(expected.size);
    for (const person of people) {
      const want = expected.get(person.id);
      expect(want).toBeDefined();
      if (!want) continue;
      expect({ id: person.id, name: person.name, name_en: person.name_en, title: person.title, portrait_path: person.portrait_path }).toEqual({
        id: want.id,
        name: want.name,
        name_en: want.name_en,
        title: want.title,
        portrait_path: want.portrait_path,
      });
      expect({
        claims: person.claims,
        judged: person.judged,
        pending: person.pending,
        insufficient: person.insufficient,
        machine: person.machine,
      }).toEqual({ claims: want.claims, judged: want.judged, pending: want.pending, insufficient: want.insufficient, machine: want.machine });
    }
  });

  test("已判定 + 待定 + 证据不足不超过主张总数，机器核对数也不超过", async () => {
    const { people } = await allPages();
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(person.judged + person.pending + person.insufficient).toBeLessThanOrEqual(person.claims);
      expect(person.machine).toBeLessThanOrEqual(person.claims);
    }
  });

  test("领先的前 4 个领域分数和首页 rankDomains 的结果一致", async () => {
    const expected = await homeStyleCards();
    const { people } = await allPages();
    const scored = people.filter((person) => person.domains.length > 0);
    expect(scored.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(person.domains.length).toBeLessThanOrEqual(4);
      const core = (rows: { domain: string; value: number | null; low: number | null; high: number | null; n: number }[]) =>
        rows.map(({ domain, value, low, high, n }) => ({ domain, value, low, high, n }));
      expect(core(person.domains)).toEqual(core(expected.get(person.id)?.domains ?? []));
    }
    const musk = people.find((person) => person.id === "musk");
    const driving = musk?.domains.find((row) => row.domain === "自动驾驶");
    expect(driving?.promise?.n).toBeGreaterThan(0);
    expect(typeof driving?.promise?.value).toBe("number");
    expect(typeof driving?.forecast?.value).toBe("number");
  });
});

describe("peopleSummary 的分页", () => {
  test("小页拼起来和一次取完完全一样，不重不漏", async () => {
    const whole = await allPages();
    const paged = await allPages(undefined, 7);
    expect(paged.total).toBe(whole.total);
    expect(paged.people.map((person) => person.id)).toEqual(whole.people.map((person) => person.id));
    expect(new Set(paged.people.map((person) => person.id)).size).toBe(whole.total);
  });

  test("limit 封顶 100，offset 越界只返回空列表但 total 照常", async () => {
    const capped = await peopleSummary({ limit: 1000 });
    expect(capped.people.length).toBeLessThanOrEqual(PEOPLE_LIMIT_MAX);
    const beyond = await peopleSummary({ offset: capped.total + 50 });
    expect(beyond.people).toEqual([]);
    expect(beyond.total).toBe(capped.total);
  });

  test("limit=1 逐个翻页，顺序和整页一致", async () => {
    const whole = await allPages();
    const ids: string[] = [];
    for (let offset = 0; offset < whole.total; offset += 1) {
      const slice = await peopleSummary({ limit: 1, offset });
      expect(slice.people).toHaveLength(1);
      ids.push(slice.people[0]!.id);
    }
    expect(ids).toEqual(whole.people.map((person) => person.id));
  });
});

describe("peopleSummary 的排序", () => {
  const nonIncreasing = (people: PersonSummary[], keys: ("judged" | "claims")[]) => {
    for (let index = 1; index < people.length; index += 1) {
      const previous = people[index - 1]!;
      const current = people[index]!;
      const first = keys.find((key) => previous[key] !== current[key]);
      if (first) expect(previous[first]).toBeGreaterThan(current[first]);
      else expect(previous.id < current.id).toBe(true);
    }
  };

  test("默认 judged：已判定降序，再按主张总数降序", async () => {
    const { people } = await allPages("judged");
    nonIncreasing(people, ["judged", "claims"]);
    expect(people.map((person) => person.id)).toEqual((await allPages()).people.map((person) => person.id));
  });

  test("sort=claims：主张总数降序，再按已判定降序", async () => {
    const { people } = await allPages("claims");
    nonIncreasing(people, ["claims", "judged"]);
  });

  test("sort=name：和数据库按 name 排出来的顺序一致", async () => {
    const { people } = await allPages("name");
    const order = await sql<{ id: string }[]>`SELECT id FROM people WHERE visibility = 'public' ORDER BY name, id`;
    expect(people.map((person) => person.id)).toEqual(order.map((row) => row.id));
  });

  test("无法识别的 sort 当成默认的 judged", async () => {
    const odd = await peopleSummary({ limit: 10, sort: "pending" as never });
    const fallback = await peopleSummary({ limit: 10 });
    expect(odd.people.map((person) => person.id)).toEqual(fallback.people.map((person) => person.id));
  });
});
