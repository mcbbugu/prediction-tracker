import { createHash } from "node:crypto";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { sql } from "../core/db";

export type Snapshot = {
  id: number;
  url: string;
  final_url: string;
  http_status: number;
  title: string;
  text: string;
  sha256: string;
  fetched_via: FetchVia;
};

// How a page was reached. Every route keeps the raw bytes it got, so the text we matched quotes against
// can always be re-derived and checked against its hash.
export type FetchVia = "direct" | "browser" | "jina";

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

// ---- Fetching, with a fallback chain (SPEC 证据存档). Each step runs only if the previous copy is weak
// (unreachable, an error page, a bot check, or nearly empty):
//   1. open the page ourselves (two retries on network errors);
//   2. render it in a local headless Chromium (render.mjs) — free, nothing leaves this machine;
//   3. read it through Jina Reader (set JINA_API_KEY: Jina refuses anonymous calls from networks it distrusts).
// PDFs fetched directly are turned into text locally (unpdf). Bot checks and CAPTCHAs are never bypassed.

type Fetched = { status: number; finalUrl: string; bytes: Uint8Array; contentType: string; via: FetchVia };

const MAX_RAW_BYTES = 20_000_000;
const THIN_TEXT = 400;
const BOT_CHECK =
  /enable javascript|javascript is (disabled|required)|just a moment\.\.\.|attention required!? \| cloudflare|cf-browser-verification|verify you are (a )?human|are you a robot|captcha/i;

async function fetchBytes(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { response, bytes: buffer.length > MAX_RAW_BYTES ? buffer.slice(0, MAX_RAW_BYTES) : buffer };
}

async function fetchDirect(url: string): Promise<Fetched | null> {
  for (const delay of [0, 2000, 5000]) {
    if (delay) await Bun.sleep(delay);
    try {
      const { response, bytes } = await fetchBytes(
        url,
        { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } },
        20_000,
      );
      return { status: response.status, finalUrl: response.url || url, bytes, contentType: response.headers.get("content-type") || "", via: "direct" };
    } catch {
      // Network error or timeout: try again, then give up on this route.
    }
  }
  return null;
}

// The browser's raw copy is the rendered DOM it serialised, not the network bytes; fetched_via says so.
const RENDER = join(import.meta.dir, "render.mjs");
const BROWSER_TIMEOUT_MS = 60_000;

async function fetchBrowser(url: string): Promise<Fetched | null> {
  try {
    const child = Bun.spawn(["node", RENDER, url], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => child.kill(), BROWSER_TIMEOUT_MS);
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    clearTimeout(timer);
    const result = JSON.parse(out || "{}") as { status?: number; finalUrl?: string; contentType?: string; html?: string };
    if (code !== 0 || !result.html) return null;
    return {
      status: result.status ?? 0,
      finalUrl: result.finalUrl || url,
      bytes: new TextEncoder().encode(result.html),
      contentType: result.contentType || "text/html",
      via: "browser",
    };
  } catch {
    // Node or Chromium missing, or the page hung: this step is skipped.
    return null;
  }
}

async function fetchJina(url: string): Promise<Fetched | null> {
  const headers: Record<string, string> = { Accept: "text/plain", "X-Return-Format": "markdown" };
  if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  try {
    const { response, bytes } = await fetchBytes(`https://r.jina.ai/${url}`, { headers }, 60_000);
    if (!response.ok) return null;
    return { status: response.status, finalUrl: url, bytes, contentType: "text/markdown; via=jina", via: "jina" };
  } catch {
    return null;
  }
}

// Jina returns "Title: …\nURL Source: …\nMarkdown Content:\n…"; links are reduced to their text so a quote
// that runs through a hyperlink still matches word for word.
function textFromJina(raw: string) {
  const title = raw.match(/^Title:\s*(.*)$/m)?.[1]?.trim() ?? "";
  const body = (raw.split(/^Markdown Content:\s*$/m)[1] ?? raw)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { title, text: body };
}

const isPdf = (fetched: Fetched) =>
  /pdf/i.test(fetched.contentType) || new TextDecoder().decode(fetched.bytes.slice(0, 5)) === "%PDF-";

// PDFs (filings, transcripts, papers) are read locally; the raw bytes stay archived either way.
async function textFromPdf(bytes: Uint8Array) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const title = ((await pdf.getMetadata().catch(() => null))?.info as { Title?: string } | undefined)?.Title ?? "";
    return { title, text: String(text).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim() };
  } catch {
    return { title: "", text: "" };
  }
}

async function extract(fetched: Fetched) {
  if (fetched.via === "direct" && isPdf(fetched)) return textFromPdf(fetched.bytes);
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(fetched.bytes);
  if (fetched.via === "jina") return textFromJina(raw);
  return fetched.contentType.includes("html") || raw.trimStart().startsWith("<") ? textFromHtml(raw) : { title: "", text: raw };
}

// Why the direct copy is not good enough as evidence, or "" if it is.
function weakness(fetched: Fetched | null, page: { title: string; text: string } | null) {
  if (!fetched || !page) return "打不开";
  if (fetched.status >= 400) return `HTTP ${fetched.status}`;
  if (BOT_CHECK.test(`${page.title}\n${page.text.slice(0, 3000)}`) && page.text.length < 5000) return "验证页";
  if (page.text.length < THIN_TEXT) return "正文太短";
  return "";
}

// Opens the page and keeps a dated copy: raw bytes (gzip) with their hash, the extracted text with its hash,
// and how it was reached (L1 evidence store). Annual reports run past 200k characters; callers that need
// the whole filing can raise the cap. Returns null when no route yields usable text.
export async function snapshot(url: string, maxChars = 200_000): Promise<Snapshot | null> {
  let fetched = await fetchDirect(url);
  let page = fetched ? await extract(fetched) : null;
  for (const next of [fetchBrowser, fetchJina]) {
    if (!weakness(fetched, page)) break;
    const alt = await next(url);
    const altPage = alt ? await extract(alt) : null;
    if (!alt || !altPage) continue;
    // Take the alternative if it is good evidence, or if we had nothing at all (keeps the error page on record).
    if (!weakness(alt, altPage) || !fetched) {
      fetched = alt;
      page = altPage;
    }
  }
  if (!fetched || !page) return null;
  return save(url, fetched, page, maxChars);
}

// A document we fetched some other way (e.g. a filing over the SEC API), stored to the same standard.
export async function archiveDocument(input: {
  url: string;
  bytes: Uint8Array;
  contentType: string;
  status: number;
  title: string;
  text: string;
}) {
  const fetched: Fetched = { status: input.status, finalUrl: input.url, bytes: input.bytes, contentType: input.contentType, via: "direct" };
  return save(input.url, fetched, { title: input.title, text: input.text }, Number.MAX_SAFE_INTEGER);
}

async function save(url: string, fetched: Fetched, page: { title: string; text: string }, maxChars: number): Promise<Snapshot> {
  // Postgres text cannot hold NUL bytes; some pages (and PDFs served as text) contain them.
  const kept = page.text.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, " ").slice(0, maxChars);
  const cleanTitle = page.title.replace(/[\u0000-\u001f]/g, " ").trim();
  const sha256 = createHash("sha256").update(kept).digest("hex");
  const rawSha256 = createHash("sha256").update(fetched.bytes).digest("hex");
  const rawGz = Buffer.from(Bun.gzipSync(new Uint8Array(fetched.bytes)));
  const rows = await sql<{ id: number }[]>`
    INSERT INTO sources (url, final_url, http_status, title, text, sha256, raw_gz, raw_sha256, content_type, fetched_via)
    VALUES (${url}, ${fetched.finalUrl}, ${fetched.status}, ${cleanTitle}, ${kept}, ${sha256},
            ${rawGz}, ${rawSha256}, ${fetched.contentType.slice(0, 200)}, ${fetched.via})
    RETURNING id
  `;
  return {
    id: Number(rows[0].id),
    url,
    final_url: fetched.finalUrl,
    http_status: fetched.status,
    title: cleanTitle,
    text: kept,
    sha256,
    fetched_via: fetched.via,
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

// archive.today and its mirrors are not evidence: in 2026 they were found altering archived pages.
export const SKIP_HOST =
  /(^|\.)(volces\.com|volcengine\.com|google\.[a-z.]+|bing\.com|baidu\.com|sogou\.com|so\.com|youtube\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|douyin\.com|archive\.(today|ph|is|li|vn|md|fo))$/i;

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
