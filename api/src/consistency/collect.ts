// 可信度对照的自动采集。先列这个人有代表性的立场（这时还不知道后来怎样），再逐个找后来的说法或行动。
// 原话必须在存档页上逐字出现，对不上就丢弃。每人每次最多 8 次联网搜索。
import { createHash } from "node:crypto";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { ArkStopped, arkJson, arkSearch } from "../core/ark";
import { DOMAINS, hasChinese, isReportedSpeech, speakerNames, translateToChinese } from "../claims/discover";
import { quoteOnPage, snapshot, type Snapshot } from "../evidence/sources";
import { recomputeScores } from "../scoring/score";

export const TOPICS_V1 = "CONSISTENCY_TOPICS_V1";
export const PAIR_V1 = "CONSISTENCY_PAIR_V1";
export const PAIR_V2 = "CONSISTENCY_PAIR_V2";
export const PAIR_V3 = "CONSISTENCY_PAIR_V3";
export const MAX_SEARCHES = 8;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const POLICY = /选举|总统大选|政府政策|投票|议会|大选|竞选/;
const DATED = /到\s*20\d{2}|20\d{2}\s*年[前底]|明年|下个?月|未来\s*\d+|(\d+\s*)(年|个月)内|by 20\d{2}|next year|within \d+/i;

export type Topic = { topic: string; domain: string; why: string };
export type Outcome = {
  topic: string;
  status: "kept" | "dropped" | "none";
  kind?: string;
  label?: string;
  reason?: string;
};
type Emit = (step: string, status: "running" | "done" | "failed" | "info", message: string, data?: Record<string, unknown>) => Promise<void>;
type Side = { quote: string; quote_zh?: string; date: string; url: string };
type Draft = {
  status?: string;
  a?: Side;
  b?: Side;
  explanation?: Side | null;
  rationale?: string;
};
type Page = Pick<Snapshot, "id" | "text" | "fetched_via" | "http_status">;

export function inScopeTopic(topic: Topic) {
  const text = `${topic.topic} ${topic.why}`;
  return Boolean(topic.topic.trim()) && DOMAINS.includes(topic.domain) && !POLICY.test(text) && !DATED.test(text);
}

export function proposedLabel(kind: string, explained: boolean): "consistent" | "inconsistent" | null {
  if (kind === "reaffirm") return "consistent";
  if (kind === "walk") return "inconsistent";
  if (kind === "reversal") return explained ? "consistent" : "inconsistent";
  return null;
}

// 一次采集出来的对照如果全是不一致，多半是列话题时挑了会翻车的。
export function biasNote(labels: string[]) {
  if (labels.length > 0 && labels.every((label) => label === "inconsistent")) {
    return "这次对照全是不一致，列话题时可能挑了会翻车的";
  }
  return null;
}

const usable = (page: Page | null): page is Page => !!page && page.http_status < 400 && page.text.length >= 200;

async function recentPage(url: string): Promise<Page | null> {
  const rows = await sql<Page[]>`
    SELECT id, text, fetched_via, http_status FROM sources
    WHERE url = ${url} AND fetched_at > now() - interval '3 days'
    ORDER BY fetched_at DESC LIMIT 1
  `;
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

async function openPage(url: string) {
  const cached = await recentPage(url);
  if (usable(cached)) return cached;
  return (await snapshot(url)) ?? cached;
}

function waybackUrl(url: string, date: string) {
  return `https://web.archive.org/web/${date.replace(/-/g, "")}id_/${url}`;
}

async function listTopics(who: string): Promise<Topic[]> {
  const result = (await arkJson(
    `列出${who}最有代表性的 5 到 10 个建议和明确立场。` +
      "现在还不能查后来发生了什么，不要只挑看起来会翻车的，要覆盖这个人反复讲过的正面主张。" +
      "排除选举、政府政策和带截止日期的预测（那种进兑现率，不进可信度）。" +
      `domain 只能是：${DOMAINS.join("、")}。` +
      '只输出 JSON：{"topics":[{"topic":"一句话立场","domain":"","why":"为什么这是代表性立场"}]}',
    who,
    2000,
    TOPICS_V1,
  )) as { topics?: Topic[] };
  return (result.topics ?? [])
    .map((topic) => ({ topic: (topic.topic ?? "").trim(), domain: (topic.domain ?? "").trim(), why: (topic.why ?? "").trim() }))
    .filter(inScopeTopic)
    .slice(0, 10);
}

type Opened = { url: string; text: string; id: number; fetched_via: string };
type Checked = Side & { source_id: number; fetched_via: string };

export function pageExcerpt(text: string) {
  const longEnough = (quote: string) => (/[\u4e00-\u9fff]/.test(quote) ? quote.length >= 12 : quote.split(" ").length >= 6);
  const quoted = [...text.matchAll(/["“「]([^"”」]{12,400})["”」]/g)]
    .map((match) => {
      const quote = match[1].replace(/\s+/g, " ").trim();
      const at = match.index ?? 0;
      const around = text.slice(Math.max(0, at - 160), at + match[1].length + 160).replace(/\s+/g, " ").trim();
      return { quote, around };
    })
    .filter((item) => longEnough(item.quote))
    .filter((item) => !/[<>{}=]|https?:|data-|class=|Copy the|Settings|office hour|install |plugin/i.test(item.quote))
    .sort((a, b) => b.quote.length - a.quote.length)
    .slice(0, 6);
  return { quoted };
}

async function openedPages(urls: string[]) {
  const ranked: { page: Opened; quotes: number }[] = [];
  for (const url of urls.slice(0, 8)) {
    if (/\.pdf($|\?)/i.test(url) || !url.startsWith("http")) continue;
    const page = await openPage(url);
    if (!usable(page)) continue;
    const quotes = pageExcerpt(page.text).quoted.length;
    if (quotes === 0) continue;
    ranked.push({ page: { url, text: page.text, id: page.id, fetched_via: page.fetched_via }, quotes });
  }
  ranked.sort((a, b) => b.quotes - a.quotes);
  return ranked.slice(0, 2).map((item) => item.page);
}

async function locateSide(side: Side, pages: Opened[], ownWords: boolean, names: string[]): Promise<Checked | string> {
  if (!side?.quote || side.quote.trim().length < 15 || !isoDate.test(side.date ?? "")) return "缺原话或日期";
  if (ownWords && isReportedSpeech(side.quote, names)) return "像是转述，不是本人原话";
  const named = pages.find((page) => page.url === side.url && quoteOnPage(side.quote, page.text));
  const hit = named ?? pages.find((page) => quoteOnPage(side.quote, page.text));
  if (hit) return { ...side, url: hit.url, source_id: hit.id, fetched_via: hit.fetched_via };
  if (side.url && isoDate.test(side.date)) {
    const copy = await openPage(waybackUrl(side.url, side.date));
    if (usable(copy) && quoteOnPage(side.quote, copy.text)) return { ...side, source_id: copy.id, fetched_via: "wayback" };
  }
  return "已打开的页面里没有这句原话";
}

async function oneTopic(personId: string, who: string, names: string[], topic: Topic): Promise<Outcome> {
  const search = await arkSearch(
    `搜索 ${who} 关于「${topic.topic}」后来公开怎么说、或者后来自己怎么做。只要能核对原话的文章链接，不要首页。`,
    PAIR_V1,
  );
  if (search.urls.length === 0 && !search.text.trim()) return { topic: topic.topic, status: "dropped", reason: "搜索没有返回出处" };
  const pages = await openedPages(search.urls.slice(0, 6));
  if (pages.length === 0) return { topic: topic.topic, status: "dropped", reason: "搜索到的页面打不开" };
  const draft = (await arkJson(
    `根据已经打开的页面正文，判断 ${who} 在「${topic.topic}」上后来怎样。` +
      "只能是 reversal（后来公开改口）、reaffirm（后来重申）、walk（后来的行动和说法相反）、no_counterpart（正文里没有后来的说法或行动）。" +
      "a 是较早的本人原话，b 是后来的原话；walk 的 b 可以是描述行动的句子。" +
      "quote 必须从 quoted 里逐字抄，不能改词，不要带说话人的名字。两句都要在 quoted 里，否则 status=no_counterpart。url 用这句所在页面的 url。日期从 around 里取，用 YYYY-MM-DD，没有就不要编。" +
      "两句对不上就 status=no_counterpart，不要编。reversal 如果本人当时说明了为什么改，把那段原话放进 explanation，否则 explanation 为 null。" +
      '只输出 JSON：{"status":"","a":{"quote":"","date":"","url":""},"b":{"quote":"","date":"","url":""},"explanation":null,"rationale":""}',
    JSON.stringify({
      topic: topic.topic,
      domain: topic.domain,
      pages: pages.map((page) => ({ url: page.url, ...pageExcerpt(page.text) })),
    }),
    1800,
    PAIR_V3,
  )) as Draft;
  if (draft.status === "no_counterpart" || !draft.status) return { topic: topic.topic, status: "none", reason: "没有后来的说法" };
  if (draft.status !== "reversal" && draft.status !== "reaffirm" && draft.status !== "walk") {
    return { topic: topic.topic, status: "dropped", reason: "类型不在三类对照里" };
  }
  if (draft.status !== "walk" && draft.a?.date && draft.b?.date && draft.a.date > draft.b.date) {
    const earlier = draft.b;
    draft.b = draft.a;
    draft.a = earlier;
  }
  const a = await locateSide(draft.a ?? { quote: "", date: "", url: "" }, pages, true, names);
  if (typeof a === "string") return { topic: topic.topic, status: "dropped", reason: `前一句：${a}` };
  const b = await locateSide(draft.b ?? { quote: "", date: "", url: "" }, pages, draft.status !== "walk", names);
  if (typeof b === "string") return { topic: topic.topic, status: "dropped", reason: `后一句：${b}` };
  let explanation: Checked | string | null = null;
  if (draft.status === "reversal" && draft.explanation?.quote) {
    explanation = await locateSide(draft.explanation, pages, true, names);
    if (typeof explanation === "string") explanation = null;
  }
  const label = proposedLabel(draft.status, typeof explanation === "object" && explanation !== null);
  if (!label) return { topic: topic.topic, status: "dropped", reason: "对不上一致或不一致" };
  const quotes = [a.quote, b.quote, typeof explanation === "object" && explanation ? explanation.quote : ""].filter((quote) => quote && !hasChinese(quote));
  const translated = await translateToChinese(quotes);
  let cursor = 0;
  const withZh = (side: Side & { source_id: number; fetched_via: string }) => {
    const quote_zh = hasChinese(side.quote) ? side.quote : (translated[cursor++] ?? "");
    return { ...side, quote_zh };
  };
  const storedA = withZh(a);
  const storedB = withZh(b);
  const storedExplanation = typeof explanation === "object" && explanation ? withZh(explanation) : null;
  const id = `${personId}-c-${createHash("sha256").update(topic.topic).digest("hex").slice(0, 8)}`;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO consistency_pairs (id, person_id, domain, topic, kind, a, b, explanation, proposed_label, rationale, provenance, publication)
    VALUES (${id}, ${personId}, ${topic.domain}, ${topic.topic}, ${draft.status}, ${sql.json(storedA)}, ${sql.json(storedB)},
            ${storedExplanation ? sql.json(storedExplanation) : null}, ${label}, ${draft.rationale ?? ""}, 'agent', 'published')
    ON CONFLICT (id) DO UPDATE SET
      domain = EXCLUDED.domain, topic = EXCLUDED.topic, kind = EXCLUDED.kind, a = EXCLUDED.a, b = EXCLUDED.b,
      explanation = EXCLUDED.explanation, proposed_label = EXCLUDED.proposed_label, rationale = EXCLUDED.rationale,
      publication = 'published', updated_at = now()
    WHERE consistency_pairs.reviewed_at IS NULL
    RETURNING id
  `;
  if (rows.length === 0) return { topic: topic.topic, status: "dropped", reason: "已有人审，不覆盖" };
  return { topic: topic.topic, status: "kept", kind: draft.status, label };
}

export async function collectConsistency(personId: string, options: { emit?: Emit; maxSearches?: number } = {}) {
  const emit = options.emit ?? (async () => {});
  const maxSearches = options.maxSearches ?? MAX_SEARCHES;
  const [person] = await sql<{ name: string; name_en: string }[]>`SELECT name, name_en FROM people WHERE id = ${personId}`;
  if (!person) throw new Error(`people 表里没有 ${personId}`);
  const names = speakerNames({ name_zh: person.name, name_en: person.name_en });
  const who = person.name_en ? `${person.name}（${person.name_en}）` : person.name;

  await emit("可信度对照", "running", "先列代表性立场，这时还不知道后来怎样");
  const topics = await listTopics(who);
  await emit("可信度对照", "info", topics.length ? `列出 ${topics.length} 个话题` : "没有列出可用的话题", { topics });

  const outcomes: Outcome[] = [];
  let searches = 0;
  for (const topic of topics) {
    if (searches >= maxSearches) {
      outcomes.push({ topic: topic.topic, status: "dropped", reason: "本次搜索已到 8 次" });
      await emit("可信度对照", "info", `${topic.topic}：丢弃，本次搜索已到 8 次`);
      continue;
    }
    searches += 1;
    try {
      const outcome = await oneTopic(personId, who, names, topic);
      outcomes.push(outcome);
      const line =
        outcome.status === "kept"
          ? `${topic.topic}：写入，${outcome.label === "consistent" ? "一致" : "不一致"}`
          : outcome.status === "none"
            ? `${topic.topic}：没有后来的说法`
            : `${topic.topic}：丢弃，${outcome.reason}`;
      await emit("可信度对照", "info", line, { outcome });
    } catch (error) {
      if (error instanceof ArkStopped) throw error;
      const reason = error instanceof Error ? error.message.slice(0, 120) : String(error);
      const outcome: Outcome = { topic: topic.topic, status: "dropped", reason };
      outcomes.push(outcome);
      await emit("可信度对照", "info", `${topic.topic}：丢弃，${reason}`, { outcome });
    }
  }

  const kept = outcomes.filter((row) => row.status === "kept");
  const labels = kept.map((row) => row.label).filter((label): label is string => Boolean(label));
  const consistent = labels.filter((label) => label === "consistent").length;
  const inconsistent = labels.length - consistent;
  const bias = biasNote(labels);
  const summary = `写入 ${kept.length} 条，一致 ${consistent}，不一致 ${inconsistent}，搜索 ${searches} 次${bias ? `。${bias}` : ""}`;
  await emit("可信度对照", "done", summary, { topics, outcomes, consistent, inconsistent, searches, bias });
  return { topics, outcomes, consistent, inconsistent, searches, bias, summary };
}

async function main() {
  const ids = process.argv.filter((arg) => arg.startsWith("--person=")).map((arg) => arg.slice(9));
  if (ids.length === 0) throw new Error("usage: bun run src/consistency/collect.ts --person=<id> [--person=<id>]");
  await migrate();
  for (const id of ids) {
    const result = await collectConsistency(id, {
      emit: async (_step, status, message) => {
        if (status !== "running") console.log(message);
      },
    });
    await recomputeScores(id, { action: "auto_publish" });
    console.log(JSON.stringify({ id, consistent: result.consistent, inconsistent: result.inconsistent, bias: result.bias, topics: result.topics, outcomes: result.outcomes }, null, 2));
  }
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await sql.end();
    });
}
