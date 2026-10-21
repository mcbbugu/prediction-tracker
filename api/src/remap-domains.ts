// 把不在固定领域表里的分类归并到固定领域：pnpm api:remap
// 一次模型调用给出「旧分类 → 新领域」对照，打印出来，然后更新主张并重算所有人的分数。
import { arkConfigured, arkJson } from "./ark";
import { sql } from "./db";
import { DOMAINS } from "./discover";
import { logEvent, migrate } from "./migrate";
import { recomputeScores } from "./score";

export async function remapStrayDomains(log: (line: string) => void = console.log) {
  const rows = await sql<{ category: string; n: number }[]>`
    SELECT category, count(*)::int AS n FROM claims GROUP BY category ORDER BY n DESC
  `;
  const stray = rows.filter((row) => !DOMAINS.includes(row.category));
  if (stray.length === 0) {
    log("所有分类都已在固定领域表里。");
    return 0;
  }
  if (!arkConfigured()) throw new Error("缺少 ARK_* 配置");
  const mapped = (await arkJson(
    `把每个旧分类归到下面固定领域中最贴切的一个：${DOMAINS.join("、")}。输出 JSON：{"map":{"旧分类":"固定领域"}}`,
    JSON.stringify(stray.map((row) => row.category)),
    1500,
  )) as { map?: Record<string, string> };

  const people = new Set<string>();
  for (const row of stray) {
    const target = DOMAINS.includes(mapped.map?.[row.category] ?? "") ? (mapped.map![row.category] as string) : "其他科技";
    log(`${row.category} (${row.n}) → ${target}`);
    const changed = await sql<{ id: string; person_id: string }[]>`
      UPDATE claims SET category = ${target} WHERE category = ${row.category} RETURNING id, person_id
    `;
    for (const claim of changed) {
      people.add(claim.person_id);
      await logEvent({
        claim_id: claim.id,
        person_id: claim.person_id,
        action: "domain_remapped",
        actor: "agent",
        before: { category: row.category },
        after: { category: target },
      });
    }
  }
  for (const person of people) await recomputeScores(person, { action: "domain_remap" });
  log(`更新了 ${people.size} 个人的领域分。`);
  return stray.length;
}

async function main() {
  await migrate();
  await remapStrayDomains();
}

if (import.meta.main) main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
