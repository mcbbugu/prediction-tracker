import { createHash } from "node:crypto";
import { sql } from "./db";

export type Snapshot = {
  id: number;
  url: string;
  final_url: string;
  http_status: number;
  title: string;
  text: string;
  sha256: string;
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) prediction-tracker/0.2";

function decode(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

export function textFromHtml(html: string) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const body = decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|head|title)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { title, text: body };
}

// Opens the page ourselves and keeps a dated copy with a content hash (L1 evidence store).
export async function snapshot(url: string): Promise<Snapshot | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
  } catch {
    return null;
  }
  const raw = await response.text().catch(() => "");
  const type = response.headers.get("content-type") || "";
  const { title, text } = type.includes("html") || raw.trimStart().startsWith("<") ? textFromHtml(raw) : { title: "", text: raw };
  // Postgres text cannot hold NUL bytes; some pages (and PDFs served as text) contain them.
  const kept = text.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, " ").slice(0, 200_000);
  const cleanTitle = title.replace(/[\u0000-\u001f]/g, " ").trim();
  const sha256 = createHash("sha256").update(kept).digest("hex");
  const rows = await sql<{ id: number }[]>`
    INSERT INTO sources (url, final_url, http_status, title, text, sha256)
    VALUES (${url}, ${response.url || url}, ${response.status}, ${cleanTitle}, ${kept}, ${sha256})
    RETURNING id
  `;
  return {
    id: Number(rows[0].id),
    url,
    final_url: response.url || url,
    http_status: response.status,
    title: cleanTitle,
    text: kept,
    sha256,
  };
}

export function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[“”„‟"«»「」『』]/g, '"')
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Words only: punctuation and quote marks differ between transcripts and page typography
// ('x' vs "x", ride-hailing vs ride hailing, a trailing "." vs ","), the words themselves must not.
function wordsOnly(value: string) {
  return value.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

// A quote counts only if it appears word for word in the saved page text.
// "…" or "..." may join pieces; every piece must be at least 15 characters and appear in order.
export function quoteOnPage(quote: string, pageText: string) {
  const page = ` ${wordsOnly(normalize(pageText))} `;
  const pieces = normalize(quote)
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map(wordsOnly)
    .filter(Boolean)
    .map((piece) => ` ${piece} `);
  if (pieces.length === 0 || pieces.some((piece) => piece.length - 2 < 15)) return false;
  let from = 0;
  for (const piece of pieces) {
    const at = page.indexOf(piece, from);
    if (at < 0) return false;
    from = at + piece.length - 1;
  }
  return true;
}

export const SKIP_HOST =
  /(^|\.)(volces\.com|volcengine\.com|google\.[a-z.]+|bing\.com|baidu\.com|sogou\.com|so\.com|youtube\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|douyin\.com)$/i;

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// A bare homepage ("https://www.bitauto.com/") is never evidence for a specific claim.
export function isHomepage(url: string) {
  try {
    const parsed = new URL(url);
    return (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search;
  } catch {
    return true;
  }
}

export function usableLinks(urls: string[], exclude: string[] = []) {
  return [...new Set(urls)].filter(
    (url) => hostOf(url) && !SKIP_HOST.test(hostOf(url)) && !isHomepage(url) && !exclude.includes(url),
  );
}

// Pages are long; send the paragraphs that mention the given terms, in page order.
export function excerpt(text: string, keys: string[], budget = 5000) {
  const lowered = keys.map((key) => key.toLowerCase()).filter(Boolean);
  const paragraphs = text.split("\n").filter((line) => line.trim().length > 30);
  const scored = paragraphs.map((line, index) => {
    const lower = line.toLowerCase();
    return { index, line, score: lowered.reduce((sum, key) => sum + (lower.includes(key) ? 1 : 0), 0) };
  });
  const picked: typeof scored = [];
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (item.score === 0 && picked.length > 0) break;
    if (used + item.line.length > budget) continue;
    picked.push(item);
    used += item.line.length;
  }
  return picked
    .sort((a, b) => a.index - b.index)
    .map((item) => item.line)
    .join("\n");
}
