// bun --env-file=.env run src/tools/downstream-eval.ts
// 同一模型答 10 题：A 不给先验，B 附上说话当天的 /v1/prior。每题每组 3 次。
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
const RUNS = 3;

const ANSWER_PROMPT = [
  "你在估计一件已经公开的说法会不会按时发生。",
  "只根据给你的材料。没有的事实不要编。",
  "材料很少时，直接写样本不足，概率放在 0.5 附近。",
  '只输出 JSON：{"probability":0.5,"reason":""}。probability 是 0 到 1。',
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

async function priorJson(question: Question) {
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3011}/v1/prior?person=${encodeURIComponent(question.person_id)}&as_of=${question.as_of}`);
    if (response.ok) return await response.text();
  } catch {
    // The API process may be down. The same function it serves is the fallback.
  }
  return JSON.stringify(await priorAsOf({ person: question.person_id, as_of: question.as_of }));
}

async function answerOnce(question: Question, group: "A" | "B", run: number, prior: string) {
  const body = [`题目 ${question.id}`, `运行 ${run}`, question.question];
  if (group === "B") body.push("下面是说话当天可查到的先验，JSON 原样附上，不要把它当成后来才知道的结果。", prior);
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
  const evidence = clampProbability(raw.evidence);
  const uncertainty = raw.uncertainty === 1 || raw.uncertainty === true ? 1 : 0;
  return { evidence: evidence == null ? 0 : Math.min(2, evidence), uncertainty };
}

function snippet(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 180);
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
    evidence: number;
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
    evidence: round(mean(byGroup(group).map((row) => row.evidence))),
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
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await sql.end();
    });
}
