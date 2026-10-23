import { textFromHtml } from "../../evidence/sources";
import { TIME_HINT } from "./chunk";
import type { AdapterResult, SourcePerson } from "./types";

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
  "qi-lu": ["https://blogs.microsoft.com/feed/"],
};

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

export async function findRss(person: SourcePerson): Promise<AdapterResult> {
  const feeds = FEEDS[person.id] ?? [];
  if (!feeds.length) return { docs: [], searches: 0, detail: "没有登记 RSS", searchLog: [] };
  const docs: AdapterResult["docs"] = [];
  const notes: string[] = [];
  for (const feed of feeds) {
    try {
      const response = await fetch(feed, { headers: { Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        notes.push(`${feed} HTTP ${response.status}`);
        continue;
      }
      const items = parseFeed(await response.text()).filter((item) => TIME_HINT.test(`${item.title} ${item.description}`)).slice(0, 3);
      for (const item of items) {
        if (docs.length >= 3) break;
        try {
          const page = await fetch(item.link, { signal: AbortSignal.timeout(12_000) });
          if (!page.ok) continue;
          const bytes = new Uint8Array(await page.arrayBuffer());
          const extracted = textFromHtml(new TextDecoder().decode(bytes));
          if (extracted.text.length < 400) continue;
          docs.push({ url: item.link, title: item.title || extracted.title || item.link, text: extracted.text, bytes, contentType: page.headers.get("content-type") || "text/html" });
        } catch {
          if (item.description.length >= 400) {
            const bytes = new TextEncoder().encode(item.description);
            docs.push({ url: item.link, title: item.title || item.link, text: item.description, bytes, contentType: "text/plain" });
          }
        }
      }
    } catch (error) {
      notes.push(`${feed}：${error instanceof Error ? error.message.slice(0, 80) : error}`);
    }
  }
  return { docs: docs.slice(0, 3), searches: 0, detail: notes.join("；"), searchLog: [] };
}
