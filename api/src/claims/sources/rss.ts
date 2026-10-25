import { textFromHtml } from "../../evidence/sources";
import { mentions, TIME_HINT } from "./chunk";
import type { AdapterResult, RawDoc, SourcePerson } from "./types";

// Personal blogs and company newsrooms. A missing feed is skipped, not fatal.
const FEEDS: Record<string, string[]> = {
  "paul-graham": ["http://www.aaronsw.com/2002/feeds/pgessays.rss"],
  "marc-andreessen": ["https://a16z.com/feed/"],
  "marc-benioff": ["https://www.salesforce.com/news/feed/"],
  "clement-delangue": ["https://huggingface.co/blog/feed.xml"],
  "peter-diamandis": ["https://www.diamandis.com/feed"],
  "cathie-wood": ["https://www.ark-invest.com/rss"],
  "aidan-gomez": ["https://cohere.com/blog/rss.xml"],
  "aravind-srinivas": ["https://www.perplexity.ai/blog/rss.xml"],
  "fei-fei-li": ["https://blog.google/rss/"],
  "kevin-scott": ["https://blogs.microsoft.com/feed/"],
};

// Sites whose articles we reach through a feed; used to find archives made by the old summary fallback (#7).
// paulgraham.com is listed by hand: its feed lives on another domain.
export const FEED_HOSTS = new Set([
  ...Object.values(FEEDS).flat().map((feed) => new URL(feed).hostname.replace(/^www\./, "")),
  "paulgraham.com",
]);

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return "";
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

export function parseFeed(xml: string) {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map((block) => ({
      title: tag(block, "title"),
      link: tag(block, "link") || tag(block, "guid"),
      description: tag(block, "description") || tag(block, "content:encoded"),
    }))
    .filter((item) => /^https?:\/\//.test(item.link));
}

// One feed item -> the article itself. The feed's description is never stored as the article: a quote
// found only in a summary does not prove the article said it (SPEC 原则 2、3).
export async function fetchArticle(item: { title: string; link: string }, fetcher: typeof fetch = fetch): Promise<{ doc: RawDoc } | { skipped: string }> {
  try {
    const page = await fetcher(item.link, { redirect: "follow", signal: AbortSignal.timeout(12_000) });
    if (!page.ok) return { skipped: `HTTP ${page.status}` };
    const bytes = new Uint8Array(await page.arrayBuffer());
    const extracted = textFromHtml(new TextDecoder().decode(bytes));
    if (extracted.text.length < 400) return { skipped: "正文太短" };
    return {
      doc: {
        url: item.link,
        finalUrl: page.url || item.link,
        status: page.status,
        title: item.title || extracted.title || item.link,
        text: extracted.text,
        bytes,
        contentType: page.headers.get("content-type") || "text/html",
      },
    };
  } catch (error) {
    return { skipped: error instanceof Error && error.name === "TimeoutError" ? "超时" : "打不开" };
  }
}

export async function findRss(person: SourcePerson, fetcher: typeof fetch = fetch): Promise<AdapterResult> {
  const feeds = FEEDS[person.id] ?? [];
  if (!feeds.length) return { docs: [], searches: 0, detail: "没有登记 RSS", searchLog: [] };
  const docs: AdapterResult["docs"] = [];
  const notes: string[] = [];
  const skipped: string[] = [];
  let notTheirs = 0;
  for (const feed of feeds) {
    try {
      const response = await fetcher(feed, { headers: { Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        notes.push(`${feed} HTTP ${response.status}`);
        continue;
      }
      const items = parseFeed(await response.text()).filter((item) => TIME_HINT.test(`${item.title} ${item.description}`)).slice(0, 3);
      for (const item of items) {
        if (docs.length >= 3) break;
        const result = await fetchArticle(item, fetcher);
        if (!("doc" in result)) skipped.push(result.skipped);
        // Company newsrooms mostly carry posts by others; keep only those that name the person (028).
        else if (!mentions(person, `${item.title} ${result.doc.text ?? ""}`)) notTheirs += 1;
        else docs.push(result.doc);
      }
    } catch (error) {
      notes.push(`${feed}：${error instanceof Error ? error.message.slice(0, 80) : error}`);
    }
  }
  if (notTheirs) notes.push(`${notTheirs} 篇没有提到本人，跳过`);
  if (skipped.length) notes.push(`${skipped.length} 篇原文打不开，已跳过，不用 feed 摘要代替（${[...new Set(skipped)].join("、")}）`);
  return { docs: docs.slice(0, 3), searches: 0, detail: notes.join("；"), searchLog: [] };
}
