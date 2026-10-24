// bun --env-file=.env run src/tools/audit-rss-archives.ts [--apply]
// 排查 #7：旧版 RSS 适配器在原文打不开时，把 feed 摘要当成文章原文存档（text/plain、fetched_via = direct、final_url = 文章网址）。
// 默认试运行，只列清单。加 --apply 才写库：引用这些存档的已发布主张退回待复核（publication 改为 proposed），写 claim_events。不删行。
import { sql } from "../core/db";
import { FEED_HOSTS } from "../claims/sources/rss";

const apply = process.argv.includes("--apply");

const archives = await sql<{ id: number; url: string; title: string; chars: number; fetched_at: Date }[]>`
  SELECT id, url, title, length(text) AS chars, fetched_at
  FROM sources
  WHERE content_type = 'text/plain' AND fetched_via = 'direct' AND final_url = url
  ORDER BY id
`;
const suspect = archives.filter((row) => {
  try {
    return FEED_HOSTS.has(new URL(row.url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
});
console.log(`text/plain 直连存档 ${archives.length} 份，网址属于登记过的 RSS 站点的 ${suspect.length} 份：`);
for (const row of suspect) console.log(`  #${row.id} ${row.url}（${row.chars} 字，${row.fetched_at.toISOString().slice(0, 10)}）${row.title.slice(0, 40)}`);

const urls = suspect.map((row) => row.url);
const claims = urls.length
  ? await sql<{ id: string; person_id: string; publication: string; source_url: string; quote_en: string }[]>`
      SELECT id, person_id, publication, source_url, quote_en
      FROM claims
      WHERE source_url = ANY(${urls})
      ORDER BY person_id, id
    `
  : [];
console.log(`引用这些存档的主张 ${claims.length} 条（已发布 ${claims.filter((c) => c.publication === "published").length} 条）：`);
for (const claim of claims) console.log(`  ${claim.id} ${claim.person_id} ${claim.publication} ${claim.quote_en.slice(0, 60)}`);

if (!apply) {
  console.log("未写库。确认后加 --apply。");
  await sql.end();
  process.exit(0);
}

let moved = 0;
await sql.begin(async (tx) => {
  for (const claim of claims.filter((item) => item.publication === "published")) {
    const updated = await tx`UPDATE claims SET publication = 'proposed' WHERE id = ${claim.id} AND publication = 'published' RETURNING id`;
    if (!updated[0]) continue;
    moved++;
    await tx`
      INSERT INTO claim_events (claim_id, person_id, action, actor, before, after, note)
      VALUES (${claim.id}, ${claim.person_id}, 'rss_summary_requeued', 'audit-rss-archives',
              ${tx.json({ publication: "published" })}, ${tx.json({ publication: "proposed" })},
              '出处存档是 RSS 摘要而不是文章原文（#7），退回待复核')
    `;
  }
});
console.log(`已退回待复核 ${moved} 条。`);
await sql.end();
