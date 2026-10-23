import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import { LABELS, calibrationReport, sampleCalibration } from "./scoring/calibration";
import { indicators } from "./scoring/indicators";
import { handleMcp } from "./queries/mcp";
import { PriorError, priorAsOf } from "./queries/prior";
import { consultPrior } from "./queries/consult";
import { ChallengeError, decideChallenge, pendingChallenges, submitChallenge } from "./claims/challenges";
import { clientAddress, hashClientIp, ipAnalyzeAllowed, pumpApiQueue, queuePosition, recentAnalyzeCount } from "./jobs/analyze-limit";
import { notify } from "./core/notify";
import { resolveDisagreement } from "./claims/verdict";
import { remapStrayDomains } from "./claims/remap-domains";
import { arkConfigured } from "./core/ark";
import { assertSafeToStart, corsOrigin } from "./core/env";
import { sql } from "./core/db";
import { logEvent, migrate } from "./core/migrate";
import { PEOPLE_LIMIT_DEFAULT, PEOPLE_LIMIT_MAX, peopleSummary } from "./queries/people";
import { latestScores, oneClaim, personInterestAtlas, personInterests, publishedClaims, type ScoreRow } from "./queries/records";
import { COMPOSITE_WEIGHTS, interestSplit, personProfile, recomputeScores } from "./scoring/score";

assertSafeToStart("api");
const reviewToken = process.env.REVIEW_TOKEN;
if (!reviewToken) throw new Error("REVIEW_TOKEN is required");

const STATUSES = ["已兑现", "部分兑现", "未兑现", "待定", "证据不足"];
const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);

await migrate();
// Jobs run inside this process; a restart interrupts them.
await sql`
  UPDATE jobs SET state = 'failed', result = '{"message":"服务重启，任务中断"}'::jsonb, updated_at = now()
  WHERE state IN ('queued', 'running') AND runner = 'api'
`;

// Fold any free-form domain names into the fixed list, in the background, on every start.
if (arkConfigured()) {
  remapStrayDomains((line) => console.log(`[领域归并] ${line}`)).catch((error) =>
    console.error(`[领域归并] 失败：${error instanceof Error ? error.message : error}`),
  );
}

const DAILY_JOB_LIMIT = Number(process.env.ANALYZE_DAILY_LIMIT || 30);

function authorized(request: Request) {
  return request.headers.get("x-review-token") === reviewToken;
}

async function hasPublishedDuplicate(personId: string, quoteEn: string, deadline: string, claimId: string) {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM claims
    WHERE person_id = ${personId}
      AND quote_en = ${quoteEn}
      AND deadline = ${deadline}
      AND publication = 'published'
      AND id <> ${claimId}
    LIMIT 1
  `;
  return rows.length > 0;
}

const app = new Elysia()
  .use(cors({ origin: corsOrigin(), allowedHeaders: ["Content-Type", "x-review-token"] }))
  .get("/health", () => ({ ok: true }))
  // consult 第一层：只查库的先验，可按 as_of 查过去某天的记录。
  .get(
    "/v1/prior",
    async ({ query, set }) => {
      try {
        return await priorAsOf({ person: query.person, domain: query.domain, as_of: query.as_of });
      } catch (error) {
        if (!(error instanceof PriorError)) throw error;
        set.status = error.status;
        return { error: error.message, candidates: error.candidates };
      }
    },
    { query: t.Object({ person: t.String(), domain: t.Optional(t.String()), as_of: t.Optional(t.String()) }) },
  )
  // MCP (2026-07-28, stateless): one read-only tool, get_prior.
  .post("/mcp", async ({ body, set }) => {
    const response = await handleMcp((body ?? {}) as Parameters<typeof handleMcp>[0]);
    if (response === null) {
      set.status = 202;
      return "";
    }
    return response;
  })
  .get("/mcp", ({ set }) => {
    set.status = 405;
    return { error: "这是无状态 MCP 服务，只接受 POST（JSON-RPC）" };
  })
  .get(
    "/v1/consult",
    async ({ query }) => {
      return consultPrior({
        query: query.q ?? "",
        person_id: query.person_id,
        domain: query.domain,
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        person_id: t.Optional(t.String()),
        domain: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/v1/consult",
    async ({ body }) => {
      return consultPrior(body);
    },
    {
      body: t.Object({
        query: t.String(),
        person_id: t.Optional(t.String()),
        domain: t.Optional(t.String()),
      }),
    },
  )
  .get("/v1/home", async () => {
    const people = await sql<
      {
        id: string;
        name: string;
        name_en: string;
        title: string;
        portrait_path: string | null;
        portrait_credit: string | null;
        portrait_source_url: string | null;
        portrait_license: string | null;
      }[]
    >`SELECT id, name, name_en, title, portrait_path, portrait_credit, portrait_source_url, portrait_license
      FROM people
      WHERE visibility = 'public'
      ORDER BY CASE id WHEN 'musk' THEN 1 WHEN 'altman' THEN 2 WHEN 'huang' THEN 3 ELSE 4 END, name`;
    const claims = await publishedClaims();
    const scores = await sql<
      ({ person_id: string } & ScoreRow)[]
    >`
      SELECT DISTINCT ON (person_id, domain)
        person_id, domain, value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence, formula_version, voided
      FROM score_snapshots
      ORDER BY person_id, domain, computed_at DESC
    `;
    return { people, claims, scores: scores.filter((score) => score.confidence !== "已移除"), today: new Date().toISOString().slice(0, 10) };
  })
  // 首页列表：一页人物的计数和领先领域，在 SQL 里聚合好（/v1/home 是把全量发给前端自己算）。
  .get(
    "/v1/people",
    async ({ query }) => peopleSummary({ limit: query.limit, offset: query.offset, sort: query.sort }),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: PEOPLE_LIMIT_MAX, default: PEOPLE_LIMIT_DEFAULT })),
        offset: t.Optional(t.Numeric({ minimum: 0, default: 0 })),
        sort: t.Optional(t.Union([t.Literal("judged"), t.Literal("claims"), t.Literal("name")], { default: "judged" })),
      }),
    },
  )
  .get("/v1/people/:id", async ({ params, set }) => {
    const people = await sql<
      {
        id: string;
        name: string;
        name_en: string;
        title: string;
        portrait_path: string | null;
        portrait_credit: string | null;
        portrait_source_url: string | null;
        portrait_license: string | null;
        curation: string;
      }[]
    >`SELECT id, name, name_en, title, portrait_path, portrait_credit, portrait_source_url, portrait_license, curation FROM people WHERE id = ${params.id} LIMIT 1`;
    const person = people[0];
    if (!person) {
      set.status = 404;
      return { error: "未找到该人物" };
    }
    const [claimRows, scores, interests, analysisJobs] = await Promise.all([
      publishedClaims(person.id),
      latestScores(person.id),
      personInterests(person.id),
      sql<{ id: string }[]>`
        SELECT id FROM jobs
        WHERE person_id = ${person.id} AND kind = 'analyze_person' AND state = 'done'
        ORDER BY created_at DESC
        LIMIT 1
      `,
    ]);
    const claims = claimRows.map((claim) => ({ ...claim, interest_note: interests.claim_notes[claim.id] ?? null }));
    const rows = claims.map((claim) => ({
      category: claim.category,
      status: claim.status,
      deadline: claim.deadline,
      evidence_count: Array.isArray(claim.evidence) ? claim.evidence.length : 0,
      thread_id: claim.thread_id,
      related: claim.interest_note !== null,
    }));
    const profile = personProfile(rows, interests.collected);
    return {
      person,
      analysis_job_id: analysisJobs[0]?.id ?? null,
      claims,
      scores,
      profile,
      composite_weights: COMPOSITE_WEIGHTS,
      // 画像旁证, not in the composite: rescheduling and testability.
      indicators: indicators(claims),
      interests: {
        status: interests.collected ? "collected" : "not_collected",
        relations: interests.relations,
        ...(interests.collected ? interestSplit(rows) : {}),
      },
    };
  })
  .get("/v1/people/:id/interests", async ({ params, set }) => {
    const people = await sql<{ id: string }[]>`SELECT id FROM people WHERE id = ${params.id} LIMIT 1`;
    if (!people[0]) {
      set.status = 404;
      return { error: "未找到该人物" };
    }
    return personInterestAtlas(params.id);
  })
  .get("/v1/people/:id/claims/:claimId", async ({ params, set }) => {
    const claim = await oneClaim(params.id, params.claimId);
    if (!claim) {
      set.status = 404;
      return { error: "未找到该条目" };
    }
    const interests = await personInterests(params.id);
    const all = await publishedClaims(params.id);
    const related = all.filter((item) => item.category === claim.category && item.id !== claim.id && item.thread_id !== claim.thread_id);
    // 改期合并: the other times this commitment was made, oldest first.
    const thread = claim.thread_id
      ? all.filter((item) => item.thread_id === claim.thread_id && item.id !== claim.id).sort((a, b) => a.published_date.localeCompare(b.published_date))
      : [];
    // Our own archived copies of the source and evidence pages, with the Wayback capture when there is one,
    // so a reader can still check the quote after the original page changes or disappears.
    const urls = [claim.source_url, ...claim.evidence.map((item) => item.url)].filter(Boolean);
    const archives = await sql<{ url: string; fetched_at: string; sha256: string; wayback_url: string | null; fetched_via: string }[]>`
      SELECT DISTINCT ON (url) url, to_char(fetched_at, 'YYYY-MM-DD') AS fetched_at, sha256, wayback_url, fetched_via
      FROM sources
      WHERE url IN ${sql(urls)}
      ORDER BY url, (wayback_url IS NOT NULL) DESC, fetched_at DESC
    `;
    return {
      claim: { ...claim, interest_note: interests.claim_notes[claim.id] ?? null },
      related: related.slice(0, 4),
      thread,
      archives: Object.fromEntries(archives.map((row) => [row.url, row])),
    };
  })
  .get("/v1/review", async ({ request, set }) => {
    if (!authorized(request)) {
      set.status = 401;
      return { error: "审核口令不正确" };
    }
    const proposals = await sql`
      SELECT c.id, c.person_id, p.name AS person_name, c.category, c.quote_zh, c.quote_en,
             c.source_url, to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
             to_char(c.deadline, 'YYYY-MM-DD') AS deadline, c.status, c.rationale, c.evidence,
             c.actual_result, c.provenance
      FROM claims c
      JOIN people p ON p.id = c.person_id
      WHERE c.publication = 'proposed'
      ORDER BY c.person_id, c.category, c.deadline
    `;
    const verdicts = await sql`
      SELECT v.id, v.claim_id, v.person_id, p.name AS person_name, c.category, c.quote_zh, c.quote_en,
             c.source_url, to_char(c.deadline, 'YYYY-MM-DD') AS deadline, c.status AS current_status,
             v.status, v.actual_result, v.rationale, v.evidence, v.rejected_evidence, v.created_at
      FROM verdict_proposals v
      JOIN claims c ON c.id = v.claim_id
      JOIN people p ON p.id = v.person_id
      WHERE v.state = 'pending'
      ORDER BY v.created_at
    `;
    const runs = await sql`
      SELECT id, person_id, step, status, detail, created_at
      FROM agent_runs
      ORDER BY created_at DESC
      LIMIT 12
    `;
    const disagreements = await sql`
      SELECT c.id, c.person_id, p.name AS person_name, c.quote_zh, c.status, c.disagreement
      FROM claims c JOIN people p ON p.id = c.person_id
      WHERE c.disagreement IS NOT NULL
      ORDER BY c.person_id, c.id
    `;
    return { proposals, verdicts, runs, challenges: await pendingChallenges(), disagreements };
  })
  .post(
    "/v1/review/:id/:action",
    async ({ params, request, set }) => {
      if (!authorized(request)) {
        set.status = 401;
        return { error: "审核口令不正确" };
      }
      const action = params.action;
      if (action !== "publish" && action !== "return" && action !== "insufficient") {
        set.status = 400;
        return { error: "未知动作" };
      }
      const rows = await sql<
        {
          id: string;
          person_id: string;
          quote_en: string;
          deadline: string;
          publication: string;
          status: string;
          evidence: { url: string }[];
        }[]
      >`
        SELECT id, person_id, quote_en, to_char(deadline, 'YYYY-MM-DD') AS deadline, publication, status, evidence
        FROM claims WHERE id = ${params.id} LIMIT 1
      `;
      const claim = rows[0];
      if (!claim || claim.publication !== "proposed") {
        set.status = 404;
        return { error: "没有这条待发布提案" };
      }
      if (action === "return") {
        await sql`UPDATE claims SET publication = 'returned', reviewed_at = now() WHERE id = ${claim.id}`;
        await logEvent({
          claim_id: claim.id,
          person_id: claim.person_id,
          action: "returned",
          actor: "reviewer",
          before: { publication: "proposed" },
          after: { publication: "returned" },
        });
        return { ok: true };
      }
      if (await hasPublishedDuplicate(claim.person_id, claim.quote_en, claim.deadline, claim.id)) {
        set.status = 409;
        return { error: "已有相同原话和截止日的公开记录。这条提案应退回。" };
      }
      if (action === "publish" && JUDGED.has(claim.status) && claim.evidence.length === 0) {
        set.status = 409;
        return { error: `判定为「${claim.status}」至少要有一条证据链接。先补证据，或改成待定。` };
      }
      if (action === "publish") {
        await sql`
          UPDATE claims
          SET publication = 'published', published_at = now(), reviewed_at = now()
          WHERE id = ${claim.id}
        `;
      } else {
        await sql`
          UPDATE claims
          SET publication = 'published', status = '证据不足', published_at = now(), reviewed_at = now(),
              rationale = CASE WHEN rationale = '' THEN '证据不足以判定。' ELSE rationale END
          WHERE id = ${claim.id}
        `;
      }
      await sql`UPDATE people SET visibility = 'public' WHERE id = ${claim.person_id} AND visibility = 'draft'`;
      await logEvent({
        claim_id: claim.id,
        person_id: claim.person_id,
        action: action === "publish" ? "published" : "published_insufficient",
        actor: "reviewer",
        before: { publication: "proposed", status: claim.status },
        after: { publication: "published", status: action === "publish" ? claim.status : "证据不足" },
      });
      await recomputeScores(claim.person_id, { claim_id: claim.id, action });
      return { ok: true };
    },
    { params: t.Object({ id: t.String(), action: t.String() }) }
  )
  .patch(
    "/v1/review/:id",
    async ({ params, body, request, set }) => {
      if (!authorized(request)) {
        set.status = 401;
        return { error: "审核口令不正确" };
      }
      const rows = await sql<
        { id: string; person_id: string; status: string; actual_result: string; rationale: string; evidence: { url: string }[]; publication: string }[]
      >`SELECT id, person_id, status, actual_result, rationale, evidence, publication FROM claims WHERE id = ${params.id} LIMIT 1`;
      const claim = rows[0];
      if (!claim || claim.publication !== "proposed") {
        set.status = 404;
        return { error: "只能修改待发布的提案" };
      }
      if (body.status !== undefined && !STATUSES.includes(body.status)) {
        set.status = 400;
        return { error: "未知状态" };
      }
      const evidence =
        body.evidence_urls === undefined
          ? claim.evidence
          : body.evidence_urls.map((url) => url.trim()).filter((url) => /^https?:\/\//.test(url)).map((url) => ({ url }));
      const next = {
        status: body.status ?? claim.status,
        actual_result: body.actual_result ?? claim.actual_result,
        rationale: body.rationale ?? claim.rationale,
        evidence,
      };
      await sql`
        UPDATE claims
        SET status = ${next.status}, actual_result = ${next.actual_result},
            rationale = ${next.rationale}, evidence = ${sql.json(next.evidence)}
        WHERE id = ${claim.id}
      `;
      await logEvent({
        claim_id: claim.id,
        person_id: claim.person_id,
        action: "edited",
        actor: "reviewer",
        before: { status: claim.status, actual_result: claim.actual_result, evidence: claim.evidence },
        after: next,
      });
      return { ok: true, claim: next };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.Optional(t.String()),
        actual_result: t.Optional(t.String()),
        rationale: t.Optional(t.String()),
        evidence_urls: t.Optional(t.Array(t.String())),
      }),
    },
  )
  // 校准协议 (SPEC 核对分层): blind labels for agent verdicts. Items never carry the model's status or reasoning.
  .get("/v1/calibration", async ({ request, set }) => {
    if (!authorized(request)) {
      set.status = 401;
      return { error: "审核口令不正确" };
    }
    const items = await sql`
      SELECT ci.id::int AS id, ci.purpose, p.name AS person_name, c.category, c.quote_zh, c.quote_en, c.source_url,
             to_char(c.published_date, 'YYYY-MM-DD') AS published_date, to_char(c.deadline, 'YYYY-MM-DD') AS deadline,
             coalesce((SELECT jsonb_agg(e->>'url') FROM jsonb_array_elements(v.evidence) e), '[]'::jsonb) AS evidence_urls
      FROM calibration_items ci
      JOIN verdict_proposals v ON v.id = ci.proposal_id
      JOIN claims c ON c.id = ci.claim_id
      JOIN people p ON p.id = c.person_id
      WHERE ci.human_status IS NULL
      ORDER BY CASE ci.purpose WHEN 'audit' THEN 0 ELSE 1 END, ci.id
      LIMIT 20
    `;
    return { report: await calibrationReport(), labels: LABELS, items };
  })
  .post(
    "/v1/calibration/:id",
    async ({ params, body, request, set }) => {
      if (!authorized(request)) {
        set.status = 401;
        return { error: "审核口令不正确" };
      }
      if (!(LABELS as readonly string[]).includes(body.human_status)) {
        set.status = 400;
        return { error: "结论只能是已兑现、部分兑现、未兑现、证据不足或待定" };
      }
      const rows = await sql`
        UPDATE calibration_items
        SET human_status = ${body.human_status}, note = ${body.note ?? ""}, labeler = ${body.labeler ?? "reviewer"}, labeled_at = now()
        WHERE id = ${Number(params.id)} AND human_status IS NULL
        RETURNING id
      `;
      if (!rows.length) {
        set.status = 404;
        return { error: "这一条不存在或已经标过" };
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ human_status: t.String(), note: t.Optional(t.String()), labeler: t.Optional(t.String()) }),
    },
  )
  .post(
    "/v1/calibration/sample",
    async ({ body, request, set }) => {
      if (!authorized(request)) {
        set.status = 401;
        return { error: "审核口令不正确" };
      }
      return { sampled: await sampleCalibration(Math.max(1, Math.min(300, body.n ?? 120))) };
    },
    { body: t.Object({ n: t.Optional(t.Number()) }) },
  )
  // 更正通道: public counter-evidence on a published claim; the review desk accepts or rejects it.
  .post(
    "/v1/claims/:claimId/challenges",
    async ({ params, body, set }) => {
      try {
        const result = await submitChallenge({ claimId: params.claimId, url: body.url, note: body.note });
        void notify("challenge", `有新的反证：${params.claimId}`).catch(() => {});
        return result;
      } catch (error) {
        if (!(error instanceof ChallengeError)) throw error;
        set.status = error.status;
        return { error: error.message };
      }
    },
    { params: t.Object({ claimId: t.String() }), body: t.Object({ url: t.String(), note: t.String() }) },
  )
  .post(
    "/v1/disagreements/:claimId",
    async ({ params, body, request, set }) => {
      if (!authorized(request)) {
        set.status = 401;
        return { error: "审核口令不正确" };
      }
      if (!STATUSES.includes(body.status)) {
        set.status = 400;
        return { error: "未知状态" };
      }
      const personId = await resolveDisagreement(params.claimId, body.status);
      if (!personId) {
        set.status = 404;
        return { error: "没有这条待裁定的分歧" };
      }
      return { ok: true, person_id: personId };
    },
    { params: t.Object({ claimId: t.String() }), body: t.Object({ status: t.String() }) },
  )
  .post(
    "/v1/challenges/:id/:action",
    async ({ params, body, request, set }) => {
      if (!authorized(request)) {
        set.status = 401;
        return { error: "审核口令不正确" };
      }
      if (params.action !== "accept" && params.action !== "reject") {
        set.status = 400;
        return { error: "未知动作" };
      }
      try {
        return await decideChallenge(Number(params.id), params.action, body.note ?? "");
      } catch (error) {
        if (!(error instanceof ChallengeError)) throw error;
        set.status = error.status;
        return { error: error.message };
      }
    },
    { params: t.Object({ id: t.String(), action: t.String() }), body: t.Object({ note: t.Optional(t.String()) }) },
  )
  .post(
    "/v1/verdicts/:id/:action",
    async ({ params, body, request, set }) => {
      if (!authorized(request)) {
        set.status = 401;
        return { error: "审核口令不正确" };
      }
      if (params.action !== "accept" && params.action !== "reject") {
        set.status = 400;
        return { error: "未知动作" };
      }
      const rows = await sql<
        {
          id: number;
          claim_id: string;
          person_id: string;
          status: string;
          actual_result: string;
          rationale: string;
          evidence: { url: string }[];
          state: string;
          claim_status: string;
          publication: string;
        }[]
      >`
        SELECT v.id, v.claim_id, v.person_id, v.status, v.actual_result, v.rationale, v.evidence, v.state,
               c.status AS claim_status, c.publication
        FROM verdict_proposals v JOIN claims c ON c.id = v.claim_id
        WHERE v.id = ${Number(params.id)} LIMIT 1
      `;
      const verdict = rows[0];
      if (!verdict || verdict.state !== "pending") {
        set.status = 404;
        return { error: "没有这条待审判定" };
      }
      if (params.action === "reject") {
        await sql`UPDATE verdict_proposals SET state = 'rejected', decided_at = now() WHERE id = ${verdict.id}`;
        await logEvent({
          claim_id: verdict.claim_id,
          person_id: verdict.person_id,
          action: "verdict_rejected",
          actor: "reviewer",
          note: `verdict_proposals#${verdict.id}`,
        });
        return { ok: true };
      }
      const status = body?.status ?? verdict.status;
      if (!STATUSES.includes(status)) {
        set.status = 400;
        return { error: "未知状态" };
      }
      if (JUDGED.has(status) && verdict.evidence.length === 0) {
        set.status = 409;
        return { error: `判定为「${status}」至少要有一条证据。这条提案没有通过原文核对的证据，只能驳回或改成证据不足。` };
      }
      await sql`
        UPDATE claims
        SET status = ${status}, actual_result = ${verdict.actual_result}, rationale = ${verdict.rationale},
            evidence = ${sql.json(verdict.evidence)}, reviewed_at = now()
        WHERE id = ${verdict.claim_id}
      `;
      await sql`UPDATE verdict_proposals SET state = 'accepted', status = ${status}, decided_at = now() WHERE id = ${verdict.id}`;
      await logEvent({
        claim_id: verdict.claim_id,
        person_id: verdict.person_id,
        action: "verdict_accepted",
        actor: "reviewer",
        before: { status: verdict.claim_status },
        after: { status, evidence: verdict.evidence.map((item) => item.url) },
        note: `verdict_proposals#${verdict.id}`,
      });
      if (verdict.publication === "published") {
        await recomputeScores(verdict.person_id, { claim_id: verdict.claim_id, action: "verdict" });
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String(), action: t.String() }),
      body: t.Optional(t.Object({ status: t.Optional(t.String()) })),
    },
  )
  .post(
    "/v1/analyze",
    async ({ body, set, request, server }) => {
      const query = (body.query || "").trim().slice(0, 60);
      if (query.length < 2) {
        set.status = 400;
        return { error: "请输入人名" };
      }
      if (!arkConfigured()) {
        set.status = 503;
        return { error: "没有配置模型密钥，agent 无法运行" };
      }
      const same = await sql<{ id: string }[]>`
        SELECT id FROM jobs
        WHERE kind = 'analyze_person' AND lower(query) = lower(${query})
          AND (state IN ('queued', 'running') OR (state = 'done' AND created_at > now() - interval '1 hour'))
        ORDER BY created_at DESC LIMIT 1
      `;
      if (same[0]) return { job_id: same[0].id, reused: true };
      const [today] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE created_at > now() - interval '1 day' AND runner = 'api'`;
      if (today.n >= DAILY_JOB_LIMIT) {
        set.status = 429;
        return { error: `今天的分析次数已用完（${DAILY_JOB_LIMIT} 次）` };
      }
      const rawIp = clientAddress(request.headers, process.env.TRUST_PROXY === "1", server?.requestIP(request)?.address ?? "");
      const clientIp = hashClientIp(rawIp, process.env.IP_HASH_SALT ?? "");
      if (!ipAnalyzeAllowed(await recentAnalyzeCount(sql, clientIp))) {
        set.status = 429;
        return { error: "每天最多发起 3 次新分析，已收录的人物可以随便看" };
      }
      const [job] = await sql<{ id: string }[]>`
        INSERT INTO jobs (kind, query, runner, client_ip) VALUES ('analyze_person', ${query}, 'api', ${clientIp}) RETURNING id
      `;
      // Full concurrency leaves the row queued; pump starts it when a running analysis finishes.
      await pumpApiQueue();
      return { job_id: job.id, reused: false };
    },
    { body: t.Object({ query: t.String() }) },
  )
  .get("/v1/jobs/:id", async ({ params, set }) => {
    if (!/^[0-9a-f-]{36}$/.test(params.id)) {
      set.status = 404;
      return { error: "没有这个任务" };
    }
    const jobs = await sql`
      SELECT j.id, j.kind, j.query, j.person_id, j.state, j.result, j.created_at, j.updated_at,
             p.name AS person_name, p.name_en AS person_name_en, p.title AS person_title, p.visibility
      FROM jobs j LEFT JOIN people p ON p.id = j.person_id
      WHERE j.id = ${params.id}
    `;
    if (!jobs[0]) {
      set.status = 404;
      return { error: "没有这个任务" };
    }
    const events = await sql`
      SELECT id, step, status, message, data, created_at FROM job_events WHERE job_id = ${params.id} ORDER BY id
    `;
    return { job: jobs[0], events, queue_position: await queuePosition(sql, params.id) };
  })
  .get("/v1/people/:id/history", async ({ params }) => {
    const [snapshots, events] = await Promise.all([
      sql`
        SELECT domain, value::float8 AS value, low::float8 AS low, high::float8 AS high, n, confidence, formula_version,
               trigger_claim_id, trigger_action, computed_at, basis
        FROM score_snapshots
        WHERE person_id = ${params.id}
        ORDER BY computed_at DESC
        LIMIT 200
      `,
      sql`
        SELECT claim_id, action, actor, before, after, note, created_at
        FROM claim_events
        WHERE person_id = ${params.id}
        ORDER BY created_at DESC
        LIMIT 200
      `,
    ]);
    return { snapshots, events };
  });

const port = Number(process.env.PORT || 3011);
app.listen(port);
console.log(`prediction-tracker-api http://127.0.0.1:${port}`);
