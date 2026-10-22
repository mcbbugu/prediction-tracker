// 原话复核：pnpm api:requote [-- --person=musk] [--all] [--dry-run]
// 对 provenance='agent' 的主张，用模型判断 quote 是不是本人的直接引语：
// - 是：保留；补中文译文、修正明显错误的说话日期。
// - 是记者转述，但存档原文里有引号内的原话：换成原话（仍须逐字出现在存档原文里），事件 quote_corrected。
// - 找不到原话：撤回公开（publication='proposed'，回到审核台），事件 quote_rejected。
// 已复核过的主张默认跳过（--all 重新复核）。受影响的人重算领域分。
import { arkConfigured, arkJson } from "../core/ark";
import { sql } from "../core/db";
import { hasChinese, isReportedSpeech, speakerNames, translateToChinese } from "./discover";
import { logEvent, migrate } from "../core/migrate";
import { recomputeScores } from "../scoring/score";
import { normalize, quoteOnPage, snapshot } from "../evidence/sources";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const onlyPerson = arg("person");
const onlyIds = arg("ids")?.split(",").filter(Boolean) ?? null;
const recheck = process.argv.includes("--all");
const dryRun = process.argv.includes("--dry-run");
const concurrency = Math.max(1, Math.min(6, Number(arg("concurrency") ?? 3)));
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const CHECKED = ["quote_checked", "quote_corrected", "quote_rejected"];

type Row = {
  id: string;
  person_id: string;
  name_zh: string;
  name_en: string;
  quote_en: string;
  quote_zh: string;
  quote_original: string;
  source_url: string;
  said_on: string;
  deadline: string;
  publication: string;
  rationale: string;
};

type Judgement = {
  direct?: boolean;
  speaker_quote?: string;
  attributed?: boolean;
  quote_zh?: string;
  quote_en?: string;
  said_on?: string;
  said_on_basis?: string;
  reason?: string;
};

// Replacement quotes already used in this run, so two claims cannot both become the same sentence.
const taken = new Set<string>();

const words = (value: string) => normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// The parts of a quote inside quotation marks, joined with "…" (quoteOnPage checks each piece in order):
// “2025 has seen…,” he said. “2026 will…” → 2025 has seen… … 2026 will…
function quotedParts(quote: string) {
  // Fold curly quotes only; normalize() would also lowercase the words that get stored.
  const parts = [...quote.replace(/[“”„‟«»「」『』]/g, '"').matchAll(/"([^"]+)"/g)]
    .map((match) => match[1].trim().replace(/[,，]+$/, ""))
    .filter((part) => part.length >= 15);
  return parts.join(" … ");
}

// The saved copy the quote was checked against: sources#id from the rationale, else the latest copy of the URL.
async function pageFor(row: Row) {
  const ref = row.rationale.match(/sources#(\d+)/)?.[1];
  if (ref) {
    const hit = await sql<{ text: string; title: string }[]>`SELECT text, title FROM sources WHERE id = ${Number(ref)}`;
    if (hit[0]) return hit[0];
  }
  const latest = await sql<{ text: string; title: string }[]>`
    SELECT text, title FROM sources
    WHERE (final_url = ${row.source_url} OR url = ${row.source_url}) AND http_status < 400
    ORDER BY fetched_at DESC LIMIT 1
  `;
  if (latest[0]) return latest[0];
  const fresh = await snapshot(row.source_url);
  return fresh && fresh.http_status < 400 ? { text: fresh.text, title: fresh.title } : null;
}

// The lines around where the quote sits on the page, so the model sees the surrounding quotation marks and dates.
function contextAround(text: string, quote: string, budget = 3500) {
  const lines = text.split("\n");
  const probe = words(quote).split(" ").slice(0, 8).join(" ");
  const at = probe ? lines.findIndex((line) => words(line).includes(probe)) : -1;
  if (at < 0) return text.slice(0, budget);
  let from = at;
  let to = at + 1;
  let used = lines[at].length;
  while (used < budget && (from > 0 || to < lines.length)) {
    if (from > 0) used += lines[--from].length;
    if (to < lines.length && used < budget) used += lines[to++].length;
  }
  return lines.slice(from, to).join("\n").slice(0, budget * 1.5);
}

async function judge(row: Row, quote: string, page: { text: string; title: string }) {
  return (await arkJson(
    [
      `你在复核一条「${row.name_zh}（${row.name_en}）的原话」是否真是本人说的话。只依据给定网页原文判断，不要用记忆。`,
      "direct：quote 整句都是此人自己的话（引号里的直接引语，或此人第一人称的原话）时为 true。记者叙述和转述（「X said/revealed/tells/claimed…」「X 表示/称…」「April 2024: X tells…」、以说话人名字为主语的句子）为 false。",
      "speaker_quote：direct 为 false 时，从原文里找出此人自己说的、表达同一预测的原话（通常在引号里），逐字复制，不改写、不拼接、不带引号外的叙述和说话人名字；必须包含预测内容本身和与 deadline 对应的时间期限，说的必须是同一件事（不能换成同页另一句预测），至少 20 个字符。只有引号里的零碎短语（例如 \"in a month or two\"）或原文里没有原话时留空。direct 为 true 时留空。",
      "quote_zh：最终原话（direct 时是 quote，否则是 speaker_quote）的简体中文忠实译文；quote_en：它的英文版本（原文是英文就照抄）。speaker_quote 为空且 direct 为 false 时这两项留空。",
      "said_on：原文明确写出此人说这话的日期时填 YYYY-MM-DD（只知道年月填当月 1 日，只知道年份填 1 月 1 日）；原文没写就留空。said_on_basis：原文里说明这个日期的那几个词，逐字复制。",
      "attributed：quote 是可靠来源明确把这项预测或承诺归于此人的转述时为 true（原文写明是此人说的、表示的、预测的，例如「X said…」「据 X 称」）；作者或记者自己的推算和评论、没有归于此人的公司公告和新闻稿、别人对此人计划的猜测为 false。direct 为 true 时也填 true。",
      "reason：一句中文说明判断理由。",
      '输出 JSON：{"direct":true,"speaker_quote":"","attributed":true,"quote_zh":"","quote_en":"","said_on":"","said_on_basis":"","reason":""}',
    ].join("\n"),
    JSON.stringify({
      person: { name_zh: row.name_zh, name_en: row.name_en },
      quote,
      recorded_said_on: row.said_on,
      deadline: row.deadline,
      page_title: page.title,
      page_text: contextAround(page.text, quote),
    }),
    1500,
  )) as Judgement;
}

type Outcome = "kept" | "corrected" | "rejected" | "unreachable" | "failed";

async function requote(row: Row, touched: Set<string>, log: (line: string) => void): Promise<Outcome> {
  const quote = (row.quote_original || row.quote_en).trim();
  const speaker = speakerNames({ name_zh: row.name_zh, name_en: row.name_en });
  const page = await pageFor(row);
  if (!page) {
    // Cannot re-open the page: the quote stays as it is, but it still needs a Chinese version.
    if (!hasChinese(row.quote_zh) && !dryRun) {
      const zh = (await translateToChinese([quote]))[0];
      if (zh) {
        await sql`UPDATE claims SET quote_zh = ${zh} WHERE id = ${row.id}`;
        await logEvent({ claim_id: row.id, person_id: row.person_id, action: "translation_added", actor: "agent", before: { quote_zh: row.quote_zh }, after: { quote_zh: zh } });
      }
    }
    log(`? ${row.id} 出处页打不开，未复核`);
    return "unreachable";
  }

  const verdict = await judge(row, quote, page);
  const reported = isReportedSpeech(quote, speaker);
  const direct = Boolean(verdict.direct) && !reported && quoteOnPage(quote, page.text);
  // The model says the words are the speaker's, but a reporting frame ("…," he said) sits outside the quotation marks.
  const inner = !direct && verdict.direct ? quotedParts(quote) : "";
  const candidate = (inner || (verdict.speaker_quote ?? "")).trim().replace(/^["“”']+|["“”',，]+$/g, "").trim();
  let duplicate = false;
  if (!direct && candidate) {
    const others = await sql<{ quote_original: string; quote_en: string }[]>`
      SELECT quote_original, quote_en FROM claims WHERE person_id = ${row.person_id} AND id <> ${row.id}
    `;
    const key = words(candidate);
    duplicate = taken.has(key) || others.some((other) => [other.quote_original, other.quote_en].some((text) => text && words(text) === key));
  }
  const replacement =
    !direct && !duplicate && candidate.length >= 20 && !isReportedSpeech(candidate, speaker) && quoteOnPage(candidate, page.text)
      ? candidate
      : "";
  if (replacement) taken.add(words(replacement));
  // SPEC 原则 2: a reliable source attributing the prediction to the person counts as 转述 (kept as is, labelled).
  const reportedKeep = !direct && !replacement && !duplicate && Boolean(verdict.attributed) && quoteOnPage(quote, page.text);

  if (!direct && !replacement && !reportedKeep) {
    const why = duplicate
      ? "原句是转述，页面里对应的原话已是另一条主张"
      : reported
        ? "引号外是记者叙述（出现说话人名字或转述动词）"
        : "模型判定不是本人直接引语，也不是明确归于此人的转述";
    const reason = duplicate
      ? `${why}，不重复收录。${verdict.reason ?? ""}`.trim()
      : `${why}，也不是可靠来源明确归于此人的转述。${verdict.reason ?? ""}`.trim();
    log(`✗ ${row.id} 撤回：${quote.slice(0, 80)}`);
    if (dryRun) return "rejected";
    if (row.publication === "published") {
      await sql`UPDATE claims SET publication = 'proposed', published_at = NULL WHERE id = ${row.id}`;
      touched.add(row.person_id);
    }
    await logEvent({
      claim_id: row.id,
      person_id: row.person_id,
      action: "quote_rejected",
      actor: "agent",
      before: { publication: row.publication, quote },
      after: { publication: row.publication === "published" ? "proposed" : row.publication },
      note: reason,
    });
    return "rejected";
  }

  const finalQuote = direct || reportedKeep ? quote : replacement;
  const update: Partial<Pick<Row, "quote_original" | "quote_en" | "quote_zh" | "said_on">> = {};
  if (!direct && !reportedKeep) {
    update.quote_original = replacement;
    update.quote_en = hasChinese(replacement) ? (verdict.quote_en ?? "").trim() || replacement : replacement;
  }
  let zh = (verdict.quote_zh ?? "").trim();
  if (!hasChinese(zh)) zh = hasChinese(finalQuote) ? finalQuote : "";
  if (!zh && !dryRun) zh = (await translateToChinese([finalQuote]))[0] ?? "";
  if (zh && (!direct || !hasChinese(row.quote_zh))) update.quote_zh = zh;

  // Change the date only when the page itself states it and the stated words carry that year.
  const saidOn = (verdict.said_on ?? "").trim();
  const basis = (verdict.said_on_basis ?? "").trim();
  const today = new Date().toISOString().slice(0, 10);
  if (
    isoDate.test(saidOn) &&
    saidOn <= today &&
    saidOn.slice(0, 7) !== row.said_on.slice(0, 7) &&
    basis.length >= 4 &&
    basis.includes(saidOn.slice(0, 4)) &&
    normalize(page.text).includes(normalize(basis))
  ) {
    update.said_on = saidOn;
  }

  log(
    `${direct ? "✓" : "↻"} ${row.id}${direct ? "" : ` 换成原话：${replacement.slice(0, 80)}`}` +
      `${update.quote_zh && direct ? " · 补中文" : ""}${update.said_on ? ` · said_on ${row.said_on} → ${update.said_on}（${basis}）` : ""}`,
  );
  if (dryRun) return direct || reportedKeep ? "kept" : "corrected";

  await sql`
    UPDATE claims SET
      quote_kind = ${reportedKeep ? "reported" : "direct"},
      quote_original = ${update.quote_original ?? row.quote_original},
      quote_en = ${update.quote_en ?? row.quote_en},
      quote_zh = ${update.quote_zh ?? row.quote_zh},
      published_date = ${update.said_on ?? row.said_on}
    WHERE id = ${row.id}
  `;
  // A claim this script withdrew earlier and that now passes goes back on the site.
  const withdrawn = await sql<{ before: { publication?: string } | null }[]>`
    SELECT before FROM claim_events WHERE claim_id = ${row.id} AND action IN ${sql(CHECKED)} ORDER BY id DESC LIMIT 1
  `;
  if (row.publication === "proposed" && withdrawn[0]?.before?.publication === "published") {
    await sql`UPDATE claims SET publication = 'published', published_at = now() WHERE id = ${row.id}`;
    touched.add(row.person_id);
    await logEvent({
      claim_id: row.id,
      person_id: row.person_id,
      action: "quote_restored",
      actor: "agent",
      before: { publication: "proposed" },
      after: { publication: "published" },
      note: "重新复核通过，恢复公开（机器核对）。",
    });
  }
  if (reportedKeep) {
    touched.add(row.person_id);
    await logEvent({
      claim_id: row.id,
      person_id: row.person_id,
      action: "quote_marked_reported",
      actor: "agent",
      after: { quote_kind: "reported" },
      note: `可靠来源明确归于此人的转述，按 SPEC 原则 2 保留并标「转述」。${verdict.reason ?? ""}`.trim(),
    });
  } else if (!direct) {
    touched.add(row.person_id);
    await logEvent({
      claim_id: row.id,
      person_id: row.person_id,
      action: "quote_corrected",
      actor: "agent",
      before: { quote_original: row.quote_original, quote_en: row.quote_en, quote_zh: row.quote_zh },
      after: { quote_original: update.quote_original, quote_en: update.quote_en, quote_zh: update.quote_zh ?? row.quote_zh },
      note: `原句是记者转述，换成存档原文里逐字出现的本人原话。${verdict.reason ?? ""}`.trim(),
    });
  } else {
    await logEvent({
      claim_id: row.id,
      person_id: row.person_id,
      action: "quote_checked",
      actor: "agent",
      after: update.quote_zh ? { quote_zh: update.quote_zh } : undefined,
      note: `复核为本人直接引语${update.quote_zh ? "，补中文译文" : ""}。`,
    });
  }
  if (update.said_on) {
    await logEvent({
      claim_id: row.id,
      person_id: row.person_id,
      action: "said_on_corrected",
      actor: "agent",
      before: { published_date: row.said_on },
      after: { published_date: update.said_on },
      note: `原文写明：${basis}`,
    });
  }
  return direct || reportedKeep ? "kept" : "corrected";
}

async function main() {
  await migrate();
  if (!arkConfigured()) throw new Error("缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL（api/.env）");
  const rows = await sql<Row[]>`
    SELECT c.id, c.person_id, p.name AS name_zh, p.name_en, c.quote_en, c.quote_zh, c.quote_original, c.source_url,
           to_char(c.published_date, 'YYYY-MM-DD') AS said_on, to_char(c.deadline, 'YYYY-MM-DD') AS deadline,
           c.publication, c.rationale
    FROM claims c JOIN people p ON p.id = c.person_id
    WHERE c.provenance = 'agent'
      AND (${onlyPerson ?? null}::text IS NULL OR c.person_id = ${onlyPerson ?? null})
      AND (${onlyIds === null} OR c.id IN ${sql(onlyIds ?? [""])})
      AND (${recheck} OR NOT EXISTS (
        SELECT 1 FROM claim_events e WHERE e.claim_id = c.id AND e.action IN ${sql(CHECKED)}
      ))
    ORDER BY c.person_id, c.id
  `;
  console.log(`复核 ${rows.length} 条 agent 主张${dryRun ? "（演练，不写库）" : ""}`);
  const counts: Record<Outcome, number> = { kept: 0, corrected: 0, rejected: 0, unreachable: 0, failed: 0 };
  const touched = new Set<string>();
  const queue = [...rows];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        try {
          counts[await requote(row, touched, console.log)] += 1;
        } catch (error) {
          counts.failed += 1;
          console.log(`! ${row.id} 失败：${error instanceof Error ? error.message.slice(0, 160) : error}`);
        }
      }
    }),
  );
  for (const person of touched) await recomputeScores(person, { action: "quote_review" });
  const leftEnglish = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM claims
    WHERE provenance = 'agent' AND publication = 'published' AND quote_zh !~ '[一-鿿]'
  `;
  console.log(
    `\n检查 ${rows.length} 条：保留 ${counts.kept}，修正为原话 ${counts.corrected}，撤回公开 ${counts.rejected}，` +
      `出处打不开 ${counts.unreachable}，失败 ${counts.failed}。重算 ${touched.size} 人的领域分。` +
      `公开的 agent 主张里仍无中文译文：${leftEnglish[0].n} 条。`,
  );
}

if (import.meta.main)
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await sql.end();
    });
