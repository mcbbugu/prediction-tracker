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
import { arkJson, arkSearch } from "../core/ark";
import { maybeQueueAudit, verdictAutoPublish } from "../scoring/calibration";
import { sql } from "../core/db";
import { logEvent } from "../core/migrate";
import { excerpt, quoteOnPage, snapshot, usableLinks, type Snapshot } from "../evidence/sources";

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

export type PageJudgement = {
  status: string;
  actual_result: string;
  rationale: string;
  kept: KeptEvidence[];
  rejected: { url: string; quote: string; reason: string }[];
};

// Steps 3–5: judge using only the saved page text; keep only evidence sentences found word for word.
export async function judgeOnPages(claim: DueClaim, pages: Snapshot[], budget = 5000): Promise<PageJudgement> {
  const keys = terms(claim);
  const answer = (await arkJson(
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

  return { status, actual_result: (answer.actual_result ?? "").trim(), rationale, kept, rejected };
}

export function outcomeQuery(claim: DueClaim) {
  return (
    `请联网搜索：${claim.name_en} 在 ${claim.published_date} 说过：“${claim.quote_en}”（${claim.quote_zh}）。` +
    `截止日是 ${claim.deadline}。找出能说明截止日前后这件事实际有没有发生的报道或官方资料，` +
    `优先官方公告、财报、主流媒体，发表时间最好在截止日之后。列出 3 到 6 个网页链接。`
  );
}

export async function verifyClaim(claim: DueClaim, emit: Emit = silent): Promise<VerdictOutcome> {
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
  await emit("info", `找到 ${candidates.length} 个链接，成功存档 ${pages.length} 个`, {
    archived: pages.map((page) => page.final_url),
    unreachable,
  });

  if (pages.length === 0) {
    const trace = verdictTrace("证据不足", [], []);
    await emit("done", "判定建议：证据不足（没有可核对的网页）", trace);
    return { status: "证据不足", pages: 0, evidence_kept: 0, evidence_rejected: 0, unreachable: unreachable.length, proposal_id: null, accepted: [], rejected: [] };
  }

  const judged = await judgeOnPages(claim, pages);
  const { status, rationale, kept, rejected } = judged;

  const rows = await sql<{ id: number }[]>`
    INSERT INTO verdict_proposals (claim_id, person_id, status, actual_result, rationale, evidence, rejected_evidence, search_query)
    VALUES (
      ${claim.id},
      ${claim.person_id},
      ${status},
      ${judged.actual_result},
      ${rationale},
      ${sql.json(kept)},
      ${sql.json(rejected)},
      ${query}
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
  };
}

// Local-only mode (AUTO_PUBLISH): apply a verdict without a reviewer. The claim stays marked as
// machine-checked (reviewed_at is null) so the site can label it. Judged verdicts still need evidence.
export async function applyVerdictAutomatically(proposalId: number) {
  const rows = await sql<{ id: number; claim_id: string; person_id: string; status: string; actual_result: string; rationale: string; evidence: unknown[] }[]>`
    SELECT id, claim_id, person_id, status, actual_result, rationale, evidence
    FROM verdict_proposals WHERE id = ${proposalId} AND state = 'pending'
  `;
  const verdict = rows[0];
  if (!verdict) return false;
  if (JUDGED.has(verdict.status) && verdict.evidence.length === 0) return false;
  await sql`
    UPDATE claims
    SET status = ${verdict.status}, actual_result = ${verdict.actual_result}, rationale = ${verdict.rationale},
        evidence = ${sql.json(verdict.evidence as never)}
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
