import type { AdapterResult, SourcePerson } from "./types";

// Captions only. The binary is optional; a machine without it records the skip and continues.
export function youtubeSkipDetail() {
  return Bun.which("yt-dlp") ? "" : "本机没有 yt-dlp，已跳过";
}

export async function findYoutubeCaptions(person: SourcePerson): Promise<AdapterResult> {
  const skipped = youtubeSkipDetail();
  if (skipped) return { docs: [], searches: 0, detail: skipped, searchLog: [] };
  const query = `${person.name_en || person.name_zh} interview`;
  const proc = Bun.spawn(
    ["yt-dlp", "--skip-download", "--write-auto-sub", "--sub-langs", "en,zh-Hans", "--sub-format", "vtt", "--print", "%(id)s\t%(title)s\t%(webpage_url)s", `ytsearch3:${query}`],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (code !== 0) return { docs: [], searches: 0, detail: "yt-dlp 没有取出字幕", searchLog: [] };
  const docs: AdapterResult["docs"] = [];
  for (const line of stdout.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 3)) {
    const [id, title, url] = line.split("\t");
    if (!id || !url) continue;
    const sub = Bun.spawn(["yt-dlp", "--skip-download", "--write-auto-sub", "--sub-langs", "en,zh-Hans", "--sub-format", "vtt", "-o", "-", url], { stdout: "pipe", stderr: "pipe" });
    const text = await new Response(sub.stdout).text();
    const caption = text.replace(/^\d{2}:\d{2}:\d{2}\.\d+\s+-->\s+\d{2}:\d{2}:\d{2}\.\d+.*$/gm, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (caption.length < 400) continue;
    docs.push({ url, title: title || id, text: caption, bytes: new TextEncoder().encode(caption), contentType: "text/vtt" });
  }
  return { docs, searches: 0, detail: "", searchLog: [{ query, urls: docs.map((doc) => doc.url) }] };
}
