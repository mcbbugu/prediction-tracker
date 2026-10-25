import Link from "next/link";
import type { ClaimRef, ScoreChange, ScoreChangeLine } from "@/lib/api";
import { cn } from "@/lib/utils";

// What each formula version changed, in reader terms (see SPEC 分数显示).
const FORMULA_NOTES: Record<string, string> = {
  "v1.1": "有一条判定就出分，并给出区间",
  "v1.2": "时间衰减放宽为每 3 年减半，几年前的判定重新计入",
};

function quoteSnippet(claim: ClaimRef | null) {
  if (!claim) return "一条已不再公开的主张";
  const text = claim.quote_zh.replace(/\s+/g, " ");
  return `「${text.length > 34 ? `${text.slice(0, 34)}…` : text}」`;
}

// One reason line, in the reader's terms: what happened to which of this person's claims.
function describe(line: ScoreChangeLine, personId: string) {
  const link = (claim: ClaimRef | null) =>
    claim ? (
      <Link href={`/p/${personId}/${claim.id}`} className="text-ink/80 no-underline hover-fine:text-blue">
        {quoteSnippet(claim)}
      </Link>
    ) : (
      quoteSnippet(claim)
    );
  if (line.kind === "added") return <>新判定 <b className="font-medium text-ink">{line.status}</b>：{link(line.claim)}</>;
  if (line.kind === "removed") return <>撤回不计（{line.status}）：{link(line.claim)}</>;
  if (line.kind === "changed")
    return (
      <>
        判定改为 <b className="font-medium text-ink">{line.to}</b>（原为 {line.from}）：{link(line.claim)}
      </>
    );
  if (line.kind === "count")
    return line.to > line.from ? `新增 ${line.to - line.from} 条已判定（${line.from} → ${line.to}）` : `减少 ${line.from - line.to} 条已判定（${line.from} → ${line.to}）`;
  return FORMULA_NOTES[line.version] ? `计分规则升级到 ${line.version}：${FORMULA_NOTES[line.version]}` : `计分规则升级到 ${line.version}`;
}

// One score change. limit caps the reason lines (the overview); the full history shows them all.
export function ChangeRow({ change, personId, limit }: { change: ScoreChange; personId: string; limit?: number }) {
  const after = change.after;
  const delta = change.before?.value != null && after.value != null ? after.value - change.before.value : null;
  const lines = limit ? change.lines.slice(0, limit) : change.lines;
  return (
    <li className="grid gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-0 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <p className="font-medium">{change.domain}</p>
        <ul className="mt-0.5 space-y-0.5 text-xs text-mute">
          {change.lines.length === 0 ? <li>旧判定随时间降低权重，分数略有变化</li> : null}
          {lines.map((line, index) => (
            <li key={index} className={limit ? "truncate" : undefined}>
              {describe(line, personId)}
            </li>
          ))}
          {change.lines.length > lines.length ? <li>另有 {change.lines.length - lines.length} 条变化</li> : null}
        </ul>
      </div>
      <div className="flex shrink-0 items-start gap-3 text-xs text-mute sm:flex-col sm:items-end sm:gap-0.5">
        <span className="num text-sm text-ink">
          {after.value != null ? `${after.value.toFixed(1)}（${after.low}–${after.high}）` : "样本不足"}
          {delta != null && Math.abs(delta) >= 0.05 ? (
            <span className={cn("ml-1.5 text-xs", delta > 0 ? "text-blue" : "text-ink/60")}>
              {delta > 0 ? "↑" : "↓"}
              {Math.abs(delta).toFixed(1)}
            </span>
          ) : null}
        </span>
        <span className="num">
          {after.n} 条 · {change.at.slice(5, 16).replace("T", " ")}
        </span>
      </div>
    </li>
  );
}
