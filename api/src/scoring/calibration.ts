// 校准协议（SPEC 核对分层）：机器判定什么时候可以不经人审直接公开。
//
// 1. 分层抽样：从 agent 的判定提案里，按模型给的结论（已兑现 / 部分兑现 / 未兑现 / 证据不足）分层，
//    每层平均分配名额，不够的层把名额匀给别的层（少见的「部分兑现」「证据不足」因此被多抽），层内尽量分散到不同领域。
// 2. 盲标：人看不到模型的结论和理由，自己给出结论（calibration_items.human_status）。
// 3. 门槛：已标 ≥ 100 条，一致率 95% Wilson 区间下界 ≥ 90%，Cohen's κ ≥ 0.8，每层至少 10 条（不足 10 条的层全标）。
// 4. 持续抽检：达标后自动生效的判定随机抽 5% 进抽检；最近 100 条抽检（满 30 条起算）下界 < 90% 就自动关闭。
// 本机模式（AUTO_PUBLISH=1，网站未上线）照旧直接放行，不受门槛约束。
//
// pnpm api:calibrate -- sample [--n=120]   抽样（只加入还没抽过的提案）
// pnpm api:calibrate -- report             打印报告
import { sql } from "../core/db";

export const STRATA = ["已兑现", "部分兑现", "未兑现", "证据不足"] as const;
export const LABELS = [...STRATA, "待定"] as const;

const MIN_LABELS = 100;
const MIN_LOWER_BOUND = 0.9;
const MIN_KAPPA = 0.8;
const MIN_PER_STRATUM = 10;
export const AUDIT_RATE = 0.05;
const AUDIT_WINDOW = 100;
const AUDIT_MIN = 30;

// 95% Wilson score interval for k agreements out of n.
export function wilson(k: number, n: number, z = 1.96) {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: (centre - margin) / denom, high: (centre + margin) / denom };
}

// Cohen's κ: agreement corrected for what two raters with these label frequencies would reach by chance.
export function cohenKappa(pairs: { model: string; human: string }[]) {
  const n = pairs.length;
  if (n === 0) return null;
  const observed = pairs.filter((p) => p.model === p.human).length / n;
  const labels = new Set(pairs.flatMap((p) => [p.model, p.human]));
  let expected = 0;
  for (const label of labels) {
    expected += (pairs.filter((p) => p.model === label).length / n) * (pairs.filter((p) => p.human === label).length / n);
  }
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

type Labeled = { model_status: string; human_status: string; stratum: string };

function summarise(rows: Labeled[]) {
  const agree = rows.filter((r) => r.model_status === r.human_status).length;
  const bound = wilson(agree, rows.length);
  return {
    n: rows.length,
    agree,
    rate: rows.length ? agree / rows.length : null,
    low: rows.length ? bound.low : null,
    high: rows.length ? bound.high : null,
    kappa: cohenKappa(rows.map((r) => ({ model: r.model_status, human: r.human_status }))),
  };
}

export async function calibrationReport() {
  const labeled = await sql<Labeled[]>`
    SELECT model_status, human_status, stratum FROM calibration_items
    WHERE purpose = 'calibration' AND human_status IS NOT NULL
  `;
  const [{ open }] = await sql<{ open: number }[]>`
    SELECT count(*)::int AS open FROM calibration_items WHERE purpose = 'calibration' AND human_status IS NULL
  `;
  // How many proposals each stratum has at all: a stratum with fewer than 10 must be labeled in full.
  const population = await sql<{ status: string; n: number }[]>`
    SELECT status, count(*)::int AS n FROM verdict_proposals WHERE state IN ('auto_applied', 'pending', 'accepted') GROUP BY status
  `;
  const overall = summarise(labeled);
  const strata = STRATA.map((stratum) => {
    const rows = labeled.filter((r) => r.stratum === stratum);
    const available = population.find((p) => p.status === stratum)?.n ?? 0;
    const needed = Math.min(MIN_PER_STRATUM, available);
    return { stratum, ...summarise(rows), available, needed, enough: rows.length >= needed };
  });
  const confusion = STRATA.map((model) => ({
    model,
    human: Object.fromEntries(LABELS.map((human) => [human, labeled.filter((r) => r.model_status === model && r.human_status === human).length])),
  }));

  const audit = await sql<Labeled[]>`
    SELECT model_status, human_status, stratum FROM calibration_items
    WHERE purpose = 'audit' AND human_status IS NOT NULL
    ORDER BY labeled_at DESC
    LIMIT ${AUDIT_WINDOW}
  `;
  const auditSummary = summarise(audit);

  const reasons: string[] = [];
  if (overall.n < MIN_LABELS) reasons.push(`已标 ${overall.n} 条，至少要 ${MIN_LABELS} 条`);
  if (overall.low != null && overall.low < MIN_LOWER_BOUND) reasons.push(`一致率下界 ${(overall.low * 100).toFixed(1)}%，要 ≥ ${MIN_LOWER_BOUND * 100}%`);
  if (overall.kappa != null && overall.kappa < MIN_KAPPA) reasons.push(`κ = ${overall.kappa.toFixed(2)}，要 ≥ ${MIN_KAPPA}`);
  for (const s of strata) if (!s.enough) reasons.push(`「${s.stratum}」已标 ${s.n} 条，要 ${s.needed} 条`);
  const calibrated = reasons.length === 0;
  const auditFailed = calibrated && audit.length >= AUDIT_MIN && auditSummary.low != null && auditSummary.low < MIN_LOWER_BOUND;
  if (auditFailed) reasons.push(`最近 ${audit.length} 条抽检一致率下界 ${(auditSummary.low! * 100).toFixed(1)}% < ${MIN_LOWER_BOUND * 100}%，已退回全部人审`);

  return {
    thresholds: { min_labels: MIN_LABELS, min_lower_bound: MIN_LOWER_BOUND, min_kappa: MIN_KAPPA, min_per_stratum: MIN_PER_STRATUM, audit_rate: AUDIT_RATE },
    overall,
    strata,
    confusion,
    audit: auditSummary,
    open,
    gate: { open: calibrated && !auditFailed, reasons },
  };
}

// Whether an agent verdict may take effect without a person: local mode, or a passed calibration.
export async function verdictAutoPublish() {
  if (process.env.AUTO_PUBLISH === "1") return { allowed: true, mode: "local" as const };
  const report = await calibrationReport();
  return { allowed: report.gate.open, mode: "calibrated" as const };
}

// After an auto-applied verdict in calibrated mode, queue 5% of them for a blind audit.
export async function maybeQueueAudit(proposalId: number, mode: "local" | "calibrated") {
  if (mode !== "calibrated" || Math.random() >= AUDIT_RATE) return false;
  const rows = await sql`
    INSERT INTO calibration_items (proposal_id, claim_id, model_status, stratum, purpose)
    SELECT id, claim_id, status, status, 'audit' FROM verdict_proposals WHERE id = ${proposalId} AND status IN ${sql([...STRATA])}
    ON CONFLICT (proposal_id) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

// Stratified sample of proposals not yet in calibration_items; within a stratum, spread over domains.
export async function sampleCalibration(n: number) {
  const pool = await sql<{ id: number; claim_id: string; status: string; category: string }[]>`
    SELECT v.id::int AS id, v.claim_id, v.status, c.category
    FROM verdict_proposals v
    JOIN claims c ON c.id = v.claim_id
    WHERE v.state IN ('auto_applied', 'pending', 'accepted') AND v.status IN ${sql([...STRATA])}
      AND NOT EXISTS (SELECT 1 FROM calibration_items ci WHERE ci.proposal_id = v.id)
    ORDER BY random()
  `;
  const byStratum = new Map(STRATA.map((s) => [s, pool.filter((row) => row.status === s)]));
  // Equal shares; whatever a small stratum cannot use goes to the others.
  const quota = new Map(STRATA.map((s) => [s, 0]));
  let left = Math.min(n, pool.length);
  while (left > 0) {
    const open = STRATA.filter((s) => quota.get(s)! < byStratum.get(s)!.length);
    if (!open.length) break;
    const share = Math.max(1, Math.floor(left / open.length));
    for (const s of open) {
      const take = Math.min(share, byStratum.get(s)!.length - quota.get(s)!, left);
      quota.set(s, quota.get(s)! + take);
      left -= take;
      if (left === 0) break;
    }
  }
  const picked: typeof pool = [];
  for (const s of STRATA) {
    // Round-robin over domains so one busy domain does not fill the stratum.
    const domains = new Map<string, typeof pool>();
    for (const row of byStratum.get(s)!) domains.set(row.category, [...(domains.get(row.category) ?? []), row]);
    const queues = [...domains.values()];
    const want = quota.get(s)!;
    const chosen: typeof pool = [];
    for (let i = 0; chosen.length < want; i = (i + 1) % queues.length) {
      const next = queues[i].shift();
      if (next) chosen.push(next);
      if (queues.every((q) => q.length === 0)) break;
    }
    picked.push(...chosen);
  }
  for (const row of picked) {
    await sql`
      INSERT INTO calibration_items (proposal_id, claim_id, model_status, stratum, purpose)
      VALUES (${row.id}, ${row.claim_id}, ${row.status}, ${row.status}, 'calibration')
      ON CONFLICT (proposal_id) DO NOTHING
    `;
  }
  return Object.fromEntries(STRATA.map((s) => [s, picked.filter((row) => row.status === s).length]));
}

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

if (import.meta.main) {
  const { migrate } = await import("../core/migrate");
  await migrate();
  const mode = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "report";
  if (mode === "sample") {
    const n = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 120);
    console.log("新抽样：", await sampleCalibration(n));
  }
  const r = await calibrationReport();
  console.log(
    `校准：已标 ${r.overall.n} 条（待标 ${r.open}）· 一致率 ${pct(r.overall.rate)}（95% 区间 ${pct(r.overall.low)}–${pct(r.overall.high)}）· κ ${r.overall.kappa?.toFixed(2) ?? "—"}`,
  );
  for (const s of r.strata) console.log(`  ${s.stratum}：已标 ${s.n}/${s.needed}（共 ${s.available}）· 一致率 ${pct(s.rate)}`);
  console.log(`抽检：最近 ${r.audit.n} 条 · 一致率 ${pct(r.audit.rate)}（下界 ${pct(r.audit.low)}）`);
  console.log(r.gate.open ? "门槛：已达标，机器判定可以自动公开" : `门槛：未达标 · ${r.gate.reasons.join("；")}`);
  await sql.end();
}
