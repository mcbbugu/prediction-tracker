// 评测 consult 的自然语言解析。逐条 POST /v1/consult，比对 parsed 里的人物和领域。
// 用法：cd api && bun run src/tools/eval-consult.ts [--limit=10]
// expect_domain 为 null 时不检查领域。人物期望为 null 时，解析出任何人算错。

const ENDPOINT = "http://localhost:3011/v1/consult";
const GAP_MS = 2000;
const RETRIES = 2;
const TIMEOUT_MS = 180_000;

type ConsultCase = {
  query: string;
  expect_person: string | null;
  expect_domain: string | null;
};

type Parsed = {
  person_id: string | null;
  domain: string | null;
  deadline: string | null;
  claim: string | null;
};

type EvalRow = {
  person_id?: string;
  domain?: string;
};

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const casesPath = new URL("../../evals/consult-cases.json", import.meta.url);
const allCases = (await Bun.file(casesPath).json()) as ConsultCase[];

for (const [index, item] of allCases.entries()) {
  if (typeof item.query !== "string" || !item.query.trim()) throw new Error(`第 ${index + 1} 条缺少 query`);
  if (item.expect_person !== null && typeof item.expect_person !== "string") throw new Error(`第 ${index + 1} 条 expect_person 无效`);
  if (item.expect_domain !== null && typeof item.expect_domain !== "string") throw new Error(`第 ${index + 1} 条 expect_domain 无效`);
}

const limitArg = arg("limit");
const limit = limitArg === undefined ? allCases.length : Number(limitArg);
if (!Number.isInteger(limit) || limit < 1) {
  console.error("--limit 需要是正整数");
  process.exit(1);
}
const cases = allCases.slice(0, limit);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEADLINE_CUE = /明年|三年内|明年底|年底|到\s*20\d{2}|20\d{2}\s*年|by 20\d{2}|within three years|through 20\d{2}/i;

function personFault(expect: string | null, got: string | null) {
  if (got === expect) return null;
  if (expect === null && got) return `该 null 却选了人（${got}）`;
  if (expect && got) return `认错人（期望 ${expect}，得到 ${got}）`;
  return `没认出人（期望 ${expect}）`;
}

function domainFault(expect: string | null, got: string | null) {
  if (expect === null || got === expect) return null;
  if (!got) return `领域选错（期望 ${expect}，没有选出领域）`;
  return `领域选错（期望 ${expect}，得到 ${got}）`;
}

async function consult(query: string): Promise<{ parsed: Parsed | null; picked: EvalRow | null }> {
  let lastError = "未知错误";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = 4000 * attempt;
      console.log(`  请求失败，${wait / 1000}s 后重试 ${attempt}/${RETRIES}（${lastError}）`);
      await sleep(wait);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const body = (await response.json()) as { parsed?: Parsed | null; evaluations?: EvalRow[] };
      const parsed = body.parsed
        ? {
            person_id: body.parsed.person_id ?? null,
            domain: body.parsed.domain ?? null,
            deadline: body.parsed.deadline ?? null,
            claim: body.parsed.claim ?? null,
          }
        : null;
      return { parsed, picked: body.evaluations?.[0] ?? null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}

type Outcome = {
  index: number;
  item: ConsultCase;
  parsed: Parsed | null;
  picked: EvalRow | null;
  personOk: boolean;
  domainOk: boolean | null;
  faults: string[];
  deadline: string | null;
  requestError?: string;
};

const outcomes: Outcome[] = [];

console.log(`consult 解析评测 · ${cases.length}/${allCases.length} 条 · ${ENDPOINT}`);

for (let index = 0; index < cases.length; index++) {
  const item = cases[index]!;
  const label = `${String(index + 1).padStart(2, "0")}/${String(cases.length).padStart(2, "0")}`;
  let outcome: Outcome;
  try {
    const { parsed, picked } = await consult(item.query);
    const gotPerson = parsed?.person_id ?? null;
    const gotDomain = parsed?.domain ?? null;
    const faults = [personFault(item.expect_person, gotPerson), domainFault(item.expect_domain, gotDomain)].filter(
      (fault): fault is string => Boolean(fault),
    );
    outcome = {
      index,
      item,
      parsed,
      picked,
      personOk: gotPerson === item.expect_person,
      domainOk: item.expect_domain === null ? null : gotDomain === item.expect_domain,
      faults,
      deadline: parsed?.deadline ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome = {
      index,
      item,
      parsed: null,
      picked: null,
      personOk: false,
      domainOk: item.expect_domain === null ? null : false,
      faults: [`请求失败（${message}）`],
      deadline: null,
      requestError: message,
    };
  }
  outcomes.push(outcome);

  const personMark = outcome.personOk ? "人物✓" : "人物✗";
  const domainMark = outcome.domainOk === null ? "领域—" : outcome.domainOk ? "领域✓" : "领域✗";
  const deadlineMark = outcome.deadline ? `期限 ${outcome.deadline}` : "期限 —";
  console.log(`${label} ${personMark} ${domainMark} ${deadlineMark}`);
  console.log(`  问：${item.query}`);
  console.log(
    `  期望 ${item.expect_person ?? "null"} / ${item.expect_domain ?? "（不检查）"} → 解析 ${outcome.parsed?.person_id ?? "null"} / ${outcome.parsed?.domain ?? "null"}`,
  );
  if (outcome.parsed?.claim) console.log(`  说法：${outcome.parsed.claim}`);
  if (outcome.faults.length) console.log(`  错在：${outcome.faults.join("；")}`);
  if (outcome.parsed?.person_id == null && outcome.picked?.person_id) {
    console.log(`  附注：解析没有人物，关键词回退选了 ${outcome.picked.person_id} / ${outcome.picked.domain ?? "未分类"}`);
  }
  if (index < cases.length - 1) await sleep(GAP_MS);
}

const personHit = outcomes.filter((row) => row.personOk).length;
const domainRows = outcomes.filter((row) => row.domainOk !== null);
const domainHit = domainRows.filter((row) => row.domainOk).length;
const bothRows = outcomes.filter((row) => row.domainOk !== null);
const bothHit = bothRows.filter((row) => row.personOk && row.domainOk).length;
const deadlineHit = outcomes.filter((row) => row.deadline && /^\d{4}-\d{2}-\d{2}$/.test(row.deadline)).length;
const deadlineMiss = outcomes.filter((row) => DEADLINE_CUE.test(row.item.query) && !row.deadline);
const inCatalog = outcomes.filter((row) => row.item.expect_person !== null && row.domainOk !== null);
const inCatalogHit = inCatalog.filter((row) => row.personOk && row.domainOk).length;
const pct = (hit: number, total: number) => (total === 0 ? "—" : `${((hit / total) * 100).toFixed(1)}%`);

console.log("\n汇总");
console.log(`人物识别：${personHit}/${outcomes.length}（${pct(personHit, outcomes.length)}）`);
console.log(`领域识别：${domainHit}/${domainRows.length}（${pct(domainHit, domainRows.length)}）${domainRows.length === outcomes.length ? "" : `，另有 ${outcomes.length - domainRows.length} 条不检查领域`}`);
console.log(`人物和领域都对：${bothHit}/${bothRows.length}（${pct(bothHit, bothRows.length)}）`);
console.log(`库内说话人（期望人物非空）人物和领域都对：${inCatalogHit}/${inCatalog.length}（${pct(inCatalogHit, inCatalog.length)}）`);
console.log(`期限解析出来：${deadlineHit}/${outcomes.length}`);
if (deadlineMiss.length) {
  console.log(`句子里有期限说法但没解析出日期：${deadlineMiss.map((row) => row.index + 1).join("、")}`);
}

const wrong = outcomes.filter((row) => row.faults.length);
console.log(`\n错例 ${wrong.length} 条`);
if (!wrong.length) {
  console.log("没有错例。");
} else {
  for (const row of wrong) {
    console.log(`${String(row.index + 1).padStart(2, "0")} ${row.faults.join("；")}`);
    console.log(`  ${row.item.query}`);
  }
}
