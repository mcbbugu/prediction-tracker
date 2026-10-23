// bun --env-file=.env run src/tools/backfill-kind.ts [--apply]
// 给已有主张标承诺 / 预测。默认只打印，不写库。--apply 才写入并重算分数。
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { classifyByModel, classifyByRule, type ClaimKind, type OrgTie } from "../claims/kind";
import { recomputeScores } from "../scoring/score";

type Row = {
  id: string;
  person_id: string;
  name: string;
  name_en: string;
  quote_zh: string;
  said_on: string;
  subject: string | null;
};

function sample<T>(items: T[], n: number) {
  const copy = [...items];
  let seed = 22;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main() {
  await migrate();
  const apply = process.argv.includes("--apply");
  const rows = await sql<Row[]>`
    SELECT c.id, c.person_id, p.name, p.name_en, c.quote_zh,
           to_char(c.published_date, 'YYYY-MM-DD') AS said_on,
           pr.subject
    FROM claims c
    JOIN people p ON p.id = c.person_id
    LEFT JOIN propositions pr ON pr.claim_id = c.id AND pr.superseded_by IS NULL
    WHERE c.publication = 'published'
    ORDER BY c.id
  `;
  const orgRows = await sql<{ person_id: string; counterparty: string; counterparty_zh: string; org_key: string | null; started: string | null; ended: string | null; end_kind: string | null }[]>`
    SELECT person_id, counterparty, counterparty_zh, org_key, started, ended, end_kind
    FROM interests
    WHERE publication = 'published' AND superseded_at IS NULL AND kind IN ('role', 'holding')
  `;
  const orgs = new Map<string, OrgTie[]>();
  for (const row of orgRows) {
    const list = orgs.get(row.person_id) ?? [];
    list.push({
      name: row.counterparty,
      nameZh: row.counterparty_zh,
      orgKey: row.org_key ?? "",
      started: row.started,
      ended: row.ended,
      endKind: row.end_kind,
    });
    orgs.set(row.person_id, list);
  }

  const judged: { id: string; name: string; quote: string; kind: ClaimKind; reason: string }[] = [];
  for (const row of rows) {
    const ties = orgs.get(row.person_id) ?? [];
    const ruled = classifyByRule({
      subject: row.subject ?? "",
      quote: row.quote_zh,
      personName: row.name,
      personNameEn: row.name_en,
      orgs: ties,
      saidOn: row.said_on,
    });
    const result = ruled ?? (await classifyByModel({
      subject: row.subject ?? "",
      personName: row.name,
      quote: row.quote_zh,
      saidOn: row.said_on,
      orgs: ties,
    }));
    judged.push({ id: row.id, name: row.name, quote: row.quote_zh, ...result });
    if (apply) await sql`UPDATE claims SET kind = ${result.kind}, kind_reason = ${result.reason} WHERE id = ${row.id}`;
  }

  const count = (kind: ClaimKind) => judged.filter((row) => row.kind === kind).length;
  console.log(`公开主张 ${judged.length} 条：承诺 ${count("promise")}，预测 ${count("forecast")}，拿不准 ${count("uncertain")}`);
  console.log(apply ? "已写入" : "试运行，没有写入。加 --apply 才写入并重算分数。");
  for (const row of sample(judged, 20)) {
    console.log(`${row.kind}\t${row.name}\t${row.reason}\t${row.quote.replace(/\s+/g, " ").slice(0, 42)}`);
  }
  if (apply) {
    const people = [...new Set(rows.map((row) => row.person_id))];
    for (const personId of people) await recomputeScores(personId, { action: "kind_backfill" });
    console.log(`重算了 ${people.length} 个人的分数`);
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
