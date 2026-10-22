import { arkConfigured, arkJson } from "../core/ark";
import { sql } from "../core/db";
import { logEvent, migrate } from "../core/migrate";

const personId = process.argv.find((arg) => arg.startsWith("--person="))?.split("=")[1] ?? "musk";

type RunStatus = "completed" | "blocked" | "failed";

type Page = { url: string; text: string };

type ExtractedClaim = {
  quote_en?: string;
  quote_zh?: string;
  source_url?: string;
  published_date?: string;
  deadline?: string;
  category?: string;
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

async function record(step: string, status: RunStatus, detail: Record<string, unknown>) {
  await sql`
    INSERT INTO agent_runs (person_id, step, status, detail)
    VALUES (${personId}, ${step}, ${status}, ${sql.json(detail as Parameters<typeof sql.json>[0])})
  `;
  console.log(`${status}\t${step}`);
}

function textFromHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14000);
}

function norm(value: string) {
  return value.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
}

function quoteOnPage(page: string, quote: string, speaker: string) {
  const hay = norm(page);
  const needle = norm(quote);
  if (needle.length < 40) return false;
  const probe = hay.includes(needle.slice(0, 90)) ? needle.slice(0, 90) : hay.includes(needle.slice(-90)) ? needle.slice(-90) : "";
  if (!probe) return false;
  const at = hay.indexOf(probe);
  const surname = speaker.split(" ").at(-1)?.toLowerCase() ?? "";
  const window = hay.slice(Math.max(0, at - 600), at + probe.length + 200);
  return Boolean(surname) && window.includes(surname);
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "prediction-tracker/0.1 (public-claim research)" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status}`);
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  return type.includes("html") || raw.includes("<") ? textFromHtml(raw) : raw.slice(0, 14000);
}

const skipHost = /wikipedia\.org|wikimedia\.org|ndl\.go\.jp|d-nb\.info|viaf\.org|worldcat|wikidata|imdb\.com|doi\.org/i;

async function wikiSources(name: string): Promise<Page[]> {
  const surname = name.split(" ").at(-1) ?? name;
  const search = new URL("https://en.wikipedia.org/w/api.php");
  search.searchParams.set("action", "query");
  search.searchParams.set("list", "search");
  search.searchParams.set("srsearch", `${name} predictions`);
  search.searchParams.set("srlimit", "5");
  search.searchParams.set("format", "json");
  const found = await fetch(search, {
    headers: { "User-Agent": "prediction-tracker/0.1 (public-claim research)" },
    signal: AbortSignal.timeout(20000),
  });
  const listing = (await found.json()) as { query?: { search?: { title: string }[] } };
  const titles = (listing.query?.search ?? [])
    .map((hit) => hit.title)
    .filter((title) => title.toLowerCase().includes(name.toLowerCase()))
    .sort((a, b) => Number(b.toLowerCase().includes("prediction")) - Number(a.toLowerCase().includes("prediction")))
    .slice(0, 2);
  if (titles.length === 0) titles.push(name);

  const collected: Page[] = [];
  for (const title of titles) {
    const pageUrl = new URL("https://en.wikipedia.org/w/api.php");
    pageUrl.searchParams.set("action", "parse");
    pageUrl.searchParams.set("page", title);
    pageUrl.searchParams.set("prop", "text|externallinks");
    pageUrl.searchParams.set("format", "json");
    const response = await fetch(pageUrl, {
      headers: { "User-Agent": "prediction-tracker/0.1 (public-claim research)" },
      signal: AbortSignal.timeout(20000),
    });
    const body = (await response.json()) as {
      parse?: { title?: string; text?: { "*": string }; externallinks?: string[] };
    };
    const html = body.parse?.text?.["*"] ?? "";
    const text = textFromHtml(html);
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    if (text.toLowerCase().includes(surname.toLowerCase())) collected.push({ url, text });
    for (const link of body.parse?.externallinks ?? []) {
      if (!link.startsWith("http") || skipHost.test(link) || collected.length >= 4) continue;
      try {
        const linked = await fetchText(link);
        if (linked.length > 400 && linked.toLowerCase().includes(surname.toLowerCase())) {
          collected.push({ url: link, text: linked });
        }
      } catch {
        // A dead citation is not a source.
      }
    }
  }
  return collected.slice(0, 4);
}

function complete(claim: ExtractedClaim): claim is Required<ExtractedClaim> {
  return Boolean(
    claim.quote_en &&
      claim.quote_zh &&
      claim.source_url &&
      claim.category &&
      claim.published_date &&
      isoDate.test(claim.published_date) &&
      claim.deadline &&
      isoDate.test(claim.deadline),
  );
}

async function insertVerified(ownerId: string, claim: Required<ExtractedClaim>) {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM claims
    WHERE person_id = ${ownerId}
      AND quote_en = ${claim.quote_en}
      AND deadline = ${claim.deadline}
      AND publication IN ('published', 'proposed')
    LIMIT 1
  `;
  if (existing.length > 0) return false;
  const id = `${ownerId}-live-${crypto.randomUUID()}`;
  await sql`
    INSERT INTO claims (
      id, person_id, category, claim_type, quote_en, quote_zh, source_url,
      published_date, deadline, actual_result, status, publication, rationale, evidence, provenance
    ) VALUES (
      ${id},
      ${ownerId},
      ${claim.category},
      'prediction',
      ${claim.quote_en},
      ${claim.quote_zh},
      ${claim.source_url},
      ${claim.published_date},
      ${claim.deadline},
      '',
      '待定',
      'proposed',
      '原话已在抓取到的出处页面中核对。尚未做兑现判定。',
      '[]'::jsonb,
      'agent'
    )
  `;
  await logEvent({
    claim_id: id,
    person_id: ownerId,
    action: "proposed",
    actor: "agent",
    after: { status: "待定", publication: "proposed", source_url: claim.source_url },
  });
  return true;
}

let currentStep = "发现公开发言";

async function main() {
  await migrate();
  const people = await sql<{ id: string; name_en: string }[]>`
    SELECT id, name_en FROM people WHERE id = ${personId} LIMIT 1
  `;
  const person = people[0];
  if (!person) {
    await record("发现公开发言", "failed", { reason: "人物不在库中" });
    throw new Error(`unknown person ${personId}`);
  }
  if (!arkConfigured()) {
    await record("发现公开发言", "blocked", { reason: "缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL，未写入任何主张" });
    return;
  }

  const pages = await wikiSources(person.name_en);
  await record("发现公开发言", "completed", { pages: pages.map((page) => page.url) });
  if (pages.length === 0) {
    await record("抽出可核对主张", "blocked", { reason: "没有抓到可读取的公开页面" });
    return;
  }

  currentStep = "抽出可核对主张";
  const extracted = (await arkJson(
    "只抽取这个人亲口说的、带明确截止时间的预测或承诺。记者、分析师、词条作者的转述句不要收。quote_en 必须是页面里连续出现的英文原句。找不到就返回空数组。source_url 必须是给定链接之一。日期用 YYYY-MM-DD。输出 JSON：{\"claims\":[{\"quote_en\":\"\",\"quote_zh\":\"\",\"source_url\":\"\",\"published_date\":\"YYYY-MM-DD\",\"deadline\":\"YYYY-MM-DD\",\"category\":\"\"}]}",
    JSON.stringify({
      person: person.name_en,
      pages: pages.slice(0, 3).map((page, index) => ({
        url: page.url,
        text: page.text.slice(0, index === 0 ? 4500 : 1800),
      })),
    }),
  )) as { claims?: ExtractedClaim[] };

  const byUrl = new Map(pages.map((page) => [page.url, page.text]));
  let kept = 0;
  let inserted = 0;
  for (const claim of extracted.claims ?? []) {
    if (!complete(claim)) continue;
    const page = byUrl.get(claim.source_url);
    if (!page || !quoteOnPage(page, claim.quote_en, person.name_en)) continue;
    if (!page.includes(claim.published_date.slice(0, 4))) continue;
    kept += 1;
    if (await insertVerified(person.id, claim)) inserted += 1;
  }
  await record("抽出可核对主张", "completed", {
    extracted: extracted.claims?.length ?? 0,
    verified: kept,
    inserted,
  });
}

main()
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await record(currentStep, "failed", { message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
