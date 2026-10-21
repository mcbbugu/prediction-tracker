// 人物头像：按名字找维基百科主图，再到 Wikimedia Commons 读作者和许可证。
// 只收可再分发的许可（CC BY / CC BY-SA / CC0 / 公有领域）；查不到或许可不对就留空，前端用首字占位。
// 作者、许可一律取自 Commons 的 extmetadata，不猜不补。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = join(root, "public/portraits");
const UA = "xianyan-portraits/0.1 (prediction-tracker; local dev)";
const WIDTH = 400;

export type Portrait = { path: string; credit: string; source: string; license: string; title: string };

// Wikimedia 对频繁请求回 429；按 Retry-After 退避重试几次。
async function politeFetch(url: string, timeout = 15_000) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeout) });
    if (response.status !== 429 || attempt >= 4) return response;
    const wait = Number(response.headers.get("retry-after")) || 2 ** attempt * 5;
    await Bun.sleep(Math.min(wait, 60) * 1000);
  }
}

async function getJson(url: string) {
  const response = await politeFetch(url);
  if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
  return (await response.json()) as any;
}

function api(host: string, params: Record<string, string>) {
  const query = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  return getJson(`https://${host}/w/api.php?${query}`);
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// extmetadata.License 是机器可读的短码（cc-by-sa-4.0、cc0、pd…），LicenseShortName 是显示用名字。
export function acceptableLicense(code: string, shortName: string) {
  const c = code.toLowerCase();
  const s = shortName.toLowerCase();
  if (/\bnc\b|-nc-|\bnd\b|-nd-|non-?commercial|no ?deriv/.test(`${c} ${s}`)) return false;
  if (/^cc-by(-sa)?-\d/.test(c) || /^cc by(-sa)? \d/.test(s)) return true;
  if (c === "cc0" || /^cc0\b/.test(s)) return true;
  if (c.startsWith("pd") || /^public domain\b/.test(s)) return true;
  return false;
}

// 维基数据确认这是一个人（P31 = Q5），避免同名的公司、电影、消歧义页。
async function isHuman(qid: string) {
  const data = await getJson(
    `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetclaims", entity: qid, property: "P31", format: "json" })}`,
  );
  return (data.claims?.P31 ?? []).some((claim: any) => claim.mainsnak?.datavalue?.value?.id === "Q5");
}

async function pageImage(host: string, title: string) {
  const data = await api(host, {
    action: "query",
    redirects: "1",
    prop: "pageimages|pageprops",
    piprop: "name",
    pilicense: "free",
    titles: title,
  });
  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.pageimage) return null;
  if (page.pageprops && "disambiguation" in page.pageprops) return null;
  const qid = page.pageprops?.wikibase_item as string | undefined;
  if (!qid || !(await isHuman(qid))) return null;
  return { file: page.pageimage as string, article: `https://${host}/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}` };
}

async function commonsInfo(file: string) {
  const data = await api("commons.wikimedia.org", {
    action: "query",
    prop: "imageinfo",
    iiprop: "url|extmetadata|mime",
    iiurlwidth: String(WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|License|AttributionRequired",
    titles: `File:${file}`,
  });
  const page = data.query?.pages?.[0];
  // 不在 Commons 上（维基百科本地上传，多半是合理使用图）一律不要。
  if (!page || page.missing || page.imagerepository !== "local") return null;
  const info = page.imageinfo?.[0];
  if (!info?.thumburl) return null;
  const meta = info.extmetadata ?? {};
  const code = String(meta.License?.value ?? "");
  const license = stripHtml(String(meta.LicenseShortName?.value ?? ""));
  const artist = stripHtml(String(meta.Artist?.value ?? "")).slice(0, 160);
  const attribution = String(meta.AttributionRequired?.value ?? "").toLowerCase() === "true";
  if (!license || !acceptableLicense(code, license)) return { rejected: `许可证不可用：${license || code || "未知"}` };
  if (attribution && !artist) return { rejected: "需要署名但 Commons 上没有作者信息" };
  return { thumb: info.thumburl as string, source: info.descriptionurl as string, license, artist, title: page.title as string };
}

function extension(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  return null;
}

type Person = { id: string; name: string; name_en: string | null; aliases: string[] | null };

function candidates(person: Person) {
  const latin = (value: string) => /^[\p{Script=Latin}\s.'’-]+$/u.test(value);
  const cjk = (value: string) => /[一-鿿]/.test(value);
  const names = [person.name_en, ...(person.aliases ?? []), person.id.replace(/-[0-9a-f]{4}$/, "").replace(/-/g, " ")];
  const en = [...new Set(names.filter((n): n is string => !!n && latin(n)).map((n) => n.trim()))];
  const zh = [...new Set([person.name, ...(person.aliases ?? [])].filter((n) => !!n && cjk(n)))];
  return [...en.map((title) => ({ host: "en.wikipedia.org", title })), ...zh.map((title) => ({ host: "zh.wikipedia.org", title }))];
}

// 找到并下载头像，写进 people。返回结果或未找到的原因；网络错误会抛出。
export async function fetchPortrait(person: Person): Promise<{ ok: true; portrait: Portrait } | { ok: false; reason: string }> {
  let reason = "维基百科上没有找到这个人的可用主图";
  for (const { host, title } of candidates(person)) {
    const hit = await pageImage(host, title);
    if (!hit) continue;
    const info = await commonsInfo(hit.file);
    if (!info) {
      reason = `主图 ${hit.file} 不在 Wikimedia Commons 上`;
      continue;
    }
    if ("rejected" in info) {
      reason = `${hit.file}：${info.rejected}`;
      continue;
    }
    const response = await politeFetch(info.thumb, 20_000);
    if (!response.ok) throw new Error(`下载缩略图失败 ${response.status}`);
    const ext = extension(response.headers.get("content-type") ?? "");
    if (!ext) {
      reason = `缩略图格式不支持：${response.headers.get("content-type")}`;
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${person.id}.${ext}`), Buffer.from(await response.arrayBuffer()));
    // 人物页只显示 portrait_credit，所以署名里带上许可证和来源（TASL：作者 · 许可 · 出处）。
    const credit = [info.artist, info.license, "Wikimedia Commons"].filter(Boolean).join(" · ");
    const portrait = { path: `/portraits/${person.id}.${ext}`, credit, source: info.source, license: info.license, title: info.title };
    await sql`
      UPDATE people SET
        portrait_path = ${portrait.path},
        portrait_credit = ${portrait.credit},
        portrait_source_url = ${portrait.source},
        portrait_license = ${portrait.license}
      WHERE id = ${person.id}
    `;
    return { ok: true, portrait };
  }
  return { ok: false, reason };
}

export async function ensurePortrait(personId: string) {
  const person = (
    await sql<(Person & { portrait_path: string | null })[]>`
      SELECT id, name, name_en, aliases, portrait_path FROM people WHERE id = ${personId}
    `
  )[0];
  if (!person) return { ok: false as const, reason: "人物不存在" };
  if (person.portrait_path) return { ok: false as const, reason: "已有头像" };
  return fetchPortrait(person);
}

// 回填：pnpm api:portraits [-- --id=satya-nadella]
if (import.meta.main) {
  const only = process.argv.find((item) => item.startsWith("--id="))?.slice(5);
  const people = await sql<Person[]>`
    SELECT id, name, name_en, aliases FROM people
    WHERE portrait_path IS NULL ${only ? sql`AND id = ${only}` : sql``}
    ORDER BY id
  `;
  let found = 0;
  for (const person of people) {
    try {
      const result = await fetchPortrait(person);
      if (result.ok) {
        found++;
        console.log(`✓ ${person.id}  ${result.portrait.license}  ${result.portrait.credit}  ${result.portrait.source}`);
      } else {
        console.log(`· ${person.id}  ${result.reason}`);
      }
    } catch (error) {
      console.log(`✗ ${person.id}  ${error instanceof Error ? error.message : error}`);
    }
    await Bun.sleep(1500);
  }
  console.log(`补上 ${found} / ${people.length} 人`);
  await sql.end();
}
