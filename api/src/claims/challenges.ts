// 更正通道（SPEC 原则 7、P9）：任何人可以对一条已公开的主张提交反证（一个出处链接 + 一句说明）。
// 提交后先存档那个链接，记为待复核；有待复核的反证时，主张标「有争议」，分数照常显示。
// 审核台接受或驳回，并写明理由；接受后由审核人用现有的判定工具改结论。
import { sql } from "../core/db";
import { logEvent } from "../core/migrate";
import { snapshot } from "../evidence/sources";

const MAX_PENDING_PER_CLAIM = 5;

export class ChallengeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function submitChallenge(input: { claimId: string; url: string; note: string }) {
  const url = input.url.trim();
  const note = input.note.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new ChallengeError("请填一个以 http 或 https 开头的出处链接", 400);
  if (note.length < 4 || note.length > 1000) throw new ChallengeError("说明写 4 到 1000 个字", 400);
  const [claim] = await sql<{ id: string; person_id: string }[]>`
    SELECT id, person_id FROM claims WHERE id = ${input.claimId} AND publication = 'published'
  `;
  if (!claim) throw new ChallengeError("这条主张不存在或还没公开", 404);
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM challenges WHERE target_kind = 'claim' AND target_id = ${claim.id} AND state = 'pending'
  `;
  if (n >= MAX_PENDING_PER_CLAIM) throw new ChallengeError("这条主张已有多条反证在等复核，请稍后再提交", 429);
  const [dup] = await sql`
    SELECT 1 FROM challenges WHERE target_kind = 'claim' AND target_id = ${claim.id} AND url = ${url} AND state = 'pending'
  `;
  if (dup) throw new ChallengeError("这个链接已经提交过，正在等复核", 409);

  // Archive what the challenger points at, so the reviewer sees the page as it was when submitted.
  const page = await snapshot(url).catch(() => null);
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO challenges (target_kind, target_id, person_id, url, note, source_id)
    VALUES ('claim', ${claim.id}, ${claim.person_id}, ${url}, ${note}, ${page?.id ?? null})
    RETURNING id::int AS id
  `;
  await logEvent({ claim_id: claim.id, person_id: claim.person_id, action: "challenge_submitted", actor: "public", note: `challenges#${row.id} ${url}` });
  return { id: row.id, archived: Boolean(page), state: "pending" as const };
}

export async function pendingChallenges() {
  return sql`
    SELECT ch.id::int AS id, ch.target_id AS claim_id, ch.person_id, p.name AS person_name, ch.url, ch.note, ch.created_at,
           c.quote_zh, c.status, to_char(c.deadline, 'YYYY-MM-DD') AS deadline,
           s.http_status, left(s.text, 600) AS excerpt
    FROM challenges ch
    JOIN claims c ON c.id = ch.target_id
    JOIN people p ON p.id = ch.person_id
    LEFT JOIN sources s ON s.id = ch.source_id
    WHERE ch.target_kind = 'claim' AND ch.state = 'pending'
    ORDER BY ch.created_at
  `;
}

export async function decideChallenge(id: number, action: "accept" | "reject", decisionNote: string) {
  const note = decisionNote.trim();
  if (!note) throw new ChallengeError("请写明接受或驳回的理由", 400);
  const [row] = await sql<{ id: number; claim_id: string; person_id: string }[]>`
    UPDATE challenges SET state = ${action === "accept" ? "accepted" : "rejected"}, decision_note = ${note}, decided_at = now()
    WHERE id = ${id} AND state = 'pending'
    RETURNING id::int AS id, target_id AS claim_id, person_id
  `;
  if (!row) throw new ChallengeError("这条反证不存在或已经处理过", 404);
  await logEvent({
    claim_id: row.claim_id,
    person_id: row.person_id,
    action: action === "accept" ? "challenge_accepted" : "challenge_rejected",
    actor: "reviewer",
    note: `challenges#${row.id} ${note}`.slice(0, 300),
  });
  return { ok: true };
}
