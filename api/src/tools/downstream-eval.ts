// bun --env-file=.env run src/tools/downstream-eval.ts [--v2 | --v3]
// 同一模型答 10 题：A 不给先验，B 附上 /v1/prior。每题每组 3 次。
// --v3（037）：B 组用严格时点的先验（strict=1，只含说话当天已经入库的信息），报告带 bootstrap 区间。
// 默认和 --v2 用的是回溯先验（结果按今天查到的判定），有未来信息，只留作对照。
// 走模型调用缓存。再跑一遍应得到同一份报告。评分模型看不到 A/B。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arkJson } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { priorAsOf } from "../queries/prior";

const ANSWER_V1 = "DOWNSTREAM_ANSWER_V1";
const SCORE_V1 = "DOWNSTREAM_SCORE_V1";
const LEAK_V1 = "DOWNSTREAM_LEAK_V1";
const RUNS = 3;

const ANSWER_PROMPT = [
  "你在估计一件已经公开的说法会不会按时发生。",
  "只根据给你的材料。没有的事实不要编。",
  "材料很少时，直接写样本不足，概率放在 0.5 附近。",
  '只输出 JSON：{"probability":0.5,"reason":""}。probability 是 0 到 1。',
].join("\n");

const LEAK_PROMPT = [
  "只根据你训练时见过的知识回答，不要假装查过资料。",
  "如果记不清或没见过结果，happened 填 unknown，detail 留空。",
  "只有你能说出后来实际怎样（日期、产品名、数字）时，才填 yes、no 或 partial。",
  '只输出 JSON：{"happened":"unknown","detail":""}。happened 只能是 yes、no、partial、unknown。',
].join("\n");

const SCORE_PROMPT = [
  "你在给一段概率估计打分。你不知道它来自哪一组，也不知道后来实际发生了没有。",
  "evidence：0 没有可核对的事实；1 事实大体说得通；2 引用了具体主张、数字或出处。",
  "uncertainty：如果题目标明数据很少，回答明确说了不确定或样本不足，记 1，否则 0。如果题目标明数据充足，回答没有把薄证据说成很确定，记 1，否则 0。",
  '只输出 JSON：{"evidence":0,"uncertainty":0}。',
].join("\n");

export type Question = {
  id: string;
  bucket: "rich" | "sparse" | "interest";
  person_id: string;
  person: string;
  claim_id: string;
  said_on: string;
  as_of: string;
  outcome: number;
  outcome_status: string;
  quote_zh: string;
  question: string;
};

export type Answer = { probability: number; reason: string };

export function brier(probability: number, outcome: number) {
  return (probability - outcome) ** 2;
}

export function overconfident(probability: number, outcome: number) {
  const extreme = probability >= 0.9 || probability <= 0.1;
  return extreme && Math.abs(probability - outcome) >= 0.4;
}

export function leaked(outcomeStatus: string, happened: string, detail: string) {
  if (happened === "unknown" || detail.trim().length < 12) return false;
  if (outcomeStatus === "已兑现") return happened === "yes";
  if (outcomeStatus === "未兑现") return happened === "no";
  if (outcomeStatus === "部分兑现") return happened === "partial";
  return false;
}

// Evidence is scored 0, 1 or 2. Anything else is null (counted as invalid), never squeezed into range (#9).
export function parseEvidenceScore(value: unknown): 0 | 1 | 2 | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
  return number === 0 || number === 1 || number === 2 ? number : null;
}

export function clampProbability(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number));
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function loadQuestions() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../../../data/eval/downstream/questions.jsonl");
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Question);
}

async function priorJson(question: Question, strict = false) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${process.env.PORT || 3011}/v1/prior?person=${encodeURIComponent(question.person_id)}&as_of=${question.as_of}${strict ? "&strict=1" : ""}`,
    );
    // An API process started before 037 ignores strict=1; only trust it if it says the answer is strict.
    if (response.ok) {
      const text = await response.text();
      if (!strict || (JSON.parse(text) as { as_of_semantics?: string }).as_of_semantics === "strict") return text;
    }
  } catch {
    // The API process may be down. The same function it serves is the fallback.
  }
  return JSON.stringify(await priorAsOf({ person: question.person_id, as_of: question.as_of, strict }));
}

// Strict prior with nothing judged in any domain: the honest answer is 样本不足.
export function priorIsEmpty(prior: string) {
  const parsed = JSON.parse(prior) as { domains?: Record<string, { judged?: number }> };
  return Object.values(parsed.domains ?? {}).every((domain) => !domain.judged);
}

async function answerOnce(question: Question, group: "A" | "B", run: number, prior: string, strict = false) {
  const body = [`题目 ${question.id}`, `运行 ${run}`, question.question];
  if (group === "B" && strict) body.push("下面是说话当天已经可查到的先验（只含那天之前入库的判定和证据），JSON 原样附上。", prior);
  else if (group === "B") body.push("下面是本站的先验，JSON 原样附上。其中的判定结果是今天查到的，可能晚于说话当天。", prior);
  const raw = (await arkJson(ANSWER_PROMPT, body.join("\n"), 800, ANSWER_V1)) as { probability?: unknown; reason?: string };
  const probability = clampProbability(raw.probability);
  if (probability == null) throw new Error(`${question.id} ${group}#${run} 没有概率`);
  return { probability, reason: (raw.reason ?? "").trim() };
}

async function scoreOnce(question: Question, answer: Answer, key: string) {
  const raw = (await arkJson(
    SCORE_PROMPT,
    [
      `编号 ${key}`,
      `数据${question.bucket === "sparse" ? "很少" : "充足"}`,
      question.question,
      `概率 ${answer.probability}`,
      answer.reason,
    ].join("\n"),
    400,
    SCORE_V1,
  )) as { evidence?: unknown; uncertainty?: unknown };
  const uncertainty = raw.uncertainty === 1 || raw.uncertainty === true ? 1 : 0;
  return { evidence: parseEvidenceScore(raw.evidence), uncertainty };
}

function snippet(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 180);
}

async function probe(question: Question) {
  const raw = (await arkJson(
    LEAK_PROMPT,
    `${question.person} 在 ${question.said_on} 说过：「${question.quote_zh}」后来这件事发生了吗？`,
    300,
    LEAK_V1,
  )) as { happened?: string; detail?: string };
  const happened = ["yes", "no", "partial", "unknown"].includes(raw.happened ?? "") ? (raw.happened as string) : "unknown";
  const detail = (raw.detail ?? "").trim();
  return { happened, detail, leaked: leaked(question.outcome_status, happened, detail) };
}

function loadJsonl(name: string) {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../../../data/eval/downstream", name);
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Question);
}

function summarize(rows: { group: "A" | "B"; brier: number; evidence: number | null; uncertainty: number; overconfident: boolean }[]) {
  const side = (group: "A" | "B") => {
    const mine = rows.filter((row) => row.group === group);
    const scored = mine.flatMap((row) => (row.evidence == null ? [] : [row.evidence]));
    return {
      brier: round(mean(mine.map((row) => row.brier))),
      evidence: round(mean(scored)),
      evidence_invalid: mine.length - scored.length,
      uncertainty: round(mean(mine.map((row) => row.uncertainty))),
      overconfident: mine.filter((row) => row.overconfident).length,
      n: mine.length,
    };
  };
  return { A: side("A"), B: side("B") };
}

// Per-question mean Brier of B minus A, resampled by question (seeded, so a rerun gives the same interval).
export function bootstrapDiff(pairs: { a: number; b: number }[], draws = 2000, seed = 37) {
  if (!pairs.length) return null;
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const diffs: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    let sum = 0;
    for (let j = 0; j < pairs.length; j += 1) {
      const pick = pairs[Math.floor(next() * pairs.length)];
      sum += pick.b - pick.a;
    }
    diffs.push(sum / pairs.length);
  }
  diffs.sort((x, y) => x - y);
  const point = pairs.reduce((sum, pair) => sum + pair.b - pair.a, 0) / pairs.length;
  return { b_minus_a: round(point), low: round(diffs[Math.floor(draws * 0.025)]), high: round(diffs[Math.floor(draws * 0.975)]), questions: pairs.length };
}

async function mainV2(strict = false) {
  await migrate();
  const original = loadJsonl("questions.jsonl");
  const extra = loadJsonl("candidates.jsonl");
  const probes = [];
  for (const question of [...original, ...extra]) {
    const result = await probe(question);
    probes.push({ ...question, ...result });
    console.log(`${question.id} ${result.leaked ? "泄露" : "未泄露"} ${result.happened} ${result.detail.slice(0, 60)}`);
  }
  const clean = [...probes.filter((row) => !row.leaked && row.id.startsWith("c")), ...probes.filter((row) => !row.leaked && !row.id.startsWith("c"))];
  const people = new Set(clean.map((row) => row.person_id));
  const picked = clean.slice(0, 10);
  console.log(`未泄露 ${clean.length} 题，人物 ${people.size}，拿来对照 ${picked.length} 题`);
  if (picked.length < 4 || people.size < 4) console.log("未泄露题或人物不足 4，报告里按实际数量写。");

  const rows: { id: string; person: string; group: "A" | "B"; run: number; probability: number; reason: string; brier: number; overconfident: boolean; evidence: number | null; uncertainty: number }[] = [];
  const used: Question[] = [];
  const emptyPrior = new Set<string>();
  for (const question of clean) {
    if (used.length >= 10) break;
    let prior = "";
    try {
      prior = await priorJson(question, strict);
    } catch (error) {
      console.log(`${question.id} 没有公开先验，跳过：${error instanceof Error ? error.message : error}`);
      continue;
    }
    used.push(question);
    if (priorIsEmpty(prior)) emptyPrior.add(question.id);
    for (const group of ["A", "B"] as const) {
      for (let run = 1; run <= RUNS; run += 1) {
        const answered = await answerOnce(question, group, run, prior, strict);
        const key = createHash("sha256").update(`${question.id}:${group}:${run}:${answered.reason}`).digest("hex").slice(0, 12);
        const scored = await scoreOnce(question, answered, key);
        rows.push({
          id: question.id,
          person: question.person,
          group,
          run,
          probability: answered.probability,
          reason: answered.reason,
          brier: brier(answered.probability, question.outcome),
          overconfident: overconfident(answered.probability, question.outcome),
          evidence: scored.evidence,
          uncertainty: scored.uncertainty,
        });
        console.log(`${question.id} ${group}#${run} p=${answered.probability}`);
      }
    }
  }
  const perQuestion = used.map((question) => {
    const side = (group: "A" | "B") => {
      const mine = rows.filter((row) => row.id === question.id && row.group === group);
      return { probability: round(mean(mine.map((row) => row.probability))), brier: round(mean(mine.map((row) => row.brier))) };
    };
    return { id: question.id, person: question.person, outcome: question.outcome_status, leaked: false, prior_empty: emptyPrior.has(question.id), A: side("A"), B: side("B") };
  });
  const report = {
    note: strict
      ? "037：B 组用严格时点先验（只含说话当天之前入库的判定、证据、延迟系数和一致性对照）。证据分按 0–2 解析，非法值不计入均值。旧版 report-v2.json 的证据分被截在 0–1、B 组拿的是回溯先验，和本报告不能直接比较。"
      : "019 还没做，没有 C 组。评分和作答是同一个方舟接入点，没有另一把密钥。",
    prior_mode: strict ? "strict" : "retrospective",
    people: new Set(used.map((row) => row.person_id)).size,
    prior_empty: emptyPrior.size,
    probes: probes.map((row) => ({ id: row.id, person: row.person, outcome_status: row.outcome_status, happened: row.happened, leaked: row.leaked, detail: row.detail })),
    summary: summarize(rows),
    brier_diff_95: bootstrapDiff(perQuestion.flatMap((row) => (row.A.brier != null && row.B.brier != null ? [{ a: row.A.brier, b: row.B.brier }] : []))),
    perQuestion,
  };
  const out = join(dirname(fileURLToPath(import.meta.url)), `../../../data/eval/downstream/${strict ? "report-v3.json" : "report-v2.json"}`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log("\n泄露检测");
  for (const row of report.probes) console.log(`${row.id} ${row.person} 真实${row.outcome_status} 模型${row.happened} ${row.leaked ? "泄露" : "未泄露"}`);
  console.log("\n无泄露题");
  console.log(`A Brier ${report.summary.A.brier} 证据 ${report.summary.A.evidence} 过度自信 ${report.summary.A.overconfident}`);
  console.log(`B Brier ${report.summary.B.brier} 证据 ${report.summary.B.evidence} 过度自信 ${report.summary.B.overconfident}`);
  console.log(`B−A Brier ${JSON.stringify(report.brier_diff_95)}；先验样本不足 ${report.prior_empty}/${used.length} 题`);
  for (const row of report.perQuestion) console.log(`${row.id} ${row.person} ${row.outcome} A ${row.A.probability}/${row.A.brier} B ${row.B.probability}/${row.B.brier}`);
}

async function main() {
  await migrate();
  const questions = loadQuestions();
  const rows: {
    id: string;
    bucket: string;
    person: string;
    group: "A" | "B";
    run: number;
    probability: number;
    reason: string;
    brier: number;
    overconfident: boolean;
    evidence: number | null;
    uncertainty: number;
  }[] = [];

  for (const question of questions) {
    const prior = await priorJson(question);
    for (const group of ["A", "B"] as const) {
      for (let run = 1; run <= RUNS; run += 1) {
        const answered = await answerOnce(question, group, run, prior);
        const key = createHash("sha256").update(`${question.id}:${group}:${run}:${answered.reason}`).digest("hex").slice(0, 12);
        const scored = await scoreOnce(question, answered, key);
        rows.push({
          id: question.id,
          bucket: question.bucket,
          person: question.person,
          group,
          run,
          probability: answered.probability,
          reason: answered.reason,
          brier: brier(answered.probability, question.outcome),
          overconfident: overconfident(answered.probability, question.outcome),
          evidence: scored.evidence,
          uncertainty: scored.uncertainty,
        });
        console.log(`${question.id} ${group}#${run} p=${answered.probability} brier=${round(brier(answered.probability, question.outcome))}`);
      }
    }
  }

  const byGroup = (group: "A" | "B") => rows.filter((row) => row.group === group);
  const summary = (group: "A" | "B") => ({
    brier: round(mean(byGroup(group).map((row) => row.brier))),
    evidence: round(mean(byGroup(group).flatMap((row) => (row.evidence == null ? [] : [row.evidence])))),
    uncertainty: round(mean(byGroup(group).map((row) => row.uncertainty))),
    overconfident: byGroup(group).filter((row) => row.overconfident).length,
  });
  const perQuestion = questions.map((question) => {
    const side = (group: "A" | "B") => {
      const mine = rows.filter((row) => row.id === question.id && row.group === group);
      return { probability: round(mean(mine.map((row) => row.probability))), brier: round(mean(mine.map((row) => row.brier))) };
    };
    return { id: question.id, bucket: question.bucket, outcome: question.outcome_status, A: side("A"), B: side("B") };
  });

  const report = { summary: { A: summary("A"), B: summary("B") }, perQuestion, rows };
  const out = join(dirname(fileURLToPath(import.meta.url)), "../../../data/eval/downstream/last-run.json");
  writeFileSync(out, JSON.stringify(report, null, 2));

  console.log("\n均值");
  console.log(`A 不给先验  Brier ${report.summary.A.brier}  证据 ${report.summary.A.evidence}  不确定性 ${report.summary.A.uncertainty}  过度自信 ${report.summary.A.overconfident}`);
  console.log(`B 给先验    Brier ${report.summary.B.brier}  证据 ${report.summary.B.evidence}  不确定性 ${report.summary.B.uncertainty}  过度自信 ${report.summary.B.overconfident}`);
  console.log("\n逐题（3 次平均概率 / Brier）");
  for (const row of perQuestion) console.log(`${row.id} ${row.bucket} 真实${row.outcome}  A ${row.A.probability}/${row.A.brier}  B ${row.B.probability}/${row.B.brier}`);

  const picks = [...rows].sort((a, b) => createHash("sha256").update(a.reason).digest("hex").localeCompare(createHash("sha256").update(b.reason).digest("hex")));
  const sparseB = rows.find((row) => row.bucket === "sparse" && row.group === "B" && row.run === 1);
  const richA = rows.find((row) => row.id === "q03" && row.group === "A" && row.run === 1);
  const interestB = rows.find((row) => row.id === "q06" && row.group === "B" && row.run === 1);
  console.log("\n片段");
  for (const row of [richA, sparseB, interestB, picks[0]].filter(Boolean)) {
    if (!row) continue;
    console.log(`- ${row.id} ${row.group}#${row.run}：${snippet(row.reason)}`);
  }
}

if (import.meta.main) {
  const entry = process.argv.includes("--v3") ? () => mainV2(true) : process.argv.includes("--v2") ? () => mainV2() : main;
  entry()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await sql.end();
    });
}
