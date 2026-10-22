// 按需分析：用户输入一个名字，agent 在后台找这个人带截止日的公开预测，逐条核对原话，到期的再找结果。
// 每一步写进 job_events，前端 /jobs/[id] 轮询显示真实进度。
// 抽到的主张一律是「待发布」提案；人物在审核通过前是 draft，不出现在公开列表里。
import { ArkStopped, arkJson, arkSearch } from "../core/ark";
import { sql } from "../core/db";
import { logEvent } from "../core/migrate";
import { excerpt, normalize, quoteOnPage, snapshot, usableLinks, type Snapshot } from "../evidence/sources";
import { ensurePortrait } from "../people/portrait";
import { recomputeScores } from "../scoring/score";
import { applyVerdictIfAllowed, verifyClaim, type DueClaim } from "./verdict";
import { localPublishMode } from "../core/env";

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
// AUTO_PUBLISH=1 is for a local, not-yet-public site only: machine-checked claims go straight onto the
// site, labelled 机器核对. Before going public, turn it off and calibrate (see SPEC.md 核对分层).
const autoPublish = () => localPublishMode();
const MAX_DUE_CHECKS = 3;
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
  )) as { zh?: string[] };
  return quotes.map((_, index) => {
    const zh = (result.zh?.[index] ?? "").trim();
    return hasChinese(zh) ? zh : "";
  });
}

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
};

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
      '输出 JSON：{"found":true,"name_zh":"","name_en":"","title_zh":"","slug":"","is_public_figure":true,"is_politician":false,"aliases":[],"reason":""}',
    ].join("\n"),
    JSON.stringify({ query, search_summary: search.text.slice(0, 3000) }),
    800,
  )) as Identity;

  if (!identity.found || !identity.name_zh) {
    throw new JobStop(`没能确认「${query}」是谁。${identity.reason ?? ""}`.trim(), "failed");
  }
  if (identity.is_politician) {
    throw new JobStop(`${identity.name_zh}属于政治人物，目前不收录。`, "rejected");
  }
  if (!identity.is_public_figure) {
    throw new JobStop(`${identity.name_zh}看起来不是有公开身份的公众人物，不做分析。`, "rejected");
  }
  await emit("识别人物", "done", `${identity.name_zh}（${identity.name_en || "无英文名"}）· ${identity.title_zh || "公众人物"}`, {
    name_zh: identity.name_zh,
    name_en: identity.name_en,
    title: identity.title_zh,
  });
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
    INSERT INTO people (id, name, name_en, title, visibility, aliases)
    VALUES (
      ${id}, ${identity.name_zh!}, ${identity.name_en || identity.name_zh!}, ${identity.title_zh || "公众人物"}, 'draft',
      ARRAY(SELECT jsonb_array_elements_text(${sql.json([...new Set(names)])}))
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
  for (const query of queries) {
    try {
      const result = await arkSearch(query);
      urls.push(...result.urls);
    } catch (error) {
      if (error instanceof ArkStopped) throw error;
      await emit("搜索公开发言", "info", `一次搜索失败：${error instanceof Error ? error.message.slice(0, 120) : error}`);
    }
  }
  const candidates = usableLinks(urls).slice(0, MAX_PAGES + 4);
  await emit("搜索公开发言", "done", `找到 ${candidates.length} 个可能的出处链接`, { urls: candidates });
  if (candidates.length === 0) throw new JobStop("联网搜索没有找到可用的出处链接。", "failed");

  await emit("存档网页", "running", `逐个打开链接并保存正文`);
  const pages: Snapshot[] = [];
  const unreachable: string[] = [];
  for (const url of candidates) {
    if (pages.length >= MAX_PAGES) break;
    const page = await snapshot(url);
    if (!page || page.http_status >= 400 || page.text.length < 400) {
      unreachable.push(url);
      continue;
    }
    pages.push(page);
  }
  await emit("存档网页", "done", `存档 ${pages.length} 个网页，${unreachable.length} 个打不开或没有正文`, {
    archived: pages.map((page) => ({ url: page.final_url, title: page.title })),
    unreachable,
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
  const found: { page: Snapshot; item: Extracted }[] = [];
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
    )) as { claims?: Extracted[] };
    for (const item of result.claims ?? []) {
      const page = batch[(item.page ?? 0) - 1];
      if (page) found.push({ page, item });
    }
  }
  await emit("抽取预测", "done", `模型提出 ${found.length} 条候选`);
  return found;
}

async function keepVerified(
  personId: string,
  identity: Identity,
  candidates: { page: Snapshot; item: Extracted }[],
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

  const kept: DueClaim[] = [];
  const dropped: { quote: string; reason: string }[] = [];
  for (const { page, item } of candidates) {
    const quote = (item.quote ?? "").trim();
    if (!quote || !item.deadline || !isoDate.test(item.deadline) || !item.said_on || !isoDate.test(item.said_on)) {
      dropped.push({ quote, reason: "缺日期或期限" });
      continue;
    }
    if (item.said_on > today) {
      dropped.push({ quote, reason: "说话日期晚于今天" });
      continue;
    }
    // Said-on can never be after the article that reports it.
    if (item.article_date && isoDate.test(item.article_date) && item.said_on > item.article_date) item.said_on = item.article_date;
    // 转述可以收，但必须是明确归于本人的那一句（SPEC 原则 2）。模型标成原话、句子却是转述的，改记为转述。
    if (item.kind === "reported" && !isReportedSpeech(quote, speaker)) {
      dropped.push({ quote, reason: "转述没有明确归于本人" });
      continue;
    }
    if (isReportedSpeech(quote, speaker)) item.kind = "reported";
    if (!quoteOnPage(quote, page.text)) {
      dropped.push({ quote, reason: "原文里找不到这句话" });
      continue;
    }
    if (!names.some((name) => normalize(page.text).includes(name))) {
      dropped.push({ quote, reason: "网页里没有出现此人名字" });
      continue;
    }
    if (seen.has(normalize(quote))) {
      dropped.push({ quote, reason: "库里已有" });
      continue;
    }
    seen.add(normalize(quote));
    let quoteZh = (item.quote_zh ?? "").trim();
    if (!hasChinese(quoteZh)) quoteZh = hasChinese(quote) ? quote : ((await translateToChinese([quote]))[0] ?? "");
    if (!quoteZh) {
      dropped.push({ quote, reason: "没能生成中文译文" });
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
      published_date: item.said_on,
      deadline: item.deadline,
    };
    await sql`
      INSERT INTO claims (
        id, person_id, category, claim_type, quote_en, quote_zh, quote_original, source_url,
        published_date, deadline, actual_result, status, publication, rationale, evidence, provenance, quote_kind
      ) VALUES (
        ${claim.id}, ${personId}, ${claim.category}, 'prediction', ${claim.quote_en}, ${claim.quote_zh}, ${quote},
        ${claim.source_url}, ${claim.published_date}, ${claim.deadline}, '', '待定', ${autoPublish() ? "published" : "proposed"},
        ${`${item.kind === "reported" ? "转述" : "原话"}已在存档网页中逐字核对（sources#${page.id}，sha256 ${page.sha256.slice(0, 12)}）。尚未判定。`},
        '[]'::jsonb, 'agent', ${item.kind === "reported" ? "reported" : "direct"}
      )
    `;
    if (autoPublish()) await sql`UPDATE claims SET published_at = now() WHERE id = ${claim.id}`;
    await logEvent({
      claim_id: id,
      person_id: personId,
      action: "proposed",
      actor: "agent",
      after: { status: "待定", publication: autoPublish() ? "published" : "proposed", source_url: page.final_url },
      note: autoPublish() ? "按需分析 · 自动公开（机器核对）" : "按需分析",
    });
    kept.push(claim);
  }
  await emit("核对原话", "done", `通过 ${kept.length} 条，丢弃 ${dropped.length} 条`, {
    kept: kept.map((claim) => ({ id: claim.id, quote: claim.quote_zh, deadline: claim.deadline, domain: claim.category, url: claim.source_url })),
    dropped,
  });
  return kept;
}

export async function runAnalyzeJob(jobId: string) {
  const emit = emitter(jobId);
  const job = (await sql<{ query: string }[]>`SELECT query FROM jobs WHERE id = ${jobId}`)[0];
  if (!job) return;
  await sql`UPDATE jobs SET state = 'running', updated_at = now() WHERE id = ${jobId}`;
  try {
    const identity = await identify(job.query, emit);
    const person = await ensurePerson(identity, job.query);
    await sql`UPDATE jobs SET person_id = ${person.id} WHERE id = ${jobId}`;
    if (!person.created) await emit("识别人物", "info", "库里已有此人，继续补充新的公开发言");
    if (person.created) {
      try {
        const portrait = await ensurePortrait(person.id);
        await emit(
          "识别人物",
          "info",
          portrait.ok ? `头像取自 Wikimedia Commons（${portrait.portrait.license}）` : `暂无头像：${portrait.reason}`,
          portrait.ok ? { portrait_source_url: portrait.portrait.source } : {},
        );
      } catch (error) {
        await emit("识别人物", "info", `头像查找失败：${error instanceof Error ? error.message.slice(0, 120) : error}`);
      }
    }

    const pages = await gatherPages(identity, emit);
    const candidates = await extractClaims(identity, pages, emit);
    const kept = await keepVerified(person.id, identity, candidates, emit);

    const today = new Date().toISOString().slice(0, 10);
    const due = kept.filter((claim) => claim.deadline < today).slice(0, MAX_DUE_CHECKS);
    const verdicts: { claim: string; status: string }[] = [];
    if (due.length > 0) {
      await emit("到期核对", "running", `${due.length} 条已过截止日，逐条找结果`);
      for (const claim of due) {
        try {
          const outcome = await verifyClaim(claim, (status, message, data) => emit("到期核对", status, message, { claim: claim.id, ...data }));
          verdicts.push({ claim: claim.id, status: outcome.status });
          if (outcome.proposal_id) await applyVerdictIfAllowed(outcome.proposal_id);
        } catch (error) {
          if (error instanceof ArkStopped) throw error;
          await emit("到期核对", "failed", `一条核对失败：${error instanceof Error ? error.message.slice(0, 120) : error}`, { claim: claim.id });
        }
      }
    }

    if (autoPublish() && kept.length > 0) {
      await sql`UPDATE people SET visibility = 'public' WHERE id = ${person.id}`;
      await recomputeScores(person.id, { action: "auto_publish" });
    }
    const summary = {
      person_id: person.id,
      person_created: person.created,
      claims_found: kept.length,
      due_checked: verdicts.length,
      verdicts,
    };
    await emit(
      "完成",
      "done",
      kept.length === 0
        ? "没有找到能核对的带期限说法。这个人暂时样本不足。"
        : autoPublish()
          ? `新增 ${kept.length} 条主张并以「机器核对」公开，${verdicts.length} 条已到期并自动判定。`
          : `新增 ${kept.length} 条待审核主张，${verdicts.length} 条已到期并给出判定建议。审核通过后才会公开。`,
      summary,
    );
    await sql`UPDATE jobs SET state = 'done', result = ${sql.json(summary)}, updated_at = now() WHERE id = ${jobId}`;
  } catch (error) {
    const stop = error instanceof JobStop ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    await emit("完成", "failed", stop ? message : `任务出错：${message.slice(0, 300)}`);
    await sql`
      UPDATE jobs SET state = ${stop?.state ?? "failed"}, result = ${sql.json({ message })}, updated_at = now()
      WHERE id = ${jobId}
    `;
    // Not this person's fault (outage, budget, access): let the worker put the job back and pause.
    if (error instanceof ArkStopped) throw error;
  }
}
