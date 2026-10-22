// consult 第一层：只查库、不调模型的先验查询（GET /v1/prior，MCP 工具 get_prior）。
//
// as_of：站在那一天看这个人的记录——只算那天之前说过、且期限在那天之前已到的主张，时间衰减也从那天起算。
// 查今天时，提前兑现（期限未到但已判定）的主张也算，和人物页的分数一致。
// 结果用的是今天查到的事实（我们并不知道当年的人是否已经知道结果），所以它回答的是
// 「到那天为止，他到期的话兑现得怎么样」，不是「当年的人会怎么看」。
import { sql } from "../core/db";
import { FORMULA_VERSION, scoreDomain } from "../scoring/score";
import { indicators, type IndicatorClaim } from "../scoring/indicators";
import { publishedClaims, personInterests, type ClaimRow } from "./records";

const SITE = (process.env.SITE_URL || "http://localhost:4321").replace(/\/$/, "");
const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);

export class PriorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly candidates: { id: string; name: string; name_en: string }[] = [],
  ) {
    super(message);
  }
}

// Person by id, Chinese name or English name; a unique partial match is accepted, several are an error.
export async function resolvePerson(input: string) {
  const q = input.trim();
  if (!q) throw new PriorError("缺少 person", 400);
  const exact = await sql<{ id: string; name: string; name_en: string }[]>`
    SELECT id, name, name_en FROM people
    WHERE visibility = 'public' AND (id = ${q} OR name = ${q} OR lower(name_en) = lower(${q}))
    LIMIT 1
  `;
  if (exact[0]) return exact[0];
  const like = await sql<{ id: string; name: string; name_en: string }[]>`
    SELECT id, name, name_en FROM people
    WHERE visibility = 'public' AND (name ILIKE ${`%${q}%`} OR name_en ILIKE ${`%${q}%`})
    ORDER BY id
    LIMIT 5
  `;
  if (like.length === 1) return like[0];
  if (like.length > 1) throw new PriorError(`「${q}」对应多位人物，请用 id`, 409, like);
  throw new PriorError(`库里没有「${q}」`, 404);
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function domainPrior(claims: ClaimRow[], asOf: string, today: string) {
  // Said by as_of and due by as_of. For today, a claim already judged before its deadline (fulfilled early)
  // counts too; for a past date we don't know when it was fulfilled, so only the deadline decides.
  const due = claims.filter((c) => c.deadline <= asOf || (asOf === today && JUDGED.has(c.status)));
  const scored = scoreDomain(
    due.map((c) => ({
      category: c.category,
      status: c.status,
      deadline: c.deadline,
      evidence_count: Array.isArray(c.evidence) ? c.evidence.length : 0,
      thread_id: c.thread_id,
    })),
    new Date(`${asOf}T00:00:00Z`),
  );
  const judged = due.filter((c) => JUDGED.has(c.status));
  const ind = indicators(due.map((c) => ({ ...c }) as IndicatorClaim));
  return {
    score: scored.value,
    interval_80: scored.low != null ? { low: scored.low, high: scored.high } : null,
    prior_weight: scored.value != null ? Math.round(scored.value * 10) / 1000 : null,
    judged: scored.n,
    voided: scored.voided,
    said: claims.length,
    due: due.length,
    composition: {
      fulfilled: judged.filter((c) => c.status === "已兑现").length,
      partial: judged.filter((c) => c.status === "部分兑现").length,
      missed: judged.filter((c) => c.status === "未兑现").length,
    },
    indicators: { rescheduling: ind.rescheduling, testability: ind.testability },
    // The judged claims behind the score, newest deadline first: what a caller should cite.
    evidence: judged
      .sort((a, b) => b.deadline.localeCompare(a.deadline))
      .slice(0, 10)
      .map((c) => ({
        claim_id: c.id,
        said_on: c.published_date,
        deadline: c.deadline,
        status: c.status,
        quote_zh: c.quote_zh,
        quote_en: c.quote_en,
        quote_kind: c.quote_kind,
        source_url: c.source_url,
        verdict_sources: (c.evidence ?? []).map((e) => e.url),
        reviewed: c.reviewed,
        thread_id: c.thread_id,
        url: `${SITE}/p/${c.person_id}/${c.id}`,
      })),
  };
}

export async function priorAsOf(input: { person: string; domain?: string; as_of?: string }) {
  const person = await resolvePerson(input.person);
  const today = new Date().toISOString().slice(0, 10);
  const asOf = input.as_of && isoDay.test(input.as_of) ? input.as_of : today;
  if (input.as_of && !isoDay.test(input.as_of)) throw new PriorError("as_of 要写成 YYYY-MM-DD", 400);
  if (asOf > today) throw new PriorError("as_of 不能晚于今天", 400);

  const all = (await publishedClaims(person.id)).filter((c) => c.published_date <= asOf);
  const domains = [...new Set(all.map((c) => c.category))].sort();
  if (input.domain && !domains.includes(input.domain)) {
    throw new PriorError(`${person.name}在「${input.domain}」领域截至 ${asOf} 没有收录的主张；有：${domains.join("、") || "无"}`, 404);
  }

  // Ties valid on as_of (an unknown end date is reported as such, not assumed to be ongoing).
  const interests = await personInterests(person.id);
  const ties = interests.relations
    .filter((r) => !r.started || r.started <= asOf)
    .filter((r) => !r.ended || r.ended === "present" || r.ended >= asOf.slice(0, r.ended.length))
    .map((r) => ({
      kind: r.kind,
      organisation: r.counterparty,
      organisation_zh: r.counterparty_zh,
      role: r.role,
      started: r.started,
      ended: r.ended,
      end_known: Boolean(r.ended),
      source_url: r.source_url,
    }));

  const picked = input.domain ? [input.domain] : domains;
  return {
    person: { id: person.id, name: person.name, name_en: person.name_en, url: `${SITE}/p/${person.id}` },
    as_of: asOf,
    formula_version: FORMULA_VERSION,
    method: `${SITE}/method`,
    note: "分数只在领域内成立。as_of 只计那天之前说过、期限已到的主张；结果按今天查到的事实判定。证据不足作废不计分；同一承诺的反复改期整串按 √k 计。",
    domains: Object.fromEntries(
      picked.map((d) => [
        d,
        {
          ...domainPrior(
            all.filter((c) => c.category === d),
            asOf,
            today,
          ),
          claims_url: `${SITE}/p/${person.id}?domain=${encodeURIComponent(d)}#claims`,
        },
      ]),
    ),
    interests: { collected: interests.collected, ties, url: `${SITE}/p/${person.id}/interests` },
  };
}

// JSON Schema of the result, for MCP outputSchema (structuredContent).
export const PRIOR_OUTPUT_SCHEMA = {
  type: "object",
  required: ["person", "as_of", "formula_version", "domains"],
  properties: {
    person: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, name_en: { type: "string" }, url: { type: "string" } } },
    as_of: { type: "string", format: "date" },
    formula_version: { type: "string" },
    note: { type: "string" },
    domains: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          score: { type: ["number", "null"], description: "0–100 兑现率先验；null = 截至 as_of 还没有已判定的主张" },
          interval_80: { type: ["object", "null"], properties: { low: { type: "number" }, high: { type: "number" } } },
          prior_weight: { type: ["number", "null"], description: "score / 100" },
          judged: { type: "integer" },
          voided: { type: "integer", description: "证据不足、作废不计分的条数" },
          composition: { type: "object" },
          indicators: { type: "object", description: "改期率与可检验度（不进分数）" },
          evidence: { type: "array", description: "计入分数的主张，带原文、出处和本站链接" },
          claims_url: { type: "string" },
        },
      },
    },
    interests: { type: "object", description: "as_of 当天有效的任职、持股、交易；end_known=false 表示没有记录结束日期" },
  },
} as const;
