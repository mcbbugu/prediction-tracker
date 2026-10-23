// bun --env-file=.env run src/tools/backfill-quote-zh.ts [--apply]
// 给公开主张里没有中文的 quote_zh 补译文。不改 quote_en / quote_original。默认只打印。
import { sql } from "../core/db";
import { migrate, logEvent } from "../core/migrate";
import { hasChinese, translateToChinese } from "../claims/discover";

const apply = process.argv.includes("--apply");
const BATCH = 8;

async function main() {
  await migrate();
  const rows = await sql<{ id: string; person_id: string; quote_en: string; quote_original: string; quote_zh: string }[]>`
    SELECT id, person_id, quote_en, quote_original, quote_zh
    FROM claims
    WHERE publication = 'published'
      AND (quote_zh IS NULL OR btrim(quote_zh) = '' OR quote_zh !~ '[一-龥]')
    ORDER BY id
  `;
  console.log(apply ? `写入 ${rows.length} 条中文` : `试运行，${rows.length} 条没有中文`);
  let written = 0;
  for (let index = 0; index < rows.length; index += BATCH) {
    const batch = rows.slice(index, index + BATCH);
    const sources = batch.map((row) => (row.quote_original || row.quote_en || "").trim());
    const translated = await translateToChinese(sources);
    for (const [offset, row] of batch.entries()) {
      const zh = translated[offset] ?? "";
      if (!hasChinese(zh)) {
        console.log(`跳过 ${row.id}：译文里没有中文`);
        continue;
      }
      console.log(`${row.id}\t${zh.slice(0, 42)}`);
      if (!apply) continue;
      await sql`UPDATE claims SET quote_zh = ${zh} WHERE id = ${row.id}`;
      await logEvent({
        claim_id: row.id,
        person_id: row.person_id,
        action: "quote_zh_filled",
        actor: "backfill",
        before: { quote_zh: row.quote_zh },
        after: { quote_zh: zh },
        note: "补中文译文，原文未改",
      });
      written += 1;
    }
  }
  if (apply) console.log(`已写入 ${written} 条`);
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
