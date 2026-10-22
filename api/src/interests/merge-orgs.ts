// pnpm api:merge-orgs -- [--dry-run] [--apply]
// 把 ALIASES 里同一家机构的旧 org_key 改成保留的键。默认只打印；--apply 才写库。
// org_exposures、org_financials 撞上唯一索引的行不改、不删。claim_interests 没有 org_key，不改。
import { sql } from "../core/db";
import { migrate } from "../core/migrate";
import { ALIASES } from "./orgs";

const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

type Change = { table: string; id: number; prev: string; next: string };
type Conflict = Change & { blockedBy: number[]; slot: string };
type Db = typeof sql;

function storedKey(name: string) {
  return name.replace(/[^a-z0-9㐀-鿿]+/g, "-").replace(/^-|-$/g, "");
}

// Alias name → the org_key it would have had before the alias, then the key orgKey() keeps.
function renamesFromAliases() {
  const direct = new Map<string, string>();
  for (const [name, kept] of Object.entries(ALIASES)) {
    const old = storedKey(name);
    const next = storedKey(kept) || kept;
    if (!old || old === next) continue;
    const prior = direct.get(old);
    if (prior && prior !== next) throw new Error(`${old} 同时指向 ${prior} 和 ${next}`);
    direct.set(old, next);
  }
  const resolve = (key: string) => {
    const seen = new Set<string>();
    let current = key;
    while (direct.has(current)) {
      if (seen.has(current)) throw new Error(`别名成环：${[...seen, current].join(" → ")}`);
      seen.add(current);
      current = direct.get(current)!;
    }
    return current;
  };
  return new Map([...direct].map(([old]) => [old, resolve(old)]));
}

function classify<T extends { id: number; org_key: string }>(
  table: string,
  rows: T[],
  renames: Map<string, string>,
  slotOf: (org: string, row: T) => string,
  slotLabel: (row: T) => string,
) {
  const changes: Change[] = [];
  const conflicts: Conflict[] = [];
  const dest = (key: string) => renames.get(key) ?? key;
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const slot = slotOf(dest(row.org_key), row);
    groups.set(slot, [...(groups.get(slot) ?? []), row]);
  }
  for (const group of groups.values()) {
    const next = dest(group[0]!.org_key);
    const moving = group.filter((row) => row.org_key !== next);
    if (group.length === 1) {
      const row = group[0]!;
      if (row.org_key !== next) changes.push({ table, id: row.id, prev: row.org_key, next });
      continue;
    }
    const staying = group.filter((row) => row.org_key === next);
    for (const row of moving) {
      const blockedBy = [...staying, ...moving.filter((other) => other.id !== row.id)].map((other) => other.id);
      conflicts.push({ table, id: row.id, prev: row.org_key, next, blockedBy, slot: slotLabel(row) });
    }
  }
  return { changes, conflicts };
}

async function collect(db: Db, renames: Map<string, string>) {
  const oldKeys = [...renames.keys()];
  const watchKeys = [...new Set([...oldKeys, ...renames.values()])];
  const interests = await db<{ id: number; org_key: string }[]>`
    SELECT id::int AS id, org_key FROM interests WHERE org_key IN ${db(oldKeys)} ORDER BY id
  `;
  const exposures = await db<{ id: number; org_key: string; dimension: string; target: string; metric_kind: string | null; metric_year: number | null; basis: string }[]>`
    SELECT id::int AS id, org_key, dimension, target, metric_kind, coalesce(metric_year, 0)::int AS metric_year, basis
    FROM org_exposures WHERE org_key IN ${db(watchKeys)} ORDER BY id
  `;
  const financials = await db<{ id: number; org_key: string; period_end: string; form: string }[]>`
    SELECT id::int AS id, org_key, period_end::text AS period_end, form
    FROM org_financials WHERE org_key IN ${db(watchKeys)} ORDER BY id
  `;
  const [{ n: claimLinks }] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM claim_interests ci
    JOIN interests i ON i.id = ci.interest_id
    WHERE i.org_key IN ${db(oldKeys)}
  `;
  const interestChanges: Change[] = interests.map((row) => ({
    table: "interests",
    id: row.id,
    prev: row.org_key,
    next: renames.get(row.org_key)!,
  }));
  const exposurePlan = classify(
    "org_exposures",
    exposures,
    renames,
    (org, row) => [org, row.dimension, row.target.toLowerCase(), row.metric_kind ?? "", String(row.metric_year ?? 0), row.basis].join("\u0001"),
    (row) => `${row.dimension} / ${row.target} / ${row.metric_kind ?? ""} / ${row.metric_year ?? 0} / ${row.basis}`,
  );
  const financialPlan = classify(
    "org_financials",
    financials,
    renames,
    (org, row) => [org, row.period_end, row.form].join("\u0001"),
    (row) => `${row.period_end} / ${row.form}`,
  );
  const changes = [...interestChanges, ...exposurePlan.changes, ...financialPlan.changes];
  const conflicts = [...exposurePlan.conflicts, ...financialPlan.conflicts];
  return { changes, conflicts, claimLinks };
}

function printPlan(changes: Change[], conflicts: Conflict[], claimLinks: number) {
  const pairs = [...new Set([...changes, ...conflicts].map((item) => `${item.prev}\t${item.next}`))].sort();
  console.log(apply ? "模式：写入（--apply）" : "模式：试运行（默认，不写库；写入请加 --apply）");
  if (!pairs.length) {
    console.log("没有要改的行");
    return;
  }
  for (const pair of pairs) {
    const [prev, next] = pair.split("\t");
    console.log(`\n${prev} → ${next}`);
    for (const change of changes.filter((item) => item.prev === prev && item.next === next)) {
      console.log(`${change.table} · ${change.id} · ${change.prev} → ${change.next}`);
    }
    for (const conflict of conflicts.filter((item) => item.prev === prev && item.next === next)) {
      console.log(
        `冲突 ${conflict.table} · ${conflict.id} · ${conflict.prev} → ${conflict.next} · 唯一键与 id ${conflict.blockedBy.join("、")} 相同（${conflict.slot}）`,
      );
    }
  }
  console.log(`\n将改 ${changes.length} 行 · 冲突跳过 ${conflicts.length} 行`);
  console.log(`claim_interests 没有 org_key，不改行（${claimLinks} 条链接仍指向这些利益行）`);
}

async function writeChanges(db: Db, changes: Change[]) {
  for (const change of changes) {
    const updated =
      change.table === "interests"
        ? await db`UPDATE interests SET org_key = ${change.next} WHERE id = ${change.id} AND org_key = ${change.prev} RETURNING id`
        : change.table === "org_exposures"
          ? await db`UPDATE org_exposures SET org_key = ${change.next} WHERE id = ${change.id} AND org_key = ${change.prev} RETURNING id`
          : await db`UPDATE org_financials SET org_key = ${change.next} WHERE id = ${change.id} AND org_key = ${change.prev} RETURNING id`;
    if (updated.length !== 1) throw new Error(`${change.table} ${change.id} 没有按预期更新，已回滚`);
  }
}

function fingerprint(changes: Change[], conflicts: Conflict[]) {
  return JSON.stringify({ changes, conflicts });
}

async function main() {
  await migrate();
  const renames = renamesFromAliases();
  const plan = await collect(sql, renames);
  printPlan(plan.changes, plan.conflicts, plan.claimLinks);
  if (!apply) return;
  await sql.begin(async (tx) => {
    const again = await collect(tx as unknown as Db, renames);
    if (fingerprint(again.changes, again.conflicts) !== fingerprint(plan.changes, plan.conflicts)) {
      throw new Error("库在试运行之后变了，已回滚");
    }
    await writeChanges(tx as unknown as Db, again.changes);
  });
  console.log("已写入");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
