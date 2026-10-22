// 到期核对（命令行）：pnpm api:verify -- --person=musk --limit=5   (or --claim=<id>)
// 规则见 verdict.ts 顶部注释。
import { ArkStopped, arkConfigured } from "../core/ark";
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { verifyClaim, type DueClaim } from "./verdict";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const personId = arg("person");
const claimId = arg("claim");
const limit = Number(arg("limit") ?? 5);

async function record(step: string, status: string, detail: Record<string, unknown>, person = personId ?? null) {
  await sql`
    INSERT INTO agent_runs (person_id, step, status, detail)
    VALUES (${person}, ${step}, ${status}, ${sql.json(detail)})
  `;
  console.log(`${status}\t${step}\t${JSON.stringify(detail).slice(0, 200)}`);
}

async function dueClaims(): Promise<DueClaim[]> {
  const today = new Date().toISOString().slice(0, 10);
  return sql<DueClaim[]>`
    SELECT c.id, c.person_id, p.name_en, c.category, c.quote_en, c.quote_zh, c.source_url,
           to_char(c.published_date, 'YYYY-MM-DD') AS published_date,
           to_char(c.deadline, 'YYYY-MM-DD') AS deadline
    FROM claims c
    JOIN people p ON p.id = c.person_id
    WHERE c.publication = 'published'
      AND c.status = '待定'
      AND c.deadline < ${today}
      AND (${claimId ?? null}::text IS NULL OR c.id = ${claimId ?? null})
      AND (${personId ?? null}::text IS NULL OR c.person_id = ${personId ?? null})
      AND NOT EXISTS (
        SELECT 1 FROM verdict_proposals v WHERE v.claim_id = c.id AND v.state = 'pending'
      )
    ORDER BY c.deadline
    LIMIT ${limit}
  `;
}

async function main() {
  await migrate();
  if (!arkConfigured()) {
    await record("到期核对", "blocked", { reason: "缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL" });
    return;
  }
  const claims = await dueClaims();
  if (claims.length === 0) {
    await record("到期核对", "completed", { reason: "没有到期且待定、尚无待审判定的已发布主张" });
    return;
  }
  console.log(`待核对 ${claims.length} 条`);
  for (const claim of claims) {
    try {
      const outcome = await verifyClaim(claim);
      await record("到期核对", outcome.proposal_id ? "completed" : "blocked", { claim: claim.id, ...outcome }, claim.person_id);
    } catch (error) {
      if (error instanceof ArkStopped) {
        console.log(`停止：${error.message}`);
        break;
      }
      await record(
        "到期核对",
        "failed",
        { claim: claim.id, message: error instanceof Error ? error.message : String(error) },
        claim.person_id,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
