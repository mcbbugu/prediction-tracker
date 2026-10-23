// bun --env-file=.env run src/claims/structure.ts -- [--apply]
// 把已有主张写成命题。默认只统计还没写的条数；--apply 才调用模型并写入。
// 不改已有判定。确定性判定器和已有判定不一致时只打印。
import { ArkStopped, arkJson, takeModelCallId } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { orgKey } from "../interests/orgs";
import { COMPARATORS, RESOLVERS, type Comparator, type ResolverName } from "../scoring/resolvers/compare";
import { resolveProposition, stooqSymbol } from "../scoring/resolvers";
import { JUDGED } from "./verdict";

const apply = process.argv.includes("--apply");
export const STRUCTURE_V1 = "STRUCTURE_V1";
export const SPEC_VERSION = "v1";

const STRUCTURE_PROMPT = [
  "把这句带截止日的预测写成一条可机器判定的命题。只能依据原话，不要补充原话里没有的数字。",
  "resolver 只能是 sec_xbrl、price、model。",
  "sec_xbrl：原话在比较一家上市公司的营收、利润或用户数，而且给出了数字门槛。field 用 revenue_usd、net_income 或 users。org_key 用机构英文名的小写短横线形式，如 tesla、nvidia。",
  "price：原话在比较股价或市值，而且给出了数字门槛。field 用 close 或 market_cap。symbol 用 Stooq 日线代码，美股一般是 tsla.us 这种小写。",
  "其余全部用 model，只填 subject 和 deadline，comparator 留空，threshold 留空。",
  "comparator 只能是 >=、<=、=、exists_by。threshold 是原话里的数字，按原单位换算成 unit 所示的数（美元不要带缩写，10 亿美元写成 10000000000）。",
  "deadline 沿用给出的截止日，格式 YYYY-MM-DD。",
  '输出 JSON：{"subject":"","metric":"","comparator":">=","threshold":null,"unit":"","deadline":"","resolver":"model","org_key":"","field":"","symbol":""}',
].join("\n");

export type PropositionDraft = {
  claim_id: string;
  subject: string;
  metric: string;
  comparator: Comparator | null;
  threshold: number | null;
  unit: string;
  deadline: string | null;
  resolver: ResolverName;
  resolver_args: { org_key?: string; field?: string; symbol?: string };
  spec_version: string;
  model_call_id: string | null;
};

type Raw = {
  subject?: string;
  metric?: string;
  comparator?: string;
  threshold?: number | null;
  unit?: string;
  deadline?: string;
  resolver?: string;
  org_key?: string;
  field?: string;
  symbol?: string;
};

export function normalizeProposition(claim: { id: string; deadline: string }, raw: Raw, modelCallId: string | null): PropositionDraft {
  const resolver = RESOLVERS.includes(raw.resolver as ResolverName) ? (raw.resolver as ResolverName) : "model";
  const comparator = COMPARATORS.includes(raw.comparator as Comparator) ? (raw.comparator as Comparator) : null;
  const threshold = typeof raw.threshold === "number" && Number.isFinite(raw.threshold) ? raw.threshold : null;
  const org = orgKey((raw.org_key || raw.subject || "").trim());
  const usable = resolver !== "model" && comparator && (comparator === "exists_by" || threshold != null);
  const chosen: ResolverName = usable ? resolver : "model";
  return {
    claim_id: claim.id,
    subject: (raw.subject || "").trim(),
    metric: chosen === "model" ? "" : (raw.metric || "").trim(),
    comparator: chosen === "model" ? null : comparator,
    threshold: chosen === "model" ? null : threshold,
    unit: chosen === "model" ? "" : (raw.unit || "").trim(),
    deadline: claim.deadline,
    resolver: chosen,
    resolver_args: chosen === "sec_xbrl" ? { org_key: org, field: (raw.field || "revenue_usd").trim() } : chosen === "price" ? { symbol: (raw.symbol || "").trim().toLowerCase(), field: (raw.field || "close").trim() } : {},
    spec_version: SPEC_VERSION,
    model_call_id: modelCallId,
  };
}

async function fillSymbol(draft: PropositionDraft) {
  if (draft.resolver !== "price" || draft.resolver_args.symbol) return draft;
  const symbol = await stooqSymbol(draft.resolver_args.org_key || orgKey(draft.subject));
  if (symbol) draft.resolver_args.symbol = symbol;
  return draft;
}

export async function structureClaim(claim: { id: string; quote_zh: string; quote_en: string; deadline: string; name_en?: string }) {
  const live = await sql<{ id: number }[]>`
    SELECT id::int AS id FROM propositions WHERE claim_id = ${claim.id} AND superseded_by IS NULL LIMIT 1
  `;
  if (live.length) return live[0].id;
  const answer = (await arkJson(
    STRUCTURE_PROMPT,
    JSON.stringify({
      speaker: claim.name_en ?? "",
      quote_zh: claim.quote_zh,
      quote_en: claim.quote_en,
      deadline: claim.deadline,
    }),
    800,
    STRUCTURE_V1,
  )) as Raw;
  const draft = await fillSymbol(normalizeProposition(claim, answer, takeModelCallId(answer)));
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO propositions (
      claim_id, subject, metric, comparator, threshold, unit, deadline, resolver, resolver_args, spec_version, model_call_id
    ) VALUES (
      ${draft.claim_id}, ${draft.subject}, ${draft.metric}, ${draft.comparator}, ${draft.threshold}, ${draft.unit},
      ${draft.deadline}, ${draft.resolver}, ${sql.json(draft.resolver_args)}, ${draft.spec_version}, ${draft.model_call_id}
    )
    RETURNING id::int AS id
  `;
  return row.id;
}

type ClaimRow = {
  id: string;
  person_id: string;
  name_en: string;
  quote_zh: string;
  quote_en: string;
  deadline: string;
  status: string;
};

async function conflicts() {
  const rows = await sql<{ claim_id: string; status: string; resolver: string; comparator: string | null; threshold: number | null; deadline: string | null; resolver_args: LiveArgs }[]>`
    SELECT p.claim_id, c.status, p.resolver, p.comparator, p.threshold::float8 AS threshold,
           to_char(p.deadline, 'YYYY-MM-DD') AS deadline, p.resolver_args
    FROM propositions p
    JOIN claims c ON c.id = p.claim_id
    WHERE p.superseded_by IS NULL AND p.resolver IN ('sec_xbrl', 'price') AND c.status IN ('已兑现', '部分兑现', '未兑现')
  `;
  const found: { claim_id: string; status: string; resolved: string; detail: string }[] = [];
  for (const row of rows) {
    const resolution = await resolveProposition(
      {
        resolver: row.resolver,
        comparator: row.comparator,
        threshold: row.threshold,
        deadline: row.deadline,
        resolver_args: row.resolver_args ?? {},
      },
      { fetch: row.resolver === "price" },
    );
    if (!resolution || !JUDGED.has(resolution.status) || resolution.status === row.status) continue;
    found.push({ claim_id: row.claim_id, status: row.status, resolved: resolution.status, detail: resolution.detail });
  }
  return found;
}

type LiveArgs = { org_key?: string; field?: string; symbol?: string };

async function main() {
  await migrate();
  const pending = await sql<ClaimRow[]>`
    SELECT c.id, c.person_id, p.name_en, c.quote_zh, c.quote_en, to_char(c.deadline, 'YYYY-MM-DD') AS deadline, c.status
    FROM claims c
    JOIN people p ON p.id = c.person_id
    WHERE c.publication = 'published'
      AND NOT EXISTS (SELECT 1 FROM propositions q WHERE q.claim_id = c.id AND q.superseded_by IS NULL)
    ORDER BY c.person_id, c.id
  `;
  console.log(`还没有命题的主张 ${pending.length} 条 · ${apply ? "写入" : "试运行（加 --apply 才调用模型）"}`);
  if (apply) {
    for (const [index, claim] of pending.entries()) {
      try {
        const id = await structureClaim(claim);
        console.log(`${index + 1}/${pending.length} propositions#${id} ${claim.id}`);
      } catch (error) {
        console.error(`${claim.id} 结构化失败：${error instanceof Error ? error.message.slice(0, 200) : error}`);
        if (error instanceof ArkStopped) break;
      }
    }
  }
  const tally = await sql<{ resolver: string; n: number }[]>`
    SELECT resolver, count(*)::int AS n FROM propositions WHERE superseded_by IS NULL GROUP BY resolver ORDER BY resolver
  `;
  const total = tally.reduce((sum, row) => sum + row.n, 0);
  console.log(`命题 ${total} 条`);
  for (const row of tally) console.log(`  ${row.resolver} ${row.n}（${total ? Math.round((row.n / total) * 1000) / 10 : 0}%）`);
  const mismatched = await conflicts();
  console.log(`和已有判定冲突 ${mismatched.length} 条（不改判定）`);
  for (const row of mismatched) console.log(`  ${row.claim_id} 库里 ${row.status}，判定器 ${row.resolved} · ${row.detail}`);
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
