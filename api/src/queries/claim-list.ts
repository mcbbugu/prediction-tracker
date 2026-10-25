// 会增长的列表（025）：主张列表的筛选、计数、排序和游标分页，人物页概览的汇总。
// 游标是排序键（含 id，唯一），下一页取严格排在它后面的，所以连续翻页不重不漏；数据在两页之间变了也只会漏掉新插进前面的。
import type { ClaimRow } from "./records";

export const LIST_LIMIT_DEFAULT = 20;
export const LIST_LIMIT_MAX = 100;

const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);

type Item = ClaimRow & { interest_note?: string | null };

function addYear(day: string) {
  return `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
}

// 待定 with a passed deadline is our backlog; 待定 still in the future is just time.
export function phase(claim: Pick<ClaimRow, "status" | "deadline">, today: string) {
  if (JUDGED.has(claim.status)) return "judged";
  if (claim.status === "证据不足") return "unclear";
  return claim.deadline < today ? "overdue" : "upcoming";
}

// ?status= keys shared by the person page and the site-wide list.
export const STATUS_TESTS: Record<string, (claim: Item, today: string) => boolean> = {
  judged: (c) => JUDGED.has(c.status),
  overdue: (c, today) => phase(c, today) === "overdue",
  upcoming: (c, today) => phase(c, today) === "upcoming",
  "due-soon": (c, today) => phase(c, today) === "upcoming" && c.deadline <= addYear(today),
  unclear: (c) => c.status === "证据不足",
  fulfilled: (c) => c.status === "已兑现",
  partial: (c) => c.status === "部分兑现",
  missed: (c) => c.status === "未兑现",
  rescheduled: (c) => Boolean(c.thread_id),
  disputed: (c) => Boolean(c.disputed),
  machine: (c) => c.reviewed === false,
  manual: (c) => c.reviewed !== false,
};

export type ListFilters = {
  status?: string;
  domain?: string;
  person?: string;
  kind?: string;
  month?: string;
  year?: string;
};

export type ListSort = "record" | "said" | "deadline" | "deadline_desc";

function matches(claim: Item, filters: ListFilters, today: string, skip?: keyof ListFilters) {
  const test = filters.status ? STATUS_TESTS[filters.status] : undefined;
  return (
    (skip === "status" || !test || test(claim, today)) &&
    (skip === "domain" || !filters.domain || claim.category === filters.domain) &&
    (skip === "person" || !filters.person || claim.person_id === filters.person) &&
    (skip === "kind" || !filters.kind || claim.kind === filters.kind) &&
    (skip === "month" || !filters.month || claim.published_date.startsWith(filters.month)) &&
    (skip === "year" || !filters.year || claim.published_date.startsWith(filters.year))
  );
}

// Dates compare as strings; mapping each digit to 9-d turns ascending into descending.
const desc = (day: string) => day.replace(/\d/g, (d) => String(9 - Number(d)));

export function sortKey(claim: Pick<ClaimRow, "id" | "published_date" | "deadline">, sort: ListSort, today: string) {
  if (sort === "said") return `${desc(claim.published_date)}|${claim.id}`;
  if (sort === "deadline") return `${claim.deadline}|${claim.id}`;
  if (sort === "deadline_desc") return `${desc(claim.deadline)}|${claim.id}`;
  // record: past deadlines first, most recent at the top (they carry the record); then the future, soonest first.
  return claim.deadline < today ? `0|${desc(claim.deadline)}|${claim.id}` : `1|${claim.deadline}|${claim.id}`;
}

export function encodeCursor(key: string) {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8") || null;
  } catch {
    return null;
  }
}

// Generic keyset page over an in-memory list: anything whose key sorts after the cursor.
export function page<T>(items: T[], key: (item: T) => string, cursor: string | undefined, limit: number) {
  const after = decodeCursor(cursor);
  const keyed = items.map((item) => ({ item, key: key(item) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const rest = after == null ? keyed : keyed.filter((row) => row.key > after);
  const taken = rest.slice(0, limit);
  return {
    items: taken.map((row) => row.item),
    next_cursor: rest.length > limit ? encodeCursor(taken[taken.length - 1].key) : null,
  };
}

export function clampLimit(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return LIST_LIMIT_DEFAULT;
  return Math.min(LIST_LIMIT_MAX, Math.floor(number));
}

// What a list row needs. The long fields (rationale, English quote, classification reason) stay on the claim page.
export function listItem(claim: Item) {
  const { rationale: _rationale, quote_en: _quoteEn, kind_reason: _kindReason, claim_type: _claimType, publication: _publication, ...rest } = claim;
  return rest;
}

function tally(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function listClaims(
  all: Item[],
  input: ListFilters & { sort?: ListSort; cursor?: string; limit?: unknown },
  today: string,
) {
  const filters: ListFilters = {
    status: input.status && STATUS_TESTS[input.status] ? input.status : undefined,
    domain: input.domain || undefined,
    person: input.person || undefined,
    kind: input.kind || undefined,
    month: input.month && /^\d{4}-\d{2}$/.test(input.month) ? input.month : undefined,
    year: input.year && /^\d{4}$/.test(input.year) ? input.year : undefined,
  };
  const sort: ListSort = input.sort && ["record", "said", "deadline", "deadline_desc"].includes(input.sort) ? input.sort : "record";
  const scoped = all.filter((claim) => matches(claim, filters, today));
  const result = page(scoped, (claim) => sortKey(claim, sort, today), input.cursor, clampLimit(input.limit));
  // Facet counts respect the other active filters, so each number is what clicking it would show.
  const facet = (skip: keyof ListFilters) => all.filter((claim) => matches(claim, filters, today, skip));
  const byStatus = facet("status");
  const byPerson = facet("person");
  return {
    claims: result.items.map(listItem),
    next_cursor: result.next_cursor,
    total: scoped.length,
    filters,
    sort,
    // Names for the person facet, so a list page needs no second request.
    names: Object.fromEntries(byPerson.map((claim) => [claim.person_id, claim.person_name])),
    counts: {
      all: byStatus.length,
      status: Object.fromEntries(Object.entries(STATUS_TESTS).map(([key, test]) => [key, byStatus.filter((claim) => test(claim, today)).length])),
      domain: tally(facet("domain").map((claim) => claim.category)),
      person: tally(byPerson.map((claim) => claim.person_id)),
      kind: tally(facet("kind").map((claim) => claim.kind)),
      // The month grid shows the whole record under the other filters.
      month: tally(all.filter((claim) => matches(claim, { ...filters, year: undefined }, today, "month")).map((claim) => claim.published_date.slice(0, 7))),
    },
  };
}

// The person page overview: counts behind every number, and only a handful of claims.
export function claimSummary(claims: Item[], today: string) {
  const count = (list: Item[], p: string) => list.filter((claim) => phase(claim, today) === p).length;
  const domains = [...new Set(claims.map((claim) => claim.category))];
  return {
    total: claims.length,
    judged: count(claims, "judged"),
    overdue: count(claims, "overdue"),
    upcoming: count(claims, "upcoming"),
    unclear: count(claims, "unclear"),
    machine: claims.filter((claim) => claim.reviewed === false).length,
    months: tally(claims.map((claim) => claim.published_date.slice(0, 7))),
    // id → status for the interest map, which colours every claim it links to.
    statuses: claims.map((claim) => ({ id: claim.id, status: claim.status, year: Number(claim.published_date.slice(0, 4)) })),
    by_domain: Object.fromEntries(
      domains.map((domain) => {
        const list = claims.filter((claim) => claim.category === domain);
        const next = list.filter((claim) => phase(claim, today) === "upcoming").sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
        return [
          domain,
          {
            total: list.length,
            fulfilled: list.filter((claim) => claim.status === "已兑现").length,
            partial: list.filter((claim) => claim.status === "部分兑现").length,
            missed: list.filter((claim) => claim.status === "未兑现").length,
            voided: list.filter((claim) => claim.status === "证据不足").length,
            threads: new Set(list.filter((claim) => claim.thread_id).map((claim) => claim.thread_id)).size,
            overdue: count(list, "overdue"),
            upcoming: count(list, "upcoming"),
            next_deadline: next?.deadline ?? null,
          },
        ];
      }),
    ),
    recent: [...claims].sort((a, b) => sortKey(a, "said", today).localeCompare(sortKey(b, "said", today))).slice(0, 5).map(listItem),
    soon: claims
      .filter((claim) => phase(claim, today) === "upcoming")
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 3)
      .map(listItem),
  };
}

// Site-wide totals for the home page, so it no longer needs every claim.
export function siteStats(claims: Item[], today: string) {
  const years = claims.map((claim) => Number(claim.published_date.slice(0, 4))).filter(Boolean);
  return {
    claims: claims.length,
    judged: claims.filter((claim) => JUDGED.has(claim.status)).length,
    upcoming: claims.filter((claim) => phase(claim, today) === "upcoming").length,
    voided: claims.filter((claim) => claim.status === "证据不足").length,
    overdue: claims.filter((claim) => phase(claim, today) === "overdue").length,
    fulfilled: claims.filter((claim) => claim.status === "已兑现").length,
    partial: claims.filter((claim) => claim.status === "部分兑现").length,
    missed: claims.filter((claim) => claim.status === "未兑现").length,
    rescheduled: new Set(claims.map((claim) => claim.thread_id).filter(Boolean)).size,
    since: years.length ? Math.min(...years) : null,
  };
}
