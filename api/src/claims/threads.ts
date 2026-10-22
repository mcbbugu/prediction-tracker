// pnpm api:threads -- [--people=musk,altman] [--apply]
// 改期合并（公式 v1.3）：找出同一个人在不同时间重说的同一个承诺或预测（例如连续几年都说「FSD 明年实现」），
// 把它们连成一串（claims.thread_id）。计分时一串里已判定的 k 条合计只算 √k 条的分量。
//
// 模型只提出分组；代码只接受「同一个人、同一领域、编号都存在、一条主张只属于一串」的组。
// 默认试运行，只打印；加 --apply 才写库（thread_source = 'agent'，人工设置的串不覆盖），写完重算分数。
import { ArkStopped, arkJson, arkPreflight } from "../core/ark";
import { sql } from "../core/db";
import { logEvent, migrate } from "../core/migrate";
import { recomputeScores } from "../scoring/score";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const apply = process.argv.includes("--apply");
const MAX_CLAIMS = 80;

type Row = {
  id: string;
  person_id: string;
  category: string;
  quote_zh: string;
  quote_en: string;
  published_date: string;
  deadline: string;
  status: string;
  thread_id: string | null;
  thread_source: string | null;
};

async function proposeThreads(personName: string, domain: string, rows: Row[]) {
  const answer = await arkJson(
    [
      `下面是 ${personName} 在「${domain}」领域公开说过的、带期限的预测或承诺。找出其中「同一个承诺或预测在不同时间重说」的组。`,
      "- 同一组的条件：说的是同一件具体的事会发生（同一个产品、同一个目标、同一个结果），只是说话时间不同、期限被改了或重复了。例如 2016 年说「年底实现全自动驾驶」和 2019 年说「明年实现全自动驾驶」是同一组。",
      "- 不算同一组：同一领域但目标不同（例如「自动驾驶出租车上线」和「FSD 在中国获批」）；同一时间说的两个不同目标；只是话题相近。",
      "- 拿不准就不要分组。每条主张最多属于一组；每组至少 2 条。没有就返回空数组。",
      '输出 JSON：{"threads":[{"claim_ids":["id1","id2"],"commitment":"这组共同承诺的事，一句话","reason":"为什么是同一件事"}]}',
    ].join("\n"),
    JSON.stringify(
      rows.map((row) => ({ id: row.id, said_on: row.published_date, deadline: row.deadline, quote: row.quote_zh || row.quote_en })),
    ),
    3000,
  );
  return Array.isArray(answer.threads) ? (answer.threads as { claim_ids?: unknown; commitment?: string; reason?: string }[]) : [];
}

async function threadsFor(personId: string) {
  const [person] = await sql<{ name: string }[]>`SELECT name FROM people WHERE id = ${personId}`;
  const rows = await sql<Row[]>`
    SELECT id, person_id, category, quote_zh, quote_en,
           to_char(published_date, 'YYYY-MM-DD') AS published_date, to_char(deadline, 'YYYY-MM-DD') AS deadline,
           status, thread_id, thread_source
    FROM claims
    WHERE person_id = ${personId} AND publication = 'published'
    ORDER BY category, published_date
  `;
  const byDomain = new Map<string, Row[]>();
  for (const row of rows) byDomain.set(row.category, [...(byDomain.get(row.category) ?? []), row]);
  let linked = 0;
  for (const [domain, list] of byDomain) {
    if (list.length < 2) continue;
    const ids = new Map(list.map((row) => [row.id, row]));
    const proposals = await proposeThreads(person?.name ?? personId, domain, list.slice(0, MAX_CLAIMS));
    const taken = new Set<string>();
    for (const proposal of proposals) {
      const members = [...new Set(Array.isArray(proposal.claim_ids) ? proposal.claim_ids.map(String) : [])].filter(
        (id) => ids.has(id) && !taken.has(id),
      );
      if (members.length < 2) continue;
      // Threads set by a person are never overwritten.
      if (members.some((id) => ids.get(id)!.thread_source === "manual")) continue;
      members.forEach((id) => taken.add(id));
      const threadId = `thr-${[...members].sort()[0]}`;
      console.log(`${personId} · ${domain} · ${members.length} 条 · ${proposal.commitment ?? ""}`);
      for (const id of members) {
        const row = ids.get(id)!;
        console.log(`    ${row.published_date} 说，期限 ${row.deadline}，${row.status}：${(row.quote_zh || row.quote_en).slice(0, 60)}`);
      }
      if (!apply) continue;
      for (const id of members) {
        const row = ids.get(id)!;
        if (row.thread_id === threadId) continue;
        await sql`UPDATE claims SET thread_id = ${threadId}, thread_source = 'agent' WHERE id = ${id}`;
        await logEvent({
          claim_id: id,
          person_id: personId,
          action: "thread_linked",
          actor: "agent",
          before: { thread_id: row.thread_id },
          after: { thread_id: threadId },
          note: `${proposal.commitment ?? ""}｜${proposal.reason ?? ""}`.slice(0, 300),
        });
        linked += 1;
      }
    }
  }
  if (apply && linked) await recomputeScores(personId, { action: "threads_linked" });
  return linked;
}

async function main() {
  await migrate();
  const preflight = await arkPreflight({ search: false });
  if (!preflight.ok) {
    console.log(`启动预检没通过，不开始：\n  ${preflight.problems.join("\n  ")}`);
    return;
  }
  const wanted = (arg("people") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const people = wanted.length
    ? wanted
    : (await sql<{ person_id: string }[]>`
        SELECT person_id FROM claims WHERE publication = 'published' GROUP BY person_id HAVING count(*) >= 2 ORDER BY person_id
      `).map((r) => r.person_id);
  console.log(`改期合并 · ${people.length} 人 · ${apply ? "写库" : "试运行（加 --apply 写库）"}`);
  for (const personId of people) {
    try {
      const linked = await threadsFor(personId);
      if (apply) console.log(`${personId}：连成串的主张 ${linked} 条`);
    } catch (error) {
      if (error instanceof ArkStopped) {
        console.log(`停止：${error.message}`);
        break;
      }
      console.log(`${personId}：失败 · ${error instanceof Error ? error.message.slice(0, 160) : error}`);
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
