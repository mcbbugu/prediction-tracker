// Outbound alerts. NOTIFY_WEBHOOK is a generic JSON POST (Feishu, Slack, Telegram bridges).
// The same condition is sent at most once an hour. Without a webhook, the line is only logged.
import { sql } from "./db";

type Db = any;

export async function recentlyNotified(db: Db, condition: string) {
  const [row] = await db<{ id: number }[]>`
    SELECT id FROM notifications
    WHERE condition = ${condition} AND sent_at > now() - interval '1 hour'
    LIMIT 1
  `;
  return Boolean(row);
}

export async function notify(condition: string, message: string) {
  if (await recentlyNotified(sql, condition)) return { sent: false as const };
  await sql`INSERT INTO notifications (condition, message) VALUES (${condition}, ${message})`;
  const url = process.env.NOTIFY_WEBHOOK?.trim();
  if (!url) {
    console.log(`[通知] ${condition}: ${message}`);
    return { sent: true as const, delivered: false as const };
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message, condition }),
    });
    if (!response.ok) console.log(`[通知] ${condition} webhook HTTP ${response.status}`);
    return { sent: true as const, delivered: response.ok };
  } catch (error) {
    console.log(`[通知] ${condition} webhook 失败：${error instanceof Error ? error.message : error}`);
    return { sent: true as const, delivered: false as const };
  }
}

// Three failed jobs of one kind in the last hour raise one alert.
export async function noteKindFailures(kind: string) {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM jobs
    WHERE kind = ${kind} AND state = 'failed' AND updated_at > now() - interval '1 hour'
  `;
  if ((row?.n ?? 0) >= 3) await notify(`fail-${kind}`, `${kind} 在一小时内失败了 ${row.n} 次`);
}
