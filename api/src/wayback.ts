// pnpm api:wayback -- [--limit=50]
// 把存档过的网页再提交给 Internet Archive（Wayback Machine），拿一个第三方快照链接当佐证（SPEC 证据存档）。
// 逐字核对仍以我们自己存的原始字节为准；Wayback 只用来证明「这个页面当时确实是这样」。
//
// - 设置了 IA_ACCESS_KEY / IA_SECRET_KEY（archive.org 账号的 S3 key）就走 SPN2 接口，更稳；否则走匿名的 /save/。
// - 每分钟最多提交约 8 个；遇到 429 就停，下次接着跑。同一网址只提交一次。
import { sql } from "./db";
import { migrate } from "./migrate";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const limit = Math.max(1, Number(arg("limit") ?? 50));
const GAP_MS = 7_500;
const key = process.env.IA_ACCESS_KEY && process.env.IA_SECRET_KEY ? `LOW ${process.env.IA_ACCESS_KEY}:${process.env.IA_SECRET_KEY}` : null;
const SNAPSHOT = /https?:\/\/web\.archive\.org\/web\/\d{14}[^\s"']*/;

class RateLimited extends Error {}

// Anonymous Save Page Now: the response redirects to (or names) the new capture.
async function saveAnonymous(url: string) {
  const response = await fetch(`https://web.archive.org/save/${url}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
    headers: { "User-Agent": "prediction-tracker evidence archiver" },
  });
  if (response.status === 429) throw new RateLimited("Wayback 429");
  const located = response.headers.get("content-location");
  const capture = SNAPSHOT.exec(response.url)?.[0] ?? (located ? `https://web.archive.org${located}` : null);
  if (!capture) throw new Error(`没有拿到快照地址（HTTP ${response.status}）`);
  return capture;
}

// SPN2 with keys: submit, then poll the job until it finishes.
async function saveWithKeys(url: string) {
  const headers = { Authorization: key!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
  const submit = await fetch("https://web.archive.org/save", {
    method: "POST",
    headers,
    body: new URLSearchParams({ url, skip_first_archive: "1" }),
    signal: AbortSignal.timeout(60_000),
  });
  if (submit.status === 429) throw new RateLimited("Wayback 429");
  const job = (await submit.json().catch(() => ({}))) as { job_id?: string; message?: string };
  if (!job.job_id) throw new Error(job.message || `提交失败（HTTP ${submit.status}）`);
  for (let i = 0; i < 24; i += 1) {
    await Bun.sleep(5_000);
    const status = (await fetch(`https://web.archive.org/save/status/${job.job_id}`, { headers, signal: AbortSignal.timeout(30_000) })
      .then((r) => r.json())
      .catch(() => ({}))) as { status?: string; timestamp?: string; original_url?: string; message?: string };
    if (status.status === "success" && status.timestamp) return `https://web.archive.org/web/${status.timestamp}/${status.original_url ?? url}`;
    if (status.status === "error") throw new Error(status.message || "Wayback 抓取失败");
  }
  throw new Error("等了 2 分钟还没完成");
}

async function main() {
  await migrate();
  const rows = await sql<{ url: string }[]>`
    SELECT url FROM sources
    WHERE http_status < 400 AND wayback_url IS NULL
      AND (wayback_error IS NULL OR wayback_at < now() - interval '7 days')
    GROUP BY url
    ORDER BY max(fetched_at) DESC
    LIMIT ${limit}
  `;
  console.log(`待提交 ${rows.length} 个网址 · ${key ? "SPN2（有 key）" : "匿名 /save/"}`);
  let saved = 0;
  for (const [index, { url }] of rows.entries()) {
    if (index) await Bun.sleep(GAP_MS);
    try {
      const capture = key ? await saveWithKeys(url) : await saveAnonymous(url);
      await sql`UPDATE sources SET wayback_url = ${capture}, wayback_at = now(), wayback_error = NULL WHERE url = ${url}`;
      saved += 1;
      console.log(`存档 ${url} → ${capture}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RateLimited) {
        console.log("Wayback 限流，先停下，过一会儿再跑");
        break;
      }
      await sql`UPDATE sources SET wayback_error = ${message.slice(0, 300)}, wayback_at = now() WHERE url = ${url}`;
      console.log(`失败 ${url} · ${message.slice(0, 120)}`);
    }
  }
  console.log(`完成 · 成功 ${saved}/${rows.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
