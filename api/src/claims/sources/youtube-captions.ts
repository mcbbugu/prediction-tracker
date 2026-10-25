import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mentions } from "./chunk";
import type { AdapterResult, RawDoc, SourcePerson } from "./types";

// Captions only, never the video. The binary is optional; a machine without it records the skip and continues.
// Search uses yt-dlp's own ytsearch (no AFP). Human-made subtitles are preferred; automatic ones are marked auto.
export function youtubeSkipDetail() {
  return Bun.which("yt-dlp") ? "" : "本机没有 yt-dlp，已跳过";
}

// YouTube asks some machines to sign in before it serves captions. We do not work around that check;
// the operator can pass their own cookies (YTDLP_COOKIES = cookies.txt path, or YTDLP_COOKIES_FROM_BROWSER).
function cookieArgs() {
  if (process.env.YTDLP_COOKIES) return ["--cookies", process.env.YTDLP_COOKIES];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) return ["--cookies-from-browser", process.env.YTDLP_COOKIES_FROM_BROWSER];
  return [];
}

const BOT_CHECK = /confirm you.re not a bot|sign in to confirm/i;

async function run(args: string[]) {
  const proc = Bun.spawn(["yt-dlp", ...cookieArgs(), ...args], { stdout: "pipe", stderr: "pipe", timeout: 90_000 });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
}

// WebVTT → plain text. Automatic captions repeat each line as the next one scrolls in; drop the repeats.
export function parseVtt(vtt: string) {
  const kept: string[] = [];
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, " ")
      .trim();
    if (!line || /^WEBVTT|^Kind:|^Language:|^NOTE\b|^\d+$/.test(line) || /-->/.test(line)) continue;
    if (line === kept[kept.length - 1]) continue;
    kept.push(line);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

async function captionsFor(url: string, auto: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "captions-"));
  try {
    const result = await run([
      "--skip-download",
      auto ? "--write-auto-subs" : "--write-subs",
      "--sub-langs",
      "en,zh-Hans",
      "--sub-format",
      "vtt",
      "-o",
      join(dir, "%(id)s.%(ext)s"),
      url,
    ]);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".vtt")).sort((a, b) => Number(b.includes(".en.")) - Number(a.includes(".en.")));
    const text = files[0] ? parseVtt(await readFile(join(dir, files[0]), "utf8")) : "";
    return { text, blocked: BOT_CHECK.test(result.stderr) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function findYoutubeCaptions(person: SourcePerson): Promise<AdapterResult> {
  const skipped = youtubeSkipDetail();
  if (skipped) return { docs: [], searches: 0, detail: skipped, searchLog: [] };
  const query = `${person.name_en || person.name_zh} interview`;
  const search = await run(["--flat-playlist", "--print", "%(id)s\t%(title)s", `ytsearch8:${query}`]);
  if (search.code !== 0) return { docs: [], searches: 0, detail: `yt-dlp 搜索失败：${search.stderr.trim().split("\n").at(-1)?.slice(0, 120) ?? ""}`, searchLog: [] };
  // Only videos whose title names the person: their own interview or talk, not a video about them.
  const videos = search.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([id, title]) => id && title && mentions(person, title))
    .slice(0, 3);
  const docs: RawDoc[] = [];
  const notes: string[] = [];
  for (const [id, title] of videos) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    let kind: "manual" | "auto" = "manual";
    let got = await captionsFor(url, false);
    if (!got.text && !got.blocked) {
      kind = "auto";
      got = await captionsFor(url, true);
    }
    if (got.blocked) {
      notes.push("YouTube 要求登录验证，没有取到字幕（配置 YTDLP_COOKIES 后可用）");
      break;
    }
    if (got.text.length < 400) continue;
    // The title carries the speaker's name; captions themselves do not.
    const text = `${title}\n\n${got.text}`;
    docs.push({ url, title, text, bytes: new TextEncoder().encode(text), contentType: "text/vtt", transcriptKind: kind });
  }
  if (!videos.length) notes.push("搜到的视频标题里没有本人名字");
  return { docs, searches: 0, detail: notes.join("；"), searchLog: [{ query, urls: docs.map((doc) => doc.url) }] };
}
