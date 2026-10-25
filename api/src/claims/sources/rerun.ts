// bun --env-file=.env run src/claims/sources/rerun.ts [id ...]（不给 id 就跑下面 12 人）
// 对 003 里主张为 0 的人再找一轮。陆奇也是 0 条，算上他一共 12 人。
// 先走申报、字幕、RSS，联网搜索每人最多 6 次。
import { supplementPerson } from "../discover";
import { sql } from "../../core/db";
import { migrate } from "../../core/migrate";

export const RERUN_IDS = [
  "paul-graham",
  "clement-delangue",
  "kevin-scott",
  "cathie-wood",
  "peter-diamandis",
  "fei-fei-li",
  "aidan-gomez",
  "noam-shazeer",
  "aravind-srinivas",
  "marc-andreessen",
  "marc-benioff",
  "qi-lu",
];

async function main() {
  await migrate();
  console.log("人物\t之前\t之后\t来源");
  const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  for (const id of ids.length ? ids : RERUN_IDS) {
    const result = await supplementPerson(id);
    const sources = result.runs.map((run) => `${run.source}:${run.documents}文档/${run.claims}主张/${run.searches}搜${run.detail ? `(${run.detail})` : ""}`).join(" ");
    console.log(`${result.name}\t${result.before}\t${result.after}\t${result.error ?? sources}`);
  }
  const rates = await sql<{ source: string; documents: number; claims: number; searches: number }[]>`
    SELECT source, sum(documents)::int AS documents, sum(claims)::int AS claims, sum(searches)::int AS searches
    FROM source_yield
    GROUP BY source
    ORDER BY source
  `;
  console.log("来源产出");
  for (const row of rates) {
    const rate = row.documents ? Math.round((row.claims / row.documents) * 1000) / 10 : 0;
    console.log(`${row.source}\t文档 ${row.documents}\t主张 ${row.claims}\t搜索 ${row.searches}\t产出率 ${rate}%`);
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
