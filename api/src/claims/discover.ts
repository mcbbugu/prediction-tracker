// 按需分析：用户输入一个名字，agent 在后台找这个人带截止日的公开预测，逐条核对原话，到期的再找结果。
// 每一步写进 job_events，前端 /jobs/[id] 轮询显示真实进度。
// 核对通过的主张直接公开（标成机器核对），人物进入目录。做完后前端打开这个人的详情页。
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArkStopped, arkJson, arkSearch, takeModelCallId } from "../core/ark";
import { noteKindFailures } from "../core/notify";
import { sql } from "../core/db";
import { logEvent } from "../core/migrate";
import { excerpt, normalize, quoteOnPage, snapshot, usableLinks, type Snapshot } from "../evidence/sources";
import { ensurePortrait } from "../people/portrait";
import { recomputeScores } from "../scoring/score";
import { indicators } from "../scoring/indicators";
import { fillPersonInterests } from "../interests/interests";
import { applyVerdictAutomatically, promoteIfUnanimous, verifyClaim, type DueClaim } from "./verdict";

const MAX_PAGES = 10;
// A fixed domain list: free-form labels ("人工智能" vs "大模型" vs "AI") split one person's record
// into many tiny domains that never reach the 8-claim threshold.
export const DOMAINS = [
  "AI 模型与 AGI",
  "AI 芯片与算力",
  "自动驾驶",
  "电动车与电池",
  "机器人",
  "航天",
  "手机与消费电子",
  "互联网平台",
  "云与企业软件",
  "加密货币",
  "生物科技与医疗",
  "能源",
  "公司经营与财务",
  "宏观经济与市场",
  "其他科技",
];
const MAX_DUE_CHECKS = 3;
export const TRANSLATE_V1 = "TRANSLATE_V1";
export const IDENTIFY_V1 = "IDENTIFY_V1";
export const EXTRACT_V1 = "EXTRACT_V1";
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const hasChinese = (value: string) => /[\u4e00-\u9fff]/.test(value);

// Reported speech ("Musk said…", "April 2024: Musk tells…", "马斯克表示…") is the journalist's sentence, not the
// speaker's. Text inside quotation marks is the speaker's; anything outside that names the speaker or uses a
// third-person reporting verb means the quote is a paraphrase.
const REPORTING =
  /\b(he|she)\s+(\w+ed|\w+s|told|wrote|put|thinks?|said)\b|\bthey\s+(said|told|wrote|claimed|predicted)\b|(他|她)(表示|称|说|认为|预测|透露|承诺|指出|估计|预计|相信)/i;

export function isReportedSpeech(quote: string, names: string[]) {
  // An unclosed quotation mark runs to the end of the text.
  const outside = normalize(quote).replace(/"[^"]*("|$)/g, " ");
  if (REPORTING.test(outside)) return true;
  return names.some((name) => name && outside.includes(normalize(name)));
}

export function speakerNames(identity: { name_zh?: string | null; name_en?: string | null }) {
  return [identity.name_zh, identity.name_en, (identity.name_en ?? "").split(" ").at(-1)].filter(
    (name): name is string => Boolean(name && name.length >= 2),
  );
}

// Fills in a Chinese translation when the model left quote_zh in the original language.
export async function translateToChinese(quotes: string[]) {
  if (quotes.length === 0) return [];
  const result = (await arkJson(
    '把每句话忠实翻译成简体中文，不增删内容，不加引号。按顺序输出 JSON：{"zh":["",""]}',
    JSON.stringify(quotes),
    Math.min(4000, 400 + quotes.join("").length * 2),
    TRANSLATE_V1,
  )) as { zh?: string[] };
  return quotes.map((_, index) => {
    const zh = (result.zh?.[index] ?? "").trim();
    return hasChinese(zh) ? zh : "";
  });
}

type IdentityCandidate = { name_zh?: string; name_en?: string; title_zh?: string; why?: string };

type Identity = {
  found?: boolean;
  name_zh?: string;
  name_en?: string;
  title_zh?: string;
  slug?: string;
  is_public_figure?: boolean;
  is_politician?: boolean;
  aliases?: string[];
  reason?: string;
  candidates?: IdentityCandidate[];
};

export function inScope(identity: Pick<Identity, "found" | "name_zh" | "is_public_figure" | "is_politician">) {
  return Boolean(identity.found && identity.name_zh && identity.is_public_figure && !identity.is_politician);
}

export function identityTrace(identity: Identity, searchUrls: string[]) {
  const listed = (identity.candidates ?? []).filter((item) => item.name_zh || item.name_en);
  const candidates = listed.length
    ? listed
    : [{ name_zh: identity.name_zh, name_en: identity.name_en, title_zh: identity.title_zh, why: identity.reason }];
  return {
    name_zh: identity.name_zh,
    name_en: identity.name_en,
    title: identity.title_zh,
    candidates,
    reason: identity.reason ?? "",
    in_scope: inScope(identity),
    is_public_figure: Boolean(identity.is_public_figure),
    is_politician: Boolean(identity.is_politician),
    search_urls: searchUrls,
  };
}

export function archiveFailure(page: { http_status: number; text: string } | null) {
  if (!page) return "打不开";
  if (page.http_status >= 400) return `HTTP ${page.http_status}`;
  if (page.text.length < 400) return "正文太短";
  return null;
}

type Extracted = {
  page?: number;
  quote?: string;
  quote_zh?: string;
  quote_en?: string;
  article_date?: string;
  said_on?: string;
  deadline?: string;
  domain?: string;
  kind?: string;
};

export class JobStop extends Error {
  constructor(
    message: string,
    readonly state: "rejected" | "failed",
  ) {
    super(message);
  }
}

function emitter(jobId: string) {
  return async (step: string, status: "running" | "done" | "failed" | "info", message: string, data: Record<string, unknown> = {}) => {
    await sql`
      INSERT INTO job_events (job_id, step, status, message, data)
      VALUES (${jobId}, ${step}, ${status}, ${message}, ${sql.json(data as Parameters<typeof sql.json>[0])})
    `;
    await sql`UPDATE jobs SET updated_at = now() WHERE id = ${jobId}`;
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function identify(query: string, emit: ReturnType<typeof emitter>) {
  await emit("识别人物", "running", `确认「${query}」指的是谁`);
  const search = await arkSearch(
    `请联网确认「${query}」指的是哪位公众人物（名字可能有错别字或同音字）。` +
      `给出中文全名、英文名、主要身份，以及此人是否担任或担任过政府职务、政党职务或民选公职。`,
  );
  const identity = (await arkJson(
    [
      "根据用户查询和联网搜索摘要，判断这个名字指谁。",
      "is_public_figure：有公开身份（企业家、投资人、学者、科学家、媒体人、作家、体育或文艺界人物等）且经常公开发言。",
      "is_politician：此人的主要身份是政治人物（现任或前任政府官员、民选官员或候选人、政党人员、政府发言人）。企业家、学者、投资人短期担任政府顾问类职务，主要身份仍不是政治人物，填 false。",
      "slug：英文名的小写短横线形式，例如 liang-wenfeng。",
      "found=false 表示无法确定是谁或同名的人太多。",
      "candidates：搜索里可能对上的人，最多 5 个，包含被排除的同名者。确定是谁时，选中的人放第一条。why 用一句中文说明为什么是或不是。",
      '输出 JSON：{"found":true,"name_zh":"","name_en":"","title_zh":"","slug":"","is_public_figure":true,"is_politician":false,"aliases":[],"reason":"","candidates":[{"name_zh":"","name_en":"","title_zh":"","why":""}]}',
    ].join("\n"),
    JSON.stringify({ query, search_summary: search.text.slice(0, 3000) }),
    800,
    IDENTIFY_V1,
  )) as Identity;

  const trace = identityTrace(identity, search.urls);
  if (!identity.found || !identity.name_zh) {
    const message = `没能确认「${query}」是谁。${identity.reason ?? ""}`.trim();
    await emit("识别人物", "failed", message, trace);
    throw new JobStop(message, "failed");
  }
  if (identity.is_politician) {
    const message = `${identity.name_zh}属于政治人物，目前不收录。`;
    await emit("识别人物", "failed", message, trace);
    throw new JobStop(message, "rejected");
  }
  if (!identity.is_public_figure) {
    const message = `${identity.name_zh}看起来不是有公开身份的公众人物，不做分析。`;
    await emit("识别人物", "failed", message, trace);
    throw new JobStop(message, "rejected");
  }
  await emit("识别人物", "done", `${identity.name_zh}（${identity.name_en || "无英文名"}）· ${identity.title_zh || "公众人物"}`, trace);
  return identity;
}

async function ensurePerson(identity: Identity, query: string) {
  const names = [identity.name_zh, identity.name_en, query, ...(identity.aliases ?? [])].filter(Boolean) as string[];
  const lowered = names.map((name) => name.toLowerCase());
  const existing = await sql<{ id: string; visibility: string }[]>`
    SELECT id, visibility FROM people
    WHERE lower(name) IN (SELECT jsonb_array_elements_text(${sql.json(lowered)}))
       OR lower(name_en) IN (SELECT jsonb_array_elements_text(${sql.json(lowered)}))
       OR EXISTS (
         SELECT 1 FROM unnest(aliases) a
         WHERE lower(a) IN (SELECT jsonb_array_elements_text(${sql.json(lowered)}))
       )
    LIMIT 1
  `;
  if (existing[0]) return { id: existing[0].id, created: false };

  let id = slugify(identity.slug || identity.name_en || "") || `p-${crypto.randomUUID().slice(0, 8)}`;
  const taken = await sql`SELECT 1 FROM people WHERE id = ${id}`;
  if (taken.length > 0) id = `${id}-${crypto.randomUUID().slice(0, 4)}`;
  await sql`
    INSERT INTO people (id, name, name_en, title, visibility, aliases, curation)
    VALUES (
      ${id}, ${identity.name_zh!}, ${identity.name_en || identity.name_zh!}, ${identity.title_zh || "公众人物"}, 'draft',
      ARRAY(SELECT jsonb_array_elements_text(${sql.json([...new Set(names)])})),
      'auto'
    )
  `;
  return { id, created: true };
}

async function gatherPages(identity: Identity, emit: ReturnType<typeof emitter>) {
  await emit("搜索公开发言", "running", "联网搜索带明确时间的公开预测和承诺");
  const who = `${identity.name_zh}（${identity.name_en ?? ""}）`;
  const queries = [
    `请联网搜索 ${who} 公开说过的、带明确时间的预测或承诺，例如“到某年会…”“明年…”“三年内…”。` +
      `列出原始出处网页链接（采访原文、演讲实录、官方博客、新闻报道），尽量 6 到 10 个，不要只给网站首页。`,
    `Search the web for public predictions or commitments with a specific timeframe made by ${identity.name_en || identity.name_zh} ` +
      `(e.g. "by 2025", "next year", "within three years"). List 6-10 source URLs: interviews, transcripts, official blogs, news articles. No homepages.`,
  ];
  const urls: string[] = [];
  const searches: { query: string; urls: string[]; error?: string }[] = [];
  for (const query of queries) {
    try {
      const result = await arkSearch(query);
      urls.push(...result.urls);
      searches.push({ query, urls: result.urls });
    } catch (error) {
      if (error instanceof ArkStopped) throw error;
      const message = error instanceof Error ? error.message.slice(0, 120) : String(error);
      searches.push({ query, urls: [], error: message });
      await emit("搜索公开发言", "info", `一次搜索失败：${message}`, { query, urls: [] });
    }
  }
  const candidates = usableLinks(urls).slice(0, MAX_PAGES + 4);
  await emit("搜索公开发言", "done", `找到 ${candidates.length} 个可能的出处链接`, { urls: candidates, searches });
  if (candidates.length === 0) throw new JobStop("联网搜索没有找到可用的出处链接。", "failed");

  await emit("存档网页", "running", `逐个打开链接并保存正文`);
  const pages: Snapshot[] = [];
  const unreachable: string[] = [];
  const archives: {
    url: string;
    ok: boolean;
    reason: string | null;
    fetched_via: string | null;
    sha256: string | null;
    wayback_url: string | null;
    source_id: number | null;
  }[] = [];
  for (const url of candidates) {
    if (pages.length >= MAX_PAGES) {
      archives.push({ url, ok: false, reason: "已达存档上限", fetched_via: null, sha256: null, wayback_url: null, source_id: null });
      continue;
    }
    const page = await snapshot(url);
    const reason = archiveFailure(page);
    if (!page || reason) {
      unreachable.push(url);
      archives.push({
        url,
        ok: false,
        reason,
        fetched_via: page?.fetched_via ?? null,
        sha256: page?.sha256 ?? null,
        wayback_url: null,
        source_id: page?.id ?? null,
      });
      continue;
    }
    pages.push(page);
    archives.push({
      url: page.final_url,
      ok: true,
      reason: null,
      fetched_via: page.fetched_via,
      sha256: page.sha256,
      wayback_url: null,
      source_id: page.id,
    });
  }
  const savedIds = archives.flatMap((row) => (row.source_id == null ? [] : [row.source_id]));
  if (savedIds.length) {
    const shots = await sql<{ id: number; wayback_url: string | null }[]>`
      SELECT id::int AS id, wayback_url FROM sources WHERE id IN ${sql(savedIds)}
    `;
    const byId = new Map(shots.map((row) => [row.id, row.wayback_url]));
    for (const row of archives) if (row.source_id != null) row.wayback_url = byId.get(row.source_id) ?? null;
  }
  await emit("存档网页", "done", `存档 ${pages.length} 个网页，${unreachable.length} 个打不开或没有正文`, {
    archived: pages.map((page) => ({ url: page.final_url, title: page.title })),
    unreachable,
    archives,
  });
  if (pages.length === 0) throw new JobStop("搜到的链接都打不开，没法核对原话。", "failed");
  return pages;
}

async function extractClaims(identity: Identity, pages: Snapshot[], emit: ReturnType<typeof emitter>) {
  await emit("抽取预测", "running", "从存档原文里找此人说过的、带截止时间的话");
  const nameKeys = [identity.name_zh ?? "", identity.name_en ?? "", (identity.name_en ?? "").split(" ").at(-1) ?? ""].filter(
    (key) => key.length >= 2,
  );
  const keys = [...nameKeys, "年", "将", "会", "will", "by 20", "next year", "within"];
  const found: { page: Snapshot; item: Extracted; callId: string | null }[] = [];
  for (let start = 0; start < pages.length; start += 3) {
    const batch = pages.slice(start, start + 3);
    const result = (await arkJson(
      [
        `只从给定网页原文中抽取 ${identity.name_zh}（${identity.name_en ?? ""}）本人说的、带明确时间的预测或承诺。`,
        "- 两类都收（SPEC 原则 2）：kind=direct 是此人自己的话（引号里的直接引语，或演讲实录、本人博客、本人推文里的第一人称原话）；kind=reported 是可靠来源明确把这句话归于此人的转述（「X said/told/predicted…」「X 表示/称…」「according to X」），整句照抄，包括说话人名字和转述词。",
        "- 如果转述里带着引号内的原话且引号内容本身就看得出预测和期限，优先只取引号里面的部分，kind=direct。",
        "- 不要：作者或记者自己的推算、评论和背景介绍；没有归于此人的公司公告、新闻稿、产品发布信息；别人对此人计划的猜测。",
        "- 必须有时间：具体日期、年份、或「明年」「三年内」这类可换算的期限。没有期限的不要。",
        "- 不要任何关于选举结果和政府政策的预测。",
        "- quote 必须从该页原文逐字复制（保留原文语言），20 到 400 字，不改写、不拼接。direct 不要包含说话人名字和「said/表示」；reported 要保留，让人看得出是谁说的。",
        "- article_date 是这篇网页的发布日期（看不出就留空）。said_on 是此人说这话的日期：优先取原文里写明的说话时间（例如「in a 2019 interview」「2020 年 1 月的推文」），只知道年月就填当月 1 日，只知道年份填 1 月 1 日；原文没写才用 article_date。said_on 不能晚于 article_date。deadline 是期限到的那天（只有年份就填 12-31；「明年」按 said_on 推算）。格式 YYYY-MM-DD。",
        `- domain 只能从这个列表里选一个最贴切的：${DOMAINS.join("、")}。`,
        "- quote_zh 必须是简体中文译文（原文是中文就照抄原文），quote_en 是英文版本（原文是英文就照抄原文）。不要把英文原文直接填进 quote_zh。",
        "找不到就返回空数组，不要凑数。",
        '输出 JSON：{"claims":[{"page":1,"kind":"direct","quote":"","quote_zh":"","quote_en":"","article_date":"","said_on":"","deadline":"","domain":""}]}',
      ].join("\n"),
      JSON.stringify({
        person: { name_zh: identity.name_zh, name_en: identity.name_en },
        pages: batch.map((page, index) => ({
          page: index + 1,
          url: page.final_url,
          title: page.title,
          text: excerpt(page.text, keys, 4000),
        })),
      }),
      3000,
      EXTRACT_V1,
    )) as { claims?: Extracted[] };
    const callId = takeModelCallId(result);
    for (const item of result.claims ?? []) {
      const page = batch[(item.page ?? 0) - 1];
      if (page) found.push({ page, item, callId });
    }
  }
  await emit("抽取预测", "done", `模型提出 ${found.length} 条候选`, {
    candidates: found.map(({ page, item }) => ({
      quote: (item.quote ?? "").trim(),
      deadline: item.deadline ?? "",
      source_id: page.id,
      url: page.final_url,
    })),
  });
  return found;
}

async function keepVerified(
  personId: string,
  identity: Identity,
  candidates: { page: Snapshot; item: Extracted; callId: string | null }[],
  emit: ReturnType<typeof emitter>,
) {
  await emit("核对原话", "running", "逐条检查原话是否真的出现在存档网页里");
  const existing = await sql<{ quote_en: string; quote_original: string }[]>`
    SELECT quote_en, quote_original FROM claims WHERE person_id = ${personId}
  `;
  const seen = new Set(existing.flatMap((row) => [normalize(row.quote_en), normalize(row.quote_original)]).filter(Boolean));
  const speaker = speakerNames(identity);
  const names = speaker.map((name) => normalize(name));
  const today = new Date().toISOString().slice(0, 10);

  const kept: (DueClaim & { source_id: number })[] = [];
  const dropped: { quote: string; reason: string; source_id: number; outcome: "dropped" }[] = [];
  for (const { page, item, callId } of candidates) {
    const quote = (item.quote ?? "").trim();
    if (!quote || !item.deadline || !isoDate.test(item.deadline) || !item.said_on || !isoDate.test(item.said_on)) {
      dropped.push({ quote, reason: "缺日期或期限", source_id: page.id, outcome: "dropped" });
      continue;
    }
    if (item.said_on > today) {
      dropped.push({ quote, reason: "说话日期晚于今天", source_id: page.id, outcome: "dropped" });
      continue;
    }
    // Said-on can never be after the article that reports it.
    if (item.article_date && isoDate.test(item.article_date) && item.said_on > item.article_date) item.said_on = item.article_date;
    // 转述可以收，但必须是明确归于本人的那一句（SPEC 原则 2）。模型标成原话、句子却是转述的，改记为转述。
    if (item.kind === "reported" && !isReportedSpeech(quote, speaker)) {
      dropped.push({ quote, reason: "转述没有明确归于本人", source_id: page.id, outcome: "dropped" });
      continue;
    }
    if (isReportedSpeech(quote, speaker)) item.kind = "reported";
    if (!quoteOnPage(quote, page.text)) {
      dropped.push({ quote, reason: "原文里找不到这句话", source_id: page.id, outcome: "dropped" });
      continue;
    }
    if (!names.some((name) => normalize(page.text).includes(name))) {
      dropped.push({ quote, reason: "网页里没有出现此人名字", source_id: page.id, outcome: "dropped" });
      continue;
    }
    if (seen.has(normalize(quote))) {
      dropped.push({ quote, reason: "库里已有", source_id: page.id, outcome: "dropped" });
      continue;
    }
    seen.add(normalize(quote));
    let quoteZh = (item.quote_zh ?? "").trim();
    if (!hasChinese(quoteZh)) quoteZh = hasChinese(quote) ? quote : ((await translateToChinese([quote]))[0] ?? "");
    if (!quoteZh) {
      dropped.push({ quote, reason: "没能生成中文译文", source_id: page.id, outcome: "dropped" });
      continue;
    }
    const id = `${personId}-a-${crypto.randomUUID().slice(0, 8)}`;
    const claim = {
      id,
      person_id: personId,
      name_en: identity.name_en || identity.name_zh || "",
      category: DOMAINS.includes(item.domain ?? "") ? (item.domain as string) : "其他科技",
      quote_en: (item.quote_en || quote).trim(),
      quote_zh: quoteZh,
      source_url: page.final_url,
      source_id: page.id,
      published_date: item.said_on,
      deadline: item.deadline,
    };
    await sql`
      INSERT INTO claims (
        id, person_id, category, claim_type, quote_en, quote_zh, quote_original, source_url,
        published_date, deadline, actual_result, status, publication, rationale, evidence, provenance, quote_kind,
        model_call_id
      ) VALUES (
        ${claim.id}, ${personId}, ${claim.category}, 'prediction', ${claim.quote_en}, ${claim.quote_zh}, ${quote},
        ${claim.source_url}, ${claim.published_date}, ${claim.deadline}, '', '待定', 'published',
        ${`${item.kind === "reported" ? "转述" : "原话"}已在存档网页中逐字核对（sources#${page.id}，sha256 ${page.sha256.slice(0, 12)}）。尚未判定。`},
        '[]'::jsonb, 'agent', ${item.kind === "reported" ? "reported" : "direct"}, ${callId}
      )
    `;
    await sql`UPDATE claims SET published_at = now() WHERE id = ${claim.id}`;
    await logEvent({
      claim_id: id,
      person_id: personId,
      action: "proposed",
      actor: "agent",
      after: { status: "待定", publication: "published", source_url: page.final_url },
      note: "按需分析 · 机器核对后公开",
    });
    kept.push(claim);
  }
  await emit("核对原话", "done", `通过 ${kept.length} 条，丢弃 ${dropped.length} 条`, {
    kept: kept.map((claim) => ({
      id: claim.id,
      quote: claim.quote_zh,
      deadline: claim.deadline,
      domain: claim.category,
      url: claim.source_url,
      source_id: claim.source_id,
      outcome: "passed" as const,
    })),
    dropped,
  });
  return kept;
}

// sec.ts is a script (importing it runs the whole import), so hand it the org keys as a subprocess.
// It skips filings already stored, and ignores keys that are not on its ticker list.
async function importListedFilings(personId: string, emit: ReturnType<typeof emitter>) {
  const orgs = await sql<{ org_key: string }[]>`
    SELECT DISTINCT org_key FROM interests
    WHERE person_id = ${personId} AND org_key IS NOT NULL AND superseded_at IS NULL AND publication = 'published'
    ORDER BY org_key
  `;
  const keys = orgs.map((row) => row.org_key);
  if (keys.length === 0) {
    await emit("财务与敞口", "done", "没有关联机构，不导入申报", { orgs: [] });
    return;
  }
  await emit("财务与敞口", "running", `按 SEC 申报导入 ${keys.length} 家机构的营收和地区敞口`);
  const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const proc = Bun.spawn(["bun", "--env-file=.env", "run", "src/interests/sec.ts", `--orgs=${keys.join(",")}`, "--years=1"], {
    cwd: apiRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const log = `${stdout}\n${stderr}`.trim().slice(0, 2000);
  await emit("财务与敞口", code === 0 ? "done" : "failed", code === 0 ? `已核对 ${keys.length} 家机构的申报` : `SEC 导入退出码 ${code}`, {
    orgs: keys,
    exit_code: code,
    log,
  });
}

async function jobSearchCount(afterId: number) {
  const caller = basename(process.argv[1] ?? "");
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ark_calls
    WHERE kind = 'search' AND id > ${afterId} AND caller = ${caller}
  `;
  return row?.n ?? 0;
}

export async function runAnalyzeJob(jobId: string) {
  const emit = emitter(jobId);
  const started = Date.now();
  const [mark] = await sql<{ id: number }[]>`SELECT coalesce(max(id), 0)::int AS id FROM ark_calls`;
  const job = (await sql<{ query: string }[]>`SELECT query FROM jobs WHERE id = ${jobId}`)[0];
  if (!job) return;
  await sql`UPDATE jobs SET state = 'running', updated_at = now() WHERE id = ${jobId}`;
  const usage = async () => ({ elapsed_ms: Date.now() - started, search_count: await jobSearchCount(mark.id) });
  try {
    const identity = await identify(job.query, emit);
    const person = await ensurePerson(identity, job.query);
    await sql`UPDATE jobs SET person_id = ${person.id} WHERE id = ${jobId}`;
    if (!person.created) await emit("识别人物", "info", "库里已有此人，继续补充新的公开发言");
    try {
      const portrait = await ensurePortrait(person.id);
      if (portrait.ok) {
        await emit("识别人物", "info", `头像取自 Wikimedia Commons（${portrait.portrait.license}）`, {
          portrait_source_url: portrait.portrait.source,
        });
      } else if (portrait.reason !== "已有头像") {
        await emit("识别人物", "info", `暂无头像：${portrait.reason}`);
      }
    } catch (error) {
      await emit("识别人物", "info", `头像查找失败：${error instanceof Error ? error.message.slice(0, 120) : error}`);
    }

    const pages = await gatherPages(identity, emit);
    const candidates = await extractClaims(identity, pages, emit);
    const kept = await keepVerified(person.id, identity, candidates, emit);

    const today = new Date().toISOString().slice(0, 10);
    const due = kept.filter((claim) => claim.deadline < today).slice(0, MAX_DUE_CHECKS);
    const verdicts: { claim: string; status: string; accepted: { source_id: number; url: string }[]; rejected: { url: string; quote: string; reason: string }[] }[] = [];
    if (due.length > 0) {
      await emit("到期核对", "running", `${due.length} 条已过截止日，逐条找结果`);
      for (const claim of due) {
        try {
          const outcome = await verifyClaim(claim, (status, message, data) => emit("到期核对", status, message, { claim: claim.id, ...data }), { cross: true });
          verdicts.push({ claim: claim.id, status: outcome.status, accepted: outcome.accepted, rejected: outcome.rejected });
          if (outcome.proposal_id) await applyVerdictAutomatically(outcome.proposal_id);
        } catch (error) {
          if (error instanceof ArkStopped) throw error;
          await emit("到期核对", "failed", `一条核对失败：${error instanceof Error ? error.message.slice(0, 120) : error}`, {
            claim: claim.id,
            status: null,
            accepted: [],
            rejected: [],
          });
        }
      }
      await emit("到期核对", "done", `核对了 ${verdicts.length} 条`, { verdicts });
    } else {
      await emit("到期核对", "done", "没有已过截止日的新主张", { verdicts: [] });
    }

    let interests = { kept: 0, linked: 0 };
    await emit("利益关系", "running", "查找任职、持股和商业往来");
    const [interestMark] = await sql<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
    try {
      interests = await fillPersonInterests(person.id);
      const relations = await sql<{ id: number; kind: string; counterparty: string; counterparty_zh: string; role: string; source_url: string; publication: string }[]>`
        SELECT id::int AS id, kind, counterparty, counterparty_zh, role, source_url, publication
        FROM interests
        WHERE person_id = ${person.id} AND created_at >= ${interestMark.at}
        ORDER BY id
      `;
      await emit("利益关系", "done", `新增 ${interests.kept} 条关系，${interests.linked} 条主张标上了利益`, { relations });
    } catch (error) {
      if (error instanceof ArkStopped) throw error;
      await emit("利益关系", "failed", `利益关系没补上：${error instanceof Error ? error.message.slice(0, 120) : error}`, { relations: [] });
    }

    await sql`UPDATE people SET visibility = 'public' WHERE id = ${person.id}`;
    const unanimous = await promoteIfUnanimous(person.id, verdicts.length);
    await importListedFilings(person.id, emit);
    await emit("分数与旁证", "running", "按已公开的主张重算领域分，并汇总改期和可检验度");
    await recomputeScores(person.id, { action: "auto_publish" });
    const indicatorRows = await sql<{ id: string; category: string; status: string; published_date: string; deadline: string; thread_id: string | null }[]>`
      SELECT id, category, status, to_char(published_date, 'YYYY-MM-DD') AS published_date,
             to_char(deadline, 'YYYY-MM-DD') AS deadline, thread_id
      FROM claims WHERE person_id = ${person.id} AND publication = 'published'
    `;
    const portrait = indicators(indicatorRows);
    await emit("分数与旁证", "done", `已重算。改期 ${portrait.rescheduling.rescheduled}/${portrait.rescheduling.commitments}，可判定 ${portrait.testability.judged}/${portrait.testability.resolved}`, {
      claims: indicatorRows.length,
      rescheduling: portrait.rescheduling,
      testability: portrait.testability,
    });
    const summary = {
      person_id: person.id,
      person_created: person.created,
      claims_found: kept.length,
      due_checked: verdicts.length,
      verdicts,
      interests_found: interests.kept,
      cross_checked: unanimous,
      ...(await usage()),
    };
    await emit(
      "完成",
      "done",
      kept.length === 0
        ? "没有找到能核对的带期限说法。这个人暂时样本不足。"
        : `新增 ${kept.length} 条主张，${verdicts.length} 条已到期并自动判定，${interests.kept} 条利益关系。`,
      summary,
    );
    await sql`UPDATE jobs SET state = 'done', result = ${sql.json(summary)}, updated_at = now() WHERE id = ${jobId}`;
  } catch (error) {
    const stop = error instanceof JobStop ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    await emit("完成", "failed", stop ? message : `任务出错：${message.slice(0, 300)}`, { message, ...(await usage()) });
    await sql`
      UPDATE jobs SET state = ${stop?.state ?? "failed"}, result = ${sql.json({ message })}, updated_at = now()
      WHERE id = ${jobId}
    `;
    // Not this person's fault (outage, budget, access): let the worker put the job back and pause.
    if (!(error instanceof ArkStopped)) await noteKindFailures("analyze_person");
    if (error instanceof ArkStopped) throw error;
  } finally {
    const [row] = await sql<{ runner: string }[]>`SELECT runner FROM jobs WHERE id = ${jobId}`;
    if (row?.runner === "api") {
      const { pumpApiQueue } = await import("../jobs/analyze-limit");
      await pumpApiQueue();
    }
  }
}
