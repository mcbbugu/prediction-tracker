// pnpm api:seed-check — 种子主张发布前的自动核对（SPEC「真数据」和「mock」，2026-10-21）。
//
// For every hand-curated claim still in the review queue (provenance = manual, publication = proposed):
//   1. Archive source_url ourselves and check the quote appears word for word. Fails → stays in review.
//   2. Judged claims (已兑现/部分兑现/未兑现): archive the seed's evidence links, judge using only that saved
//      text (same judge as the agent), keep only evidence sentences found word for word.
//      Machine verdict equals the human status and ≥1 sentence survived → published as 机器核对
//      (reviewed_at stays null). Otherwise the machine verdict becomes a pending verdict_proposal for a person.
//   3. 待定 claims are published once the quote check passes.
// Fallbacks that keep the same bar: a page that no longer opens (or no longer carries the quote) is archived
// from its Internet Archive copy instead; when the seed's own evidence is not enough, the agent's outcome search
// adds candidate pages, which are archived and judged the same way.
// Nothing is deleted; every decision is logged in claim_events.
import { sql } from "./db";
import { logEvent, migrate } from "./migrate";
import { recomputeScores } from "./score";
import { ArkStopped, arkJson, arkSearch } from "./ark";
import { excerpt, quoteOnPage, snapshot, usableLinks, type Snapshot } from "./sources";
import { JUDGED, judgeOnPages, outcomeQuery, type DueClaim, type PageJudgement } from "./verdict";

const CONCURRENCY = Number(process.env.SEED_CHECK_CONCURRENCY || 2);
const MARK = "seed-check：种子自带的证据链接";
const MAX_PAGES = 8;

type Row = DueClaim & { quote_original: string; status: string; evidence: { url: string }[] };

type Outcome = { id: string; person_id: string; published: boolean; reason: string };

async function hasPublishedDuplicate(claim: Row) {
  const rows = await sql`
    SELECT id FROM claims
    WHERE person_id = ${claim.person_id} AND quote_en = ${claim.quote_en} AND deadline = ${claim.deadline}
      AND publication = 'published' AND id <> ${claim.id}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function hold(claim: Row, reason: string): Promise<Outcome> {
  await sql`
    UPDATE claims
    SET rationale = ${`人工整理的种子记录。自动核对未通过：${reason}。请人工点开出处和证据核对。`}
    WHERE id = ${claim.id}
  `;
  await logEvent({
    claim_id: claim.id,
    person_id: claim.person_id,
    action: "seed_autocheck_held",
    actor: "agent",
    note: reason,
  });
  return { id: claim.id, person_id: claim.person_id, published: false, reason };
}

function usable(page: Snapshot | null): page is Snapshot {
  return !!page && page.http_status < 400 && page.text.length >= 200;
}

// Internet Archive copy closest to `date`; `id_` returns the original page without the archive toolbar.
function waybackUrl(url: string, date: string) {
  return `https://web.archive.org/web/${date.replace(/-/g, "")}id_/${url}`;
}

async function archive(url: string, date: string, accept: (page: Snapshot) => boolean = () => true) {
  const page = await snapshot(url);
  if (usable(page) && accept(page)) return page;
  const copy = await snapshot(waybackUrl(url, date));
  if (usable(copy) && accept(copy)) return copy;
  return usable(page) ? page : usable(copy) ? copy : null;
}

// Pages that may carry the quote: the seed link, its Internet Archive copy from that date, and search results.
// Search is a helper, not a requirement: when Ark web search is unavailable, carry on with the pages we have.
let searchDown = "";
async function search(query: string) {
  try {
    return (await arkSearch(query)).urls;
  } catch (error) {
    if (error instanceof ArkStopped) throw error;
    searchDown = (error as Error).message.slice(0, 160);
    return [];
  }
}

async function quotePages(claim: Row, quote: string) {
  const pages: Snapshot[] = [];
  for (const url of [claim.source_url, waybackUrl(claim.source_url, claim.published_date)]) {
    const page = await snapshot(url);
    if (usable(page)) pages.push(page);
  }
  const queries = [
    `Find the original source where ${claim.name_en} said, around ${claim.published_date}: "${quote}". ` +
      `List 3 to 6 links to news reports, transcripts or official pages that print what he said.`,
    `请联网搜索 ${claim.name_en} 在 ${claim.published_date} 前后说的这句话的出处：“${quote}”（${claim.quote_zh}）。列出刊登这句话的报道、文字实录或官方页面链接。`,
  ];
  const tried = new Set<string>([claim.source_url]);
  const urls: string[] = [];
  for (const query of queries) urls.push(...(await search(query)));
  for (const url of usableLinks(urls).slice(0, 10)) {
    if (tried.has(url)) continue;
    tried.add(url);
    const page = await snapshot(url);
    if (usable(page)) pages.push(page);
  }
  return pages;
}

// Seed quotes are often written from memory. Ask the model to copy, word for word, the sentence on a saved
// page where the speaker makes this same prediction; code then checks it is really on that page.
async function correctQuote(claim: Row, quote: string, pages: Snapshot[]) {
  const surname = claim.name_en.split(/\s+/).pop()!.toLowerCase();
  const candidates = pages.filter((page) => page.text.toLowerCase().includes(surname)).slice(0, 6);
  if (candidates.length === 0) return null;
  const answer = (await arkJson(
    [
      "你是事实核查员。下面是程序存档的网页原文，以及一条人工整理、可能凭记忆改写过的原话。",
      `任务：在网页原文里找到 ${claim.name_en} 本人说出这条预测的那句话（直接引语或文字实录），逐字复制。`,
      "- 必须是这个人自己说的话，不能是记者的转述或别人说的。",
      "- 意思必须和人工整理的原话一致（同一件事、同一个时间点）；找不到就返回空字符串，不要凑。",
      "- 逐字复制原文，可以只取一句或连续的几句（20 到 400 字），不要改写、翻译或拼接不同位置的句子。",
      '输出 JSON：{"page":1,"quote":""}',
    ].join("\n"),
    JSON.stringify({
      speaker: claim.name_en,
      said_on: claim.published_date,
      seed_quote: quote,
      seed_quote_zh: claim.quote_zh,
      pages: candidates.map((page, index) => ({
        page: index + 1,
        url: page.final_url,
        title: page.title,
        text: excerpt(page.text, [surname, ...quote.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []], 8000),
      })),
    }),
    1200,
  )) as { page?: number; quote?: string };
  const page = candidates[(answer.page ?? 0) - 1];
  const corrected = (answer.quote ?? "").trim();
  if (!page || corrected.length < 20 || !quoteOnPage(corrected, page.text)) return null;
  return { page, quote: corrected };
}

async function check(claim: Row): Promise<Outcome> {
  if (await hasPublishedDuplicate(claim)) return hold(claim, "已有相同原话和截止日的公开记录");

  // 1. 原话核对
  const quote = claim.quote_original.trim() || claim.quote_en;
  let source = await archive(claim.source_url, claim.published_date, (page) => quoteOnPage(quote, page.text));
  if (!source || !quoteOnPage(quote, source.text)) {
    const pages = await quotePages(claim, quote);
    if (pages.length === 0) return hold(claim, "出处页打不开（网页存档和搜索其他出处都没有）");
    const verbatim = pages.find((page) => quoteOnPage(quote, page.text));
    const found = verbatim ? { page: verbatim, quote } : await correctQuote(claim, quote, pages);
    if (!found) return hold(claim, "原话在出处页里找不到（其他出处也没找到这人说这件事的原文）");
    const original = /[\u3400-\u9fff]/.test(found.quote);
    await sql`
      UPDATE claims
      SET source_url = ${found.page.final_url},
          quote_en = ${original ? claim.quote_en : found.quote},
          quote_original = ${original ? found.quote : claim.quote_original}
      WHERE id = ${claim.id}
    `;
    await logEvent({
      claim_id: claim.id,
      person_id: claim.person_id,
      action: found.quote === quote ? "source_replaced" : "quote_corrected",
      actor: "agent",
      before: { source_url: claim.source_url, quote },
      after: { source_url: found.page.final_url, quote: found.quote },
      note: `原出处${source ? "里找不到这句原话" : "打不开"}；改用存档 sources#${found.page.id} 上逐字核对过的原文`,
    });
    if (!original) claim.quote_en = found.quote;
    claim.source_url = found.page.final_url;
    source = found.page;
  }

  const sourceNote = `出处存档 sources#${source.id}（${source.final_url}）sha256 ${source.sha256.slice(0, 12)}`;

  // 3. 待定：原话核对通过即可发布
  if (!JUDGED.has(claim.status)) {
    await sql`
      UPDATE claims
      SET publication = 'published', published_at = now(),
          rationale = ${"人工整理的种子记录。程序已存档出处页并逐字核对原话（机器核对）。"}
      WHERE id = ${claim.id}
    `;
    await logEvent({
      claim_id: claim.id,
      person_id: claim.person_id,
      action: "seed_autochecked",
      actor: "agent",
      before: { publication: "proposed" },
      after: { publication: "published", status: claim.status },
      note: sourceNote,
    });
    return { id: claim.id, person_id: claim.person_id, published: true, reason: "" };
  }

  // 2. 判定核对：先只用种子自带的证据链接；不够再加上 agent 的结果搜索
  const today = new Date().toISOString().slice(0, 10);
  const seedLinks = usableLinks(claim.evidence.map((item) => item.url), [claim.source_url]).slice(0, 5);
  const pages: Snapshot[] = [];
  for (const url of seedLinks) {
    const page = await archive(url, today);
    if (page) pages.push(page);
  }
  let judged: PageJudgement | null = pages.length ? await judgeOnPages(claim, pages, 12000) : null;
  let searched = false;
  if (!judged || judged.status !== claim.status || judged.kept.length === 0) {
    searched = true;
    const englishQuery =
      `Did this prediction come true by ${claim.deadline}? ${claim.name_en} said on ${claim.published_date}: "${claim.quote_en}". ` +
      `Find news reports or official announcements published around or after ${claim.deadline} that state what actually happened. List 3 to 6 links.`;
    const urls = [...(await search(outcomeQuery(claim))), ...(await search(englishQuery))];
    const tried = new Set([...seedLinks, ...pages.map((page) => page.final_url)]);
    for (const url of usableLinks(urls, [claim.source_url]).slice(0, 12)) {
      if (pages.length >= MAX_PAGES) break;
      if (tried.has(url)) continue;
      tried.add(url);
      const page = await snapshot(url);
      if (usable(page) && page.text.length >= 400) pages.push(page);
    }
    if (pages.length === 0) return hold(claim, "证据页都打不开（种子链接和搜索结果）");
    judged = await judgeOnPages(claim, pages, 8000);
  }
  const agreed = judged.status === claim.status && judged.kept.length > 0;
  const mark = searched ? `${MARK} + 结果搜索` : MARK;

  // Older pending proposals from this script are replaced by the new one.
  await sql`
    UPDATE verdict_proposals SET state = 'superseded', decided_at = now()
    WHERE claim_id = ${claim.id} AND state = 'pending' AND search_query LIKE 'seed-check%'
  `;
  const proposal = await sql<{ id: number }[]>`
    INSERT INTO verdict_proposals (claim_id, person_id, status, actual_result, rationale, evidence, rejected_evidence, search_query, state, decided_at)
    VALUES (
      ${claim.id}, ${claim.person_id}, ${judged.status}, ${judged.actual_result}, ${judged.rationale},
      ${sql.json(judged.kept)}, ${sql.json(judged.rejected)}, ${mark},
      ${agreed ? "auto_applied" : "pending"}, ${agreed ? sql`now()` : null}
    )
    RETURNING id
  `;
  const proposalNote = `verdict_proposals#${proposal[0].id}`;

  if (!agreed) {
    const reason =
      judged.kept.length === 0
        ? `证据句没有一条通过原文核对（机器结论：${judged.status}）`
        : `机器结论「${judged.status}」与人工「${claim.status}」不一致`;
    return hold(claim, `${reason}，见 ${proposalNote}`);
  }

  await sql`
    UPDATE claims
    SET publication = 'published', published_at = now(), evidence = ${sql.json(judged.kept)},
        rationale = ${`人工整理的种子记录。程序已存档出处页和证据页，原话与证据句均逐字核对通过，机器判定与人工判定一致（机器核对）。${judged.rationale}`}
    WHERE id = ${claim.id}
  `;
  await logEvent({
    claim_id: claim.id,
    person_id: claim.person_id,
    action: "seed_autochecked",
    actor: "agent",
    before: { publication: "proposed", evidence: claim.evidence.map((item) => item.url) },
    after: { publication: "published", status: claim.status, evidence: judged.kept.map((item) => item.url) },
    note: `${sourceNote}；${proposalNote}`,
  });
  return { id: claim.id, person_id: claim.person_id, published: true, reason: "" };
}

async function main() {
  await migrate();
  const claims = await sql<Row[]>`
    SELECT c.id, c.person_id, p.name_en, c.category, c.quote_en, c.quote_zh, c.quote_original, c.source_url,
           to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
           to_char(c.deadline, 'YYYY-MM-DD') AS deadline, c.status, c.evidence
    FROM claims c JOIN people p ON p.id = c.person_id
    WHERE c.provenance = 'manual' AND c.publication = 'proposed'
    ORDER BY c.person_id, c.id
  `;
  console.log(`待核对的种子主张：${claims.length} 条（并发 ${CONCURRENCY}）`);

  const outcomes: Outcome[] = [];
  let next = 0;
  async function worker() {
    while (next < claims.length) {
      const claim = claims[next++];
      let outcome: Outcome;
      try {
        outcome = await check(claim);
      } catch (error) {
        outcome = await hold(claim, `核对出错：${(error as Error).message.slice(0, 120)}`);
      }
      outcomes.push(outcome);
      console.log(`${outcome.published ? "✓ 发布" : "· 留审"} ${claim.id} [${claim.status}] ${outcome.reason}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const people = [...new Set(outcomes.map((item) => item.person_id))];
  for (const personId of people) {
    await recomputeScores(personId, { action: "seed_autochecked" });
    if (outcomes.some((item) => item.person_id === personId && item.published)) {
      await sql`UPDATE people SET visibility = 'public' WHERE id = ${personId}`;
    }
  }

  const held = outcomes.filter((item) => !item.published);
  const reasons = new Map<string, number>();
  for (const item of held) {
    const key = item.reason.replace(/[，（].*$/, "");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  if (searchDown) console.log(`\n注意：联网搜索不可用，这一轮只用了种子链接和网页存档（${searchDown}）`);
  console.log(`\n汇总：发布 ${outcomes.length - held.length} 条，留审 ${held.length} 条`);
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${reason}`);
  for (const item of held) console.log(`  - ${item.id}：${item.reason}`);
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
