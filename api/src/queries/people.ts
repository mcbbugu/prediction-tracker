import { sql } from "../core/db";

// 首页列表的汇总：计数和领域分数都在 SQL 里聚合，不把全部主张拉进内存。
// 口径跟 /v1/home + 首页卡片一致：公开人物、已发布主张、每个领域取最新快照并排除 '已移除'。

const JUDGED_STATUSES = ["已兑现", "部分兑现", "未兑现"];
const PENDING_STATUS = "待定";
const VOID_STATUS = "证据不足";
const REMOVED_CONFIDENCE = "已移除";
// 卡片上显示 1 个领先领域 + 3 个次要领域。
const TOP_DOMAINS = 4;

export const PEOPLE_SORTS = ["judged", "claims", "name"] as const;
export type PeopleSort = (typeof PEOPLE_SORTS)[number];

export const PEOPLE_LIMIT_DEFAULT = 20;
export const PEOPLE_LIMIT_MAX = 100;

export type PersonDomainScore = {
  domain: string;
  value: number | null;
  low: number | null;
  high: number | null;
  n: number;
  promise?: { value: number | null; low: number | null; high: number | null; n: number } | null;
  forecast?: { value: number | null; low: number | null; high: number | null; n: number } | null;
};

export type PersonSummary = {
  id: string;
  name: string;
  name_en: string;
  title: string;
  portrait_path: string | null;
  portrait_credit: string | null;
  portrait_source_url: string | null;
  portrait_license: string | null;
  // 已发布主张总数
  claims: number;
  // 已兑现 / 部分兑现 / 未兑现
  judged: number;
  pending: number;
  // 证据不足：不计分，单独报
  insufficient: number;
  // reviewed_at 为空，即还没人工审核过的条数
  machine: number;
  curation: string;
  domains: PersonDomainScore[];
};

type CountedRow = Omit<PersonSummary, "domains">;

function orderBy(sort: PeopleSort) {
  // 列表的排序键都是输出列名，包在子查询外层排序，避免跟 claims 表重名。
  if (sort === "claims") return sql`claims DESC, judged DESC, id`;
  if (sort === "name") return sql`name, id`;
  // 默认：已判定最多的排前面。只有一条已判定的分数基本还是先验，不该领头。
  return sql`judged DESC, claims DESC, id`;
}

function page(value: number | undefined, fallback: number, min: number, max: number) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export async function peopleSummary(options: { limit?: number; offset?: number; sort?: PeopleSort } = {}) {
  const limit = page(options.limit, PEOPLE_LIMIT_DEFAULT, 1, PEOPLE_LIMIT_MAX);
  const offset = page(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const sort: PeopleSort = PEOPLE_SORTS.includes(options.sort as PeopleSort) ? (options.sort as PeopleSort) : "judged";

  const [totals, rows] = await Promise.all([
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM people WHERE visibility = 'public'`,
    sql<CountedRow[]>`
      WITH counted AS (
        SELECT c.person_id,
               count(*)::int AS claims,
               count(*) FILTER (WHERE c.status IN ${sql(JUDGED_STATUSES)})::int AS judged,
               count(*) FILTER (WHERE c.status = ${PENDING_STATUS})::int AS pending,
               count(*) FILTER (WHERE c.status = ${VOID_STATUS})::int AS insufficient,
               count(*) FILTER (WHERE c.reviewed_at IS NULL)::int AS machine
        FROM claims c
        JOIN people p ON p.id = c.person_id
        WHERE c.publication = 'published' AND p.visibility = 'public'
        GROUP BY c.person_id
      ),
      listed AS (
        SELECT p.id, p.name, p.name_en, p.title, p.portrait_path, p.portrait_credit, p.portrait_source_url, p.portrait_license,
               p.curation,
               coalesce(c.claims, 0) AS claims,
               coalesce(c.judged, 0) AS judged,
               coalesce(c.pending, 0) AS pending,
               coalesce(c.insufficient, 0) AS insufficient,
               coalesce(c.machine, 0) AS machine
        FROM people p
        LEFT JOIN counted c ON c.person_id = p.id
        WHERE p.visibility = 'public'
      )
      SELECT * FROM listed
      ORDER BY ${orderBy(sort)}
      LIMIT ${limit} OFFSET ${offset}
    `,
  ]);

  const ids = rows.map((row) => row.id);
  // 领域分数只查这一页的人。
  const scores = ids.length
    ? await sql<({ person_id: string } & PersonDomainScore)[]>`
        WITH latest AS (
          SELECT DISTINCT ON (person_id, domain)
            person_id, domain, value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence
          FROM score_snapshots
          WHERE person_id IN ${sql(ids)} AND slice = 'all'
          ORDER BY person_id, domain, computed_at DESC
        ),
        ranked AS (
          SELECT person_id, domain, value, low, high, n,
                 row_number() OVER (
                   PARTITION BY person_id
                   ORDER BY (value IS NOT NULL) DESC, n DESC, domain
                 ) AS place
          FROM latest
          WHERE confidence <> ${REMOVED_CONFIDENCE}
        )
        SELECT person_id, domain, value, low, high, n
        FROM ranked
        WHERE place <= ${TOP_DOMAINS}
        ORDER BY person_id, place
      `
    : [];

  const byPerson = new Map<string, PersonDomainScore[]>(ids.map((id) => [id, []]));
  for (const score of scores) {
    byPerson.get(score.person_id)?.push({ domain: score.domain, value: score.value, low: score.low, high: score.high, n: score.n });
  }
  if (ids.length) {
    const parts = await sql<{ person_id: string; domain: string; slice: string; value: number | null; low: number | null; high: number | null; n: number }[]>`
      SELECT DISTINCT ON (person_id, domain, slice)
        person_id, domain, slice, value::float8 AS value, low::float8 AS low, high::float8 AS high, n
      FROM score_snapshots
      WHERE person_id IN ${sql(ids)} AND slice IN ('promise', 'forecast')
      ORDER BY person_id, domain, slice, computed_at DESC
    `;
    for (const part of parts) {
      const domain = byPerson.get(part.person_id)?.find((row) => row.domain === part.domain);
      if (!domain) continue;
      const packed = { value: part.value, low: part.low, high: part.high, n: part.n };
      if (part.slice === "promise") domain.promise = packed;
      else domain.forecast = packed;
    }
  }

  const people: PersonSummary[] = rows.map((row) => ({ ...row, domains: byPerson.get(row.id) ?? [] }));
  return { total: totals[0]?.total ?? 0, people };
}
