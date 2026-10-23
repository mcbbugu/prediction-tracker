// bun --env-file=.env run src/tools/eval.ts [--check]
// 用人工种子当金标准，对照库里已经收录的主张。有缓存的模型调用不在这里重跑。
// --check：核心指标比上一版低超过 2 个百分点就以非 0 退出，不把退步写进历史。
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { normalize, quoteOnPage } from "../evidence/sources";
import { cohenKappa, wilson } from "../scoring/calibration";

export const PIPELINE_VERSION = "EXTRACT_V1+JUDGE_V1+CROSS_V1+STRUCTURE_V1+resolver-v1";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const evalDir = join(root, "data/eval");
const CORE = ["discovery_recall", "extraction_precision", "verdict_agreement"] as const;

type GoldClaim = {
  person_id: string;
  claim_id: string;
  quote_zh: string;
  quote_en: string;
  deadline: string;
  status: string;
};

type Metrics = {
  pipeline: string;
  date: string;
  discovery_recall: number | null;
  extraction_precision: number | null;
  verdict_agreement: number | null;
  verdict_wilson_low: number | null;
  kappa: number | null;
  deterministic_share: number | null;
  searches_per_claim: number | null;
  seconds_per_claim: number | null;
  gold_discovery: number;
  gold_verdicts: number;
};

export function sameQuote(gold: string, stored: string) {
  const left = gold.trim();
  const right = stored.trim();
  if (left.length < 15 || right.length < 15) return false;
  if (quoteOnPage(left, right) || quoteOnPage(right, left)) return true;
  const a = normalize(left);
  const b = normalize(right);
  return a.slice(0, 40).length >= 20 && (b.includes(a.slice(0, 40)) || a.includes(b.slice(0, 40)));
}

export function regressed(previous: Partial<Metrics> | null, next: Metrics, margin = 0.02) {
  if (!previous) return [];
  return CORE.filter((key) => {
    const before = previous[key];
    const after = next[key];
    return typeof before === "number" && typeof after === "number" && after < before - margin;
  });
}

function loadGold(): GoldClaim[] {
  const dir = join(root, "data/people");
  const claims: GoldClaim[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const person = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      id: string;
      predictions?: {
        id: string;
        quote: { zh: string; en: string };
        deadline: string;
        status: string;
      }[];
    };
    for (const claim of person.predictions ?? []) {
      claims.push({
        person_id: person.id,
        claim_id: claim.id,
        quote_zh: claim.quote.zh,
        quote_en: claim.quote.en,
        deadline: claim.deadline,
        status: claim.status,
      });
    }
  }
  return claims;
}

function writeGold(claims: GoldClaim[]) {
  mkdirSync(evalDir, { recursive: true });
  const discovery = claims.map((claim) => JSON.stringify({ person_id: claim.person_id, claim_id: claim.claim_id, quote_zh: claim.quote_zh, quote_en: claim.quote_en, deadline: claim.deadline }));
  const verdicts = claims.filter((claim) => claim.status && claim.status !== "待定").map((claim) => JSON.stringify({ person_id: claim.person_id, claim_id: claim.claim_id, status: claim.status }));
  writeFileSync(join(evalDir, "discovery.jsonl"), `${discovery.join("\n")}\n`);
  writeFileSync(join(evalDir, "verdicts.jsonl"), `${verdicts.join("\n")}\n`);
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function readHistory(): Metrics[] {
  const file = join(evalDir, "history.jsonl");
  try {
    return readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as Metrics);
  } catch {
    return [];
  }
}

async function measure(gold: GoldClaim[]): Promise<Metrics> {
  const people = [...new Set(gold.map((claim) => claim.person_id))];
  const stored = await sql<{ person_id: string; id: string; quote_zh: string; quote_en: string; quote_original: string; status: string; provenance: string }[]>`
    SELECT person_id, id, quote_zh, quote_en, quote_original, status, provenance
    FROM claims
    WHERE publication = 'published' AND person_id IN ${sql(people)}
  `;
  const found = gold.filter((claim) =>
    stored.some((row) => row.person_id === claim.person_id && [row.quote_zh, row.quote_en, row.quote_original].some((quote) => sameQuote(claim.quote_zh, quote) || sameQuote(claim.quote_en, quote))),
  );
  const extracted = stored.filter((row) => row.provenance === "agent");
  const truePositives = extracted.filter((row) =>
    gold.some((claim) => claim.person_id === row.person_id && [row.quote_zh, row.quote_en, row.quote_original].some((quote) => sameQuote(claim.quote_zh, quote) || sameQuote(claim.quote_en, quote))),
  );
  const pairs = gold.flatMap((claim) => {
    const row = stored.find((item) => item.id === claim.claim_id);
    if (!row || !claim.status || claim.status === "待定") return [];
    return [{ model: row.status, human: claim.status }];
  });
  const agreed = pairs.filter((pair) => pair.model === pair.human).length;
  const interval = wilson(agreed, pairs.length);
  const [propositions] = await sql<{ deterministic: number; total: number }[]>`
    SELECT count(*) FILTER (WHERE resolver <> 'model')::int AS deterministic, count(*)::int AS total
    FROM propositions WHERE superseded_by IS NULL
  `;
  const [cost] = await sql<{ searches: number; claims: number; seconds: number }[]>`
    SELECT coalesce(sum((result->>'search_count')::float), 0) AS searches,
           coalesce(sum((result->>'claims_found')::float), 0) AS claims,
           coalesce(sum((result->>'elapsed_ms')::float) / 1000, 0) AS seconds
    FROM jobs
    WHERE kind = 'analyze_person' AND state = 'done' AND result ? 'search_count'
  `;
  const round = (value: number | null) => (value == null ? null : Math.round(value * 1000) / 1000);
  return {
    pipeline: PIPELINE_VERSION,
    date: shanghaiDate(),
    discovery_recall: round(gold.length ? found.length / gold.length : null),
    extraction_precision: round(extracted.length ? truePositives.length / extracted.length : null),
    verdict_agreement: round(pairs.length ? agreed / pairs.length : null),
    verdict_wilson_low: round(pairs.length ? interval.low : null),
    kappa: round(cohenKappa(pairs)),
    deterministic_share: round(propositions?.total ? propositions.deterministic / propositions.total : null),
    searches_per_claim: round(cost?.claims ? cost.searches / cost.claims : null),
    seconds_per_claim: round(cost?.claims ? cost.seconds / cost.claims : null),
    gold_discovery: gold.length,
    gold_verdicts: pairs.length,
  };
}

async function main() {
  await migrate();
  const check = process.argv.includes("--check");
  const gold = loadGold();
  writeGold(gold);
  const metrics = await measure(gold);
  const history = readHistory();
  const baseline = history.at(-1) ?? null;
  const worse = regressed(baseline, metrics);
  console.log(JSON.stringify(metrics, null, 2));
  if (check && worse.length) {
    console.error(`退步：${worse.join("、")} 比上一版低超过 2 个百分点`);
    process.exitCode = 1;
    return;
  }
  const same = baseline && CORE.every((key) => baseline[key] === metrics[key]) && baseline.pipeline === metrics.pipeline && baseline.date === metrics.date;
  if (!same) {
    appendFileSync(join(evalDir, "history.jsonl"), `${JSON.stringify(metrics)}\n`);
    console.log(check ? "没有退步，已写入历史" : "已写入 data/eval/history.jsonl");
  } else {
    console.log("与最近一条相同，不重复写入");
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
