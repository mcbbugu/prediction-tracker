import { cn } from "@/lib/utils";

type ScoreLike = { value: number | null | undefined; n: number; low?: number | null; high?: number | null };

export function hasInterval(score: ScoreLike) {
  return score.low != null && score.high != null;
}

// Formula v1.1: one judged claim is enough for a score; the interval and the count say how sure it is.
// No judged claim → 样本不足. There are no in-between states.
export function scoreCaption(score: ScoreLike) {
  if (score.value == null) return "还没有已判定的主张";
  return hasInterval(score) ? `基于 ${score.n} 条 · 80% 区间 ${score.low}–${score.high}` : `基于 ${score.n} 条已判定`;
}

// Ink density encodes the record: solid ≥ 70, tint 52–70, outline < 52, dashed when there is no judged claim.
// The number is always printed, so the badge never relies on colour alone.
export function badgeTone(value: number | null | undefined) {
  if (value == null) return "insufficient";
  if (value >= 70) return "solid";
  if (value >= 52) return "tint";
  return "outline";
}

export function ScoreBadge({
  value,
  n,
  low,
  high,
  size = "md",
  className,
}: ScoreLike & {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tone = badgeTone(value);
  const dims = {
    sm: "h-6 min-w-9 px-1.5 text-[15px] rounded-[5px]",
    md: "h-10 min-w-14 px-2 text-[26px] rounded-[7px]",
    lg: "h-16 min-w-22 px-3 text-[46px] rounded-[10px]",
  }[size];
  return (
    <span
      className={cn(
        "display-num inline-flex shrink-0 items-center justify-center leading-none font-[800]",
        dims,
        tone === "solid" && "bg-blue text-white",
        tone === "tint" && "bg-blue-tint text-blue-deep",
        tone === "outline" && "border-[1.5px] border-blue text-blue",
        tone === "insufficient" && "border-[1.5px] border-dashed border-mute/50 font-[600] text-mute",
        className,
      )}
      title={scoreCaption({ value, n, low, high })}
    >
      {value != null ? value.toFixed(value >= 99.95 ? 0 : 1) : "—"}
    </span>
  );
}

// Inline text form for lists: "56.0（25–85）· 1 条" or "样本不足".
export function ScoreText({ score, className }: { score: ScoreLike; className?: string }) {
  if (score.value == null) return <span className={cn("text-mute", className)}>样本不足</span>;
  return (
    <span className={cn("num", className)}>
      <b className="font-semibold">{score.value.toFixed(1)}</b>
      {hasInterval(score) ? <span className="text-mute">（{score.low}–{score.high}）</span> : null}
      <span className="text-mute"> · {score.n} 条</span>
    </span>
  );
}
