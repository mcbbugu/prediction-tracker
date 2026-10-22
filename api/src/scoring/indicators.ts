// 画像旁证（SPEC 人物画像）：和利益关系一样只并排展示，不进综合分。
//   改期率：同一件事后来再说时，期限往后推了。一串改期主张（claims.thread_id）和每条单独的主张各算一个「承诺」，
//          被推迟过的承诺占多少、一共推迟了几次、平均每次推迟多久。
//   可检验度：期限已过的主张里，能判定结果的占多少；判不了的是「证据不足」（作废）。
export type IndicatorClaim = {
  id: string;
  category: string;
  status: string;
  published_date: string;
  deadline: string;
  thread_id: string | null;
};

const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);
const VOID = "证据不足";
const months = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / (30.44 * 86_400_000);

export function rescheduling(claims: IndicatorClaim[]) {
  const commitments = new Map<string, IndicatorClaim[]>();
  for (const claim of claims) {
    const key = claim.thread_id || `self:${claim.id}`;
    commitments.set(key, [...(commitments.get(key) ?? []), claim]);
  }
  let rescheduled = 0;
  const delays: number[] = [];
  let longest: { thread_id: string; times: number; first_said: string; first_deadline: string; last_deadline: string } | null = null;
  for (const [key, list] of commitments) {
    if (list.length < 2) continue;
    const ordered = [...list].sort((a, b) => a.published_date.localeCompare(b.published_date) || a.deadline.localeCompare(b.deadline));
    let pushes = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      // Said again later, with a later deadline than the one before: the date slipped.
      if (ordered[i].deadline > ordered[i - 1].deadline) {
        pushes += 1;
        delays.push(months(ordered[i - 1].deadline, ordered[i].deadline));
      }
    }
    if (!pushes) continue;
    rescheduled += 1;
    if (!longest || pushes > longest.times) {
      longest = {
        thread_id: key,
        times: pushes,
        first_said: ordered[0].published_date,
        first_deadline: ordered[0].deadline,
        last_deadline: ordered[ordered.length - 1].deadline,
      };
    }
  }
  return {
    commitments: commitments.size,
    rescheduled,
    rate: commitments.size ? rescheduled / commitments.size : null,
    pushes: delays.length,
    avg_delay_months: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : null,
    longest,
  };
}

export function testability(claims: IndicatorClaim[]) {
  const judged = claims.filter((c) => JUDGED.has(c.status)).length;
  const voided = claims.filter((c) => c.status === VOID).length;
  const resolved = judged + voided;
  return { resolved, judged, voided, rate: resolved ? judged / resolved : null };
}

export function indicators(claims: IndicatorClaim[]) {
  const domains = [...new Set(claims.map((c) => c.category))];
  return {
    rescheduling: rescheduling(claims),
    testability: testability(claims),
    by_domain: Object.fromEntries(
      domains.map((domain) => {
        const list = claims.filter((c) => c.category === domain);
        return [domain, { rescheduling: rescheduling(list), testability: testability(list) }];
      }),
    ),
  };
}
