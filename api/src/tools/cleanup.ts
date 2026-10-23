// bun --env-file=.env run src/tools/cleanup.ts [--apply]
// 默认试运行，只打印。加 --apply 才写库：撤回重复主张、把单位丢失的金额置空，并给受影响的人物重算分数。
// 不删行。可疑期限（截止日期早于说话日，或出处是网站首页）只列出，留给人工处理。
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { isHomepage } from "../evidence/sources";
import { recomputeScores } from "../scoring/score";

const apply = process.argv.includes("--apply");

// 和数据体检同一套口径：规范化后至少 36 字才算完全相同；至少 48 字，
// 并且较短的被较长的包含（长度比 ≥ 0.75），或 trigram Dice ≥ 0.9 且 80% 实词相同，才算几乎相同。
const EXACT_MIN = 36;
const FUZZY_MIN = 48;
const DICE_MIN = 0.9;
const SUBSTRING_RATIO = 0.75;

type Claim = {
  id: string;
  person_id: string;
  person_name: string;
  publication: string;
  quote_en: string;
  quote_original: string;
  source_url: string;
  published_date: string;
  deadline: string;
  thread_id: string | null;
  created_at: Date;
  evidence_urls: number;
};

type Exposure = {
  id: number;
  org_key: string;
  dimension: string;
  target: string;
  metric_value: number;
  metric_year: number | null;
  publication: string;
  quote: string;
};

function normWords(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasHan(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

function dice(a: string, b: string) {
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 2; i++) {
    const gram = a.slice(i, i + 3);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let inter = 0;
  const used = new Map<string, number>();
  for (let i = 0; i < b.length - 2; i++) {
    const gram = b.slice(i, i + 3);
    const seen = used.get(gram) ?? 0;
    if (seen < (counts.get(gram) ?? 0)) {
      inter++;
      used.set(gram, seen + 1);
    }
  }
  return (2 * inter) / (a.length - 2 + (b.length - 2));
}

function wordAgrees(shorter: string, longer: string) {
  const words = shorter.split(" ").filter((word) => word.length >= 4);
  if (words.length < 4) return hasHan(shorter);
  const bag = new Set(longer.split(" "));
  const hit = words.filter((word) => bag.has(word)).length;
  return hit / words.length >= 0.8;
}

function nearlySame(a: string, b: string) {
  if (a === b || a.length < FUZZY_MIN || b.length < FUZZY_MIN) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const ratio = shorter.length / longer.length;
  if (longer.includes(shorter) && ratio >= SUBSTRING_RATIO) return true;
  if (ratio < 0.65) return false;
  return dice(a, b) >= DICE_MIN && wordAgrees(shorter, longer);
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, index) => index);
  }
  find(index: number): number {
    let at = index;
    while (this.parent[at] !== at) {
      this.parent[at] = this.parent[this.parent[at]]!;
      at = this.parent[at]!;
    }
    return at;
  }
  union(a: number, b: number) {
    const pa = this.find(a);
    const pb = this.find(b);
    if (pa !== pb) this.parent[pa] = pb;
  }
}

function fieldNorms(claim: Claim) {
  const quoteEn = normWords(claim.quote_en);
  const quoteOriginal = normWords(claim.quote_original);
  const primary = quoteOriginal.length > quoteEn.length ? quoteOriginal : quoteEn;
  return { quote_en: quoteEn, quote_original: quoteOriginal, primary };
}

// Earlier row wins a tie. More archived evidence URLs wins outright.
function keeperOf(claims: Claim[]) {
  return claims.reduce((best, claim) => {
    if (claim.evidence_urls !== best.evidence_urls) return claim.evidence_urls > best.evidence_urls ? claim : best;
    if (claim.created_at.getTime() !== best.created_at.getTime()) return claim.created_at < best.created_at ? claim : best;
    return claim.id < best.id ? claim : best;
  });
}

function duplicateClusters(claims: Claim[]) {
  const byPerson = new Map<string, Claim[]>();
  for (const claim of claims) {
    const list = byPerson.get(claim.person_id) ?? [];
    list.push(claim);
    byPerson.set(claim.person_id, list);
  }
  const clusters: Claim[][] = [];
  for (const group of byPerson.values()) {
    const norms = group.map(fieldNorms);
    const uf = new UnionFind(group.length);
    for (const field of ["quote_en", "quote_original", "primary"] as const) {
      const buckets = new Map<string, number[]>();
      for (let index = 0; index < group.length; index++) {
        const key = norms[index]![field];
        if (key.length < EXACT_MIN) continue;
        const bucket = buckets.get(key) ?? [];
        bucket.push(index);
        buckets.set(key, bucket);
      }
      for (const indexes of buckets.values()) {
        for (let cursor = 1; cursor < indexes.length; cursor++) uf.union(indexes[0]!, indexes[cursor]!);
      }
    }
    for (let left = 0; left < group.length; left++) {
      for (let right = left + 1; right < group.length; right++) {
        const a = norms[left]!;
        const b = norms[right]!;
        if (nearlySame(a.quote_en, b.quote_en) || nearlySame(a.quote_original, b.quote_original)) uf.union(left, right);
      }
    }
    const members = new Map<number, Claim[]>();
    for (let index = 0; index < group.length; index++) {
      const root = uf.find(index);
      const list = members.get(root) ?? [];
      list.push(group[index]!);
      members.set(root, list);
    }
    for (const list of members.values()) if (list.length >= 2) clusters.push(list);
  }
  return clusters;
}

function siteHome(url: string) {
  try {
    new URL(url);
  } catch {
    return false;
  }
  return isHomepage(url);
}

function snippet(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 80 ? text : `${text.slice(0, 80)}…`;
}

await migrate();

const claims = await sql<Claim[]>`
  SELECT c.id, c.person_id, p.name AS person_name, c.publication,
         c.quote_en, c.quote_original, c.source_url,
         to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
         to_char(c.deadline, 'YYYY-MM-DD') AS deadline,
         c.thread_id, c.created_at,
         CASE WHEN jsonb_typeof(c.evidence) = 'array' THEN (
           SELECT count(*)::int FROM jsonb_array_elements(c.evidence) item
           WHERE coalesce(item->>'url', '') <> ''
         ) ELSE 0 END AS evidence_urls
  FROM claims c
  JOIN people p ON p.id = c.person_id
  WHERE c.publication <> 'withdrawn'
  ORDER BY c.person_id, c.created_at, c.id
`;

const exposures = await sql<Exposure[]>`
  SELECT id::int AS id, org_key, dimension, target,
         metric_value::float8 AS metric_value, metric_year, publication, quote
  FROM org_exposures
  WHERE basis = 'crawl' AND metric_kind = 'amount_usd' AND metric_value < 10000
  ORDER BY id
`;

const suspicious = claims.filter((claim) => claim.deadline < claim.published_date || siteHome(claim.source_url));
const clusters = duplicateClusters(claims);
const withdrawals = clusters.flatMap((cluster) => {
  const keep = keeperOf(cluster);
  return cluster.filter((claim) => claim.id !== keep.id).map((claim) => ({ claim, keep }));
});

console.log(apply ? "写入模式" : "试运行，不写库");
console.log(`重复主张 ${clusters.length} 组，将撤回 ${withdrawals.length} 条`);
for (const { claim, keep } of withdrawals) {
  const thread = claim.thread_id && claim.thread_id === keep.thread_id ? ` 同一改期串 ${claim.thread_id}` : "";
  console.log(
    `  撤回 ${claim.id}（${claim.person_name}，${claim.publication}，证据 ${claim.evidence_urls} 条）保留 ${keep.id}（证据 ${keep.evidence_urls} 条，录入 ${keep.created_at.toISOString()}）${thread}`,
  );
  console.log(`    ${snippet(claim.quote_original || claim.quote_en)}`);
}

console.log(`可疑期限 ${suspicious.length} 条（只列出，不修改）`);
for (const claim of suspicious) {
  const why = claim.deadline < claim.published_date ? `期限 ${claim.deadline} 早于说话日 ${claim.published_date}` : "出处是网站首页";
  console.log(`  ${claim.id} ${claim.person_name} ${claim.publication} ${why} ${claim.source_url}`);
}

console.log(`单位丢失的金额 ${exposures.length} 条（crawl、amount_usd、< 10000，置空数值和类型）`);
for (const row of exposures) {
  console.log(
    `  #${row.id} ${row.org_key} ${row.dimension}/${row.target} ${row.metric_value}（${row.metric_year ?? "无年份"}，${row.publication}） ${snippet(row.quote)}`,
  );
}

if (!apply) {
  console.log("未写库。确认后加 --apply。");
  await sql.end();
  process.exit(0);
}

const people = [...new Set(withdrawals.map((item) => item.claim.person_id))];
await sql.begin(async (tx) => {
  for (const { claim, keep } of withdrawals) {
    const updated = await tx<{ id: string }[]>`
      UPDATE claims SET publication = 'withdrawn'
      WHERE id = ${claim.id} AND publication <> 'withdrawn'
      RETURNING id
    `;
    if (!updated[0]) continue;
    await tx`
      INSERT INTO claim_events (claim_id, person_id, action, actor, before, after, note)
      VALUES (
        ${claim.id},
        ${claim.person_id},
        'duplicate_withdrawn',
        'cleanup',
        ${tx.json({ publication: claim.publication })},
        ${tx.json({ publication: "withdrawn" })},
        ${`与 ${keep.id} 原话重复，保留 ${keep.id}`}
      )
    `;
  }
  for (const row of exposures) {
    await tx`
      UPDATE org_exposures
      SET metric_kind = NULL, metric_value = NULL
      WHERE id = ${row.id} AND basis = 'crawl' AND metric_kind = 'amount_usd' AND metric_value < 10000
    `;
  }
});

for (const personId of people) {
  await recomputeScores(personId, { action: "duplicate_withdrawn" });
  console.log(`已重算 ${personId} 的分数`);
}
if (people.length === 0) console.log("没有主张被撤回，不重算分数");
console.log(`已撤回 ${withdrawals.length} 条主张，置空 ${exposures.length} 条敞口金额`);
await sql.end();
