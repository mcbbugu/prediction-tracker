// 到期核对：为一条截止日已过的主张找结果，生成判定提案（verdict_proposals），交给审核台。
//
// How links are handled — the model is never trusted on its own:
//   1. The model searches the web and suggests links. Its answer text is thrown away.
//   2. We open every link ourselves and save the page text with a timestamp and sha256 (table `sources`).
//      Links that do not open, or open to an empty page, are dropped.
//   3. A second call judges the claim using ONLY the saved page text, and must copy supporting sentences word for word.
//   4. Code checks each copied sentence really is in that saved page. Sentences that are not found are discarded.
//   5. A verdict of 已兑现/部分兑现/未兑现 with no surviving evidence becomes 证据不足.
//   6. The result is a proposal. Only a person on /review can apply it to the public record.
import { arkJson, arkSearch, takeModelCallId } from "../core/ark";
import { maybeQueueAudit, verdictAutoPublish } from "../scoring/calibration";
import { recomputeScores } from "../scoring/score";
import { sql } from "../core/db";
import { logEvent } from "../core/migrate";
import { excerpt, quoteOnPage, snapshot, usableLinks, type Snapshot } from "../evidence/sources";
import { resolveProposition } from "../scoring/resolvers";
import { challengeReview } from "../queries/verdict-tier";

export const STATUSES = ["已兑现", "部分兑现", "未兑现", "待定", "证据不足"];
export const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);
const MAX_PAGES = 5;

export type DueClaim = {
  id: string;
  person_id: string;
  name_en: string;
  category: string;
  quote_en: string;
  quote_zh: string;
  source_url: string;
  published_date: string;
  deadline: string;
};

export type Emit = (status: "running" | "done" | "failed" | "info", message: string, data?: Record<string, unknown>) => Promise<void>;

type Judgement = {
  status?: string;
  actual_result?: string;
  rationale?: string;
  evidence?: { page?: number; quote?: string }[];
};

function terms(claim: DueClaim) {
  const words = `${claim.quote_en} ${claim.category}`.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  const stop = new Set(["will", "that", "this", "with", "have", "from", "they", "next", "year", "would", "should", "about", "there", "their", "probably", "think", "going", "able", "within", "years"]);
  const cjk = claim.quote_zh.match(/[一-鿿]{2,4}/g) ?? [];
  return [...new Set([...words.filter((word) => !stop.has(word)), ...cjk.slice(0, 12)])];
}

export type VerdictOutcome = {
  status: string;
  pages: number;
  evidence_kept: number;
  evidence_rejected: number;
  unreachable: number;
  proposal_id: number | null;
  accepted: { source_id: number; url: string }[];
  rejected: { url: string; quote: string; reason: string }[];
  agreed: boolean;
  second_status: string | null;
};

export function verdictTrace(status: string, kept: KeptEvidence[], rejected: { url: string; quote: string; reason: string }[]) {
  return {
    status,
    evidence: kept.map((item) => ({ url: item.url, quote: item.quote })),
    accepted: kept.map((item) => ({ source_id: item.source_id, url: item.url })),
    rejected: rejected.map((item) => ({ url: item.url, quote: item.quote, reason: item.reason })),
  };
}

const silent: Emit = async () => {};

export type KeptEvidence = { url: string; quote: string; source_id: number; fetched_at: string; sha256: string };

export const JUDGE_V1 = "JUDGE_V1";
export const CROSS_V1 = "CROSS_V1";

export type PageJudgement = {
  status: string;
  actual_result: string;
  rationale: string;
  kept: KeptEvidence[];
  rejected: { url: string; quote: string; reason: string }[];
  model_call_id: string | null;
};

// Steps 3–5: judge using only the saved page text; keep only evidence sentences found word for word.
export async function judgeOnPages(claim: DueClaim, pages: Snapshot[], budget = 5000, system?: string): Promise<PageJudgement> {
  const keys = terms(claim);
  const answer = (await arkJson(
    system ??
    [
      "你是事实核查员。只能依据用户给出的网页原文判断，不能用你自己的记忆或常识补充事实。",
      "任务：判断这条预测在截止日时是否兑现。",
      "status 只能是：已兑现、部分兑现、未兑现、待定、证据不足。",
      "- 原文明确说明截止日前做到了 → 已兑现；只做到一部分或打了折扣 → 部分兑现；原文明确说明截止日时没做到 → 未兑现。",
      "- 原文没有直接回答这个问题 → 证据不足。不要推测。",
      "evidence 里的 quote 必须从对应 page 的原文里逐字复制一句或一段（20 到 300 字），不要改写、翻译或拼接不同位置的句子。",
      "actual_result 用中文写一到两句，只陈述原文里的事实，不评价这个人。",
      '输出 JSON：{"status":"","actual_result":"","rationale":"","evidence":[{"page":1,"quote":""}]}',
    ].join("\n"),
    JSON.stringify({
      claim: {
        speaker: claim.name_en,
        said_on: claim.published_date,
        deadline: claim.deadline,
        quote_en: claim.quote_en,
        quote_zh: claim.quote_zh,
        domain: claim.category,
      },
      pages: pages.map((page, index) => ({
        page: index + 1,
        url: page.final_url,
        title: page.title,
        text: excerpt(page.text, keys, budget),
      })),
    }),
    2500,
    system ? CROSS_V1 : JUDGE_V1,
  )) as Judgement;

  const kept: KeptEvidence[] = [];
  const rejected: { url: string; quote: string; reason: string }[] = [];
  for (const item of answer.evidence ?? []) {
    const page = pages[(item.page ?? 0) - 1];
    const quote = (item.quote ?? "").trim();
    if (!page) {
      rejected.push({ url: "", quote, reason: "引用了不存在的页面编号" });
      continue;
    }
    if (!quoteOnPage(quote, page.text)) {
      rejected.push({ url: page.final_url, quote, reason: "原文里找不到这句话" });
      continue;
    }
    kept.push({ url: page.final_url, quote, source_id: page.id, fetched_at: new Date().toISOString(), sha256: page.sha256 });
  }

  let status = STATUSES.includes(answer.status ?? "") ? (answer.status as string) : "证据不足";
  let rationale = (answer.rationale ?? "").trim();
  if (JUDGED.has(status) && kept.length === 0) {
    rationale = `模型判为「${status}」，但引用的句子都没能在原文里找到，降为证据不足。${rationale}`;
    status = "证据不足";
  }

  return { status, actual_result: (answer.actual_result ?? "").trim(), rationale, kept, rejected, model_call_id: takeModelCallId(answer) };
}

export function outcomeQuery(claim: DueClaim) {
  return (
    `请联网搜索：${claim.name_en} 在 ${claim.published_date} 说过：“${claim.quote_en}”（${claim.quote_zh}）。` +
    `截止日是 ${claim.deadline}。找出能说明截止日前后这件事实际有没有发生的报道或官方资料，` +
    `优先官方公告、财报、主流媒体，发表时间最好在截止日之后。列出 3 到 6 个网页链接。`
  );
}

export function verdictsAgree(first: string, second: string) {
  return first === second;
}

const CROSS_PROMPT = [
  "你是另一位事实核查员，独立判断。没有人告诉你先前的结论，你也不要假设已经有了结论。",
  "只能依据用户给出的网页原文，不能用记忆补充事实。",
  "status 只能是：已兑现、部分兑现、未兑现、待定、证据不足。",
  "原文明确做到了 → 已兑现；只做到一部分 → 部分兑现；原文明确没做到 → 未兑现；原文没直接回答 → 证据不足。",
  "evidence 里的 quote 必须从对应 page 的原文逐字复制（20 到 300 字）。",
  '输出 JSON：{"status":"","actual_result":"","rationale":"","evidence":[{"page":1,"quote":""}]}',
].join("\n");

// Second opinion on pages we already archived. No web search, so it does not spend search AFP.
export async function crossJudge(claim: DueClaim, pages: Snapshot[]) {
  return judgeOnPages(claim, pages, 5000, CROSS_PROMPT);
}

async function deterministicVerdict(claim: DueClaim, emit: Emit): Promise<VerdictOutcome | null> {
  const rows = await sql<{ resolver: string; comparator: string | null; threshold: number | null; deadline: string | null; resolver_args: { org_key?: string; field?: string; symbol?: string } }[]>`
    SELECT resolver, comparator, threshold::float8 AS threshold, to_char(deadline, 'YYYY-MM-DD') AS deadline, resolver_args
    FROM propositions
    WHERE claim_id = ${claim.id} AND superseded_by IS NULL AND resolver IN ('sec_xbrl', 'price')
    LIMIT 1
  `;
  const proposition = rows[0];
  if (!proposition) return null;
  const resolution = await resolveProposition({
    resolver: proposition.resolver,
    comparator: proposition.comparator,
    threshold: proposition.threshold,
    deadline: proposition.deadline,
    resolver_args: proposition.resolver_args ?? {},
  });
  if (!resolution || !JUDGED.has(resolution.status) || !resolution.evidence_url) return null;
  const evidence = [{
    url: resolution.evidence_url,
    quote: resolution.detail,
    source_id: resolution.evidence_ids[0] ?? 0,
    fetched_at: new Date().toISOString(),
    sha256: "",
  }];
  const rationale = `确定性判定（${proposition.resolver}）：${resolution.detail}`;
  const inserted = await sql<{ id: number }[]>`
    INSERT INTO verdict_proposals (claim_id, person_id, status, actual_result, rationale, evidence, rejected_evidence, search_query, resolved_by)
    VALUES (
      ${claim.id}, ${claim.person_id}, ${resolution.status}, ${resolution.detail}, ${rationale},
      ${sql.json(evidence)}, '[]'::jsonb, '', ${proposition.resolver}
    )
    RETURNING id::int AS id
  `;
  await logEvent({
    claim_id: claim.id,
    person_id: claim.person_id,
    action: "verdict_proposed",
    actor: "agent",
    after: { status: resolution.status, resolved_by: proposition.resolver, computed_value: resolution.computed_value },
    note: `verdict_proposals#${inserted[0].id}`,
  });
  const trace = verdictTrace(resolution.status, evidence, []);
  await emit("done", `判定建议：${resolution.status}（${proposition.resolver}，没有调用模型）`, { ...trace, resolved_by: proposition.resolver });
  return {
    status: resolution.status,
    pages: 1,
    evidence_kept: 1,
    evidence_rejected: 0,
    unreachable: 0,
    proposal_id: inserted[0].id,
    accepted: trace.accepted,
    rejected: [],
    agreed: true,
    second_status: null,
  };
}

export async function verifyClaim(claim: DueClaim, emit: Emit = silent, options?: { cross?: boolean; extraUrls?: string[] }): Promise<VerdictOutcome> {
  const deterministic = await deterministicVerdict(claim, emit);
  if (deterministic) return deterministic;
  const query = outcomeQuery(claim);

  await emit("running", `搜索这条预测的实际结果`, { claim: claim.id });
  const search = await arkSearch(query);
  const candidates = usableLinks(search.urls, [claim.source_url]).slice(0, 8);

  const pages: Snapshot[] = [];
  const unreachable: string[] = [];
  for (const url of candidates) {
    if (pages.length >= MAX_PAGES) break;
    const page = await snapshot(url);
    if (!page || page.http_status >= 400 || page.text.length < 400) {
      unreachable.push(url);
      continue;
    }
    pages.push(page);
  }
  for (const url of options?.extraUrls ?? []) {
    if (pages.length >= MAX_PAGES || pages.some((page) => page.url === url || page.final_url === url)) continue;
    const page = await snapshot(url);
    if (!page || page.http_status >= 400 || page.text.length < 400) {
      unreachable.push(url);
      continue;
    }
    pages.push(page);
  }
  await emit("info", `找到 ${candidates.length} 个链接，成功存档 ${pages.length} 个`, {
    archived: pages.map((page) => page.final_url),
    unreachable,
  });

  if (pages.length === 0) {
    const trace = verdictTrace("证据不足", [], []);
    await emit("done", "判定建议：证据不足（没有可核对的网页）", trace);
    return { status: "证据不足", pages: 0, evidence_kept: 0, evidence_rejected: 0, unreachable: unreachable.length, proposal_id: null, accepted: [], rejected: [], agreed: true, second_status: null };
  }

  const judged = await judgeOnPages(claim, pages);
  const { status, rationale, kept, rejected } = judged;

  const rows = await sql<{ id: number }[]>`
    INSERT INTO verdict_proposals (claim_id, person_id, status, actual_result, rationale, evidence, rejected_evidence, search_query, model_call_id, resolved_by)
    VALUES (
      ${claim.id},
      ${claim.person_id},
      ${status},
      ${judged.actual_result},
      ${rationale},
      ${sql.json(kept)},
      ${sql.json(rejected)},
      ${query},
      ${judged.model_call_id},
      'model'
    )
    RETURNING id
  `;
  await logEvent({
    claim_id: claim.id,
    person_id: claim.person_id,
    action: "verdict_proposed",
    actor: "agent",
    after: { status, evidence: kept.map((item) => item.url) },
    note: `verdict_proposals#${rows[0].id}`,
  });
  let agreed = true;
  let secondStatus: string | null = null;
  if (options?.cross) {
    const second = await crossJudge(claim, pages);
    secondStatus = second.status;
    agreed = verdictsAgree(status, second.status);
    if (!agreed) {
      await sql`
        UPDATE claims SET disagreement = ${sql.json({
          first: { status, rationale },
          second: { status: second.status, rationale: second.rationale },
        })}
        WHERE id = ${claim.id}
      `;
    }
    await emit("info", agreed ? `交叉判定一致：${status}` : `交叉判定不一致：${status} / ${second.status}`, {
      agreed,
      second_status: second.status,
    });
  }
  const trace = verdictTrace(status, kept, rejected);
  await emit("done", `判定建议：${status}（证据 ${kept.length} 条通过原文核对，丢弃 ${rejected.length} 条）`, trace);
  return {
    status,
    pages: pages.length,
    evidence_kept: kept.length,
    evidence_rejected: rejected.length,
    unreachable: unreachable.length,
    proposal_id: Number(rows[0].id),
    accepted: trace.accepted,
    rejected: trace.rejected,
    agreed,
    second_status: secondStatus,
  };
}

// An auto-collected person becomes「双模型一致」only when every cross-check agreed and no challenge is waiting.
// reviewed stays reserved for a person.
export async function promoteIfUnanimous(personId: string, checked: number) {
  if (checked < 1) return false;
  const [open] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM claims WHERE person_id = ${personId} AND disagreement IS NOT NULL
  `;
  const [pending] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM challenges WHERE person_id = ${personId} AND state = 'pending'
  `;
  if ((open?.n ?? 0) > 0 || (pending?.n ?? 0) > 0) return false;
  const updated = await sql`
    UPDATE people SET curation = 'cross_checked'
    WHERE id = ${personId} AND curation = 'auto'
    RETURNING id
  `;
  return updated.length > 0;
}

export async function resolveDisagreement(claimId: string, status: string) {
  const rows = await sql<{ person_id: string }[]>`
    UPDATE claims
    SET status = ${status}, disagreement = NULL, reviewed_at = now()
    WHERE id = ${claimId} AND disagreement IS NOT NULL
    RETURNING person_id
  `;
  const personId = rows[0]?.person_id;
  if (!personId) return null;
  await recomputeScores(personId, { claim_id: claimId, action: "disagreement_resolved" });
  return personId;
}

// Local-only mode (AUTO_PUBLISH): apply a verdict without a reviewer. The claim stays marked as
// machine-checked (reviewed_at is null) so the site can label it. Judged verdicts still need evidence.
export async function applyVerdictAutomatically(proposalId: number) {
  const rows = await sql<{ id: number; claim_id: string; person_id: string; status: string; actual_result: string; rationale: string; evidence: unknown[]; resolved_by: string | null }[]>`
    SELECT id, claim_id, person_id, status, actual_result, rationale, evidence, resolved_by
    FROM verdict_proposals WHERE id = ${proposalId} AND state = 'pending'
  `;
  const verdict = rows[0];
  if (!verdict) return false;
  if (JUDGED.has(verdict.status) && verdict.evidence.length === 0) return false;
  await sql`
    UPDATE claims
    SET status = ${verdict.status}, actual_result = ${verdict.actual_result}, rationale = ${verdict.rationale},
        evidence = ${sql.json(verdict.evidence as never)},
        resolved_by = COALESCE(${verdict.resolved_by}, resolved_by)
    WHERE id = ${verdict.claim_id}
  `;
  await sql`UPDATE verdict_proposals SET state = 'auto_applied', decided_at = now() WHERE id = ${verdict.id}`;
  await logEvent({
    claim_id: verdict.claim_id,
    person_id: verdict.person_id,
    action: "verdict_auto_applied",
    actor: "agent",
    after: { status: verdict.status },
    note: `verdict_proposals#${verdict.id}`,
  });
  return true;
}

// An agent verdict takes effect without a person only in local mode or once calibration has passed
// (SPEC 核对分层 · 校准规则); in calibrated mode 5% of them are queued for a blind audit.
export async function applyVerdictIfAllowed(proposalId: number) {
  const gate = await verdictAutoPublish();
  if (!gate.allowed) return false;
  const applied = await applyVerdictAutomatically(proposalId);
  if (applied) await maybeQueueAudit(proposalId, gate.mode);
  return applied;
}

// A public challenge already archived its page. Judge again with that page included.
export async function rejudgeChallenge(claimId: string) {
  const rows = await sql<(DueClaim & { status: string })[]>`
    SELECT c.id, c.person_id, p.name_en, c.category, c.quote_en, c.quote_zh, c.source_url,
           to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
           to_char(c.deadline, 'YYYY-MM-DD') AS deadline, c.status
    FROM claims c
    JOIN people p ON p.id = c.person_id
    WHERE c.id = ${claimId}
    LIMIT 1
  `;
  const claim = rows[0];
  if (!claim) return null;
  const extras = await sql<{ url: string }[]>`
    SELECT url FROM challenges WHERE target_kind = 'claim' AND target_id = ${claimId} AND state = 'pending'
  `;
  const outcome = await verifyClaim(claim, silent, { extraUrls: extras.map((row) => row.url) });
  if (outcome.proposal_id) await applyVerdictAutomatically(outcome.proposal_id);
  const [after] = await sql<{ status: string }[]>`SELECT status FROM claims WHERE id = ${claimId}`;
  const next = after?.status ?? claim.status;
  const review = challengeReview(claim.status, next);
  if (review.changed) {
    await logEvent({
      claim_id: claimId,
      person_id: claim.person_id,
      action: "challenge_rejudged",
      actor: "agent",
      before: { status: claim.status },
      after: { status: next },
      note: "反证加入后结论改变",
    });
    await recomputeScores(claim.person_id, { claim_id: claimId, action: "challenge_rejudged" });
  } else {
    await logEvent({
      claim_id: claimId,
      person_id: claim.person_id,
      action: "challenge_rechecked",
      actor: "agent",
      note: "已复核，结论不变",
    });
  }
  return { ...review, status: next };
}
