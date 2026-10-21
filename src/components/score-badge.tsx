import { cn } from "@/lib/utils";

export const MIN_SCORED = 8;
export const MIN_INTERVAL = 3;

type ScoreLike = { value: number | null | undefined; n: number; low?: number | null; high?: number | null };

export function hasInterval(score: ScoreLike) {
  return score.low != null && score.high != null;
}

// One line of text for a domain score, per SPEC 分数显示:
// < 3 judged → 样本不足; 3–7 → interval only; ≥ 8 → number and interval.
export function scoreCaption(score: ScoreLike) {
  if (score.value != null) {
    return hasInterval(score) ? `基于 ${score.n} 条 · 80% 区间 ${score.low}–${score.high}` : `基于 ${score.n} 条已判定`;
  }
  if (hasInterval(score)) return `80% 区间（${score.n} 条），满 ${MIN_SCORED} 条出分`;
  return `已判定 ${score.n} 条，满 ${MIN_INTERVAL} 条出区间`;
}

// Ink density encodes the record: solid ≥ 70, tint 52–70, outline < 52, dashed when the sample is too small.
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
  const interval = value == null && low != null && high != null;
  const dims = {
    sm: "h-6 min-w-9 px-1.5 text-[15px] rounded-[5px]",
    md: "h-10 min-w-14 px-2 text-[26px] rounded-[7px]",
    lg: "h-16 min-w-22 px-3 text-[46px] rounded-[10px]",
  }[size];
  const small = size === "sm" ? "text-[12px]" : size === "md" ? "text-[17px]" : "text-[28px]";
  return (
    <span
      className={cn(
        "display-num inline-flex shrink-0 items-center justify-center leading-none font-[800]",
        dims,
        tone === "solid" && "bg-blue text-white",
        tone === "tint" && "bg-blue-tint text-blue-deep",
        tone === "outline" && "border-[1.5px] border-blue text-blue",
        interval && "border-[1.5px] border-dashed border-blue/60 font-[700] text-blue",
        tone === "insufficient" && !interval && "border-[1.5px] border-dashed border-mute/50 font-[600] text-mute",
        className,
      )}
      title={scoreCaption({ value, n, low, high })}
    >
      {value != null ? (
        value.toFixed(value >= 99.95 ? 0 : 1)
      ) : interval ? (
        <span className={small}>
          {low}–{high}
        </span>
      ) : (
        <span className={small}>
          {n}/{MIN_INTERVAL}
        </span>
      )}
    </span>
  );
}

// Inline text form for lists: "61.2 (48–73)", "30–60（3 条）", or "样本不足".
export function ScoreText({ score, className }: { score: ScoreLike; className?: string }) {
  if (score.value != null) {
    return (
      <span className={cn("num", className)}>
        <b className="font-semibold">{score.value.toFixed(1)}</b>
        {hasInterval(score) ? <span className="text-mute"> ({score.low}–{score.high})</span> : null}
      </span>
    );
  }
  if (hasInterval(score)) {
    return (
      <span className={cn("num text-mute", className)}>
        {score.low}–{score.high}（{score.n} 条）
      </span>
    );
  }
  return <span className={cn("text-mute", className)}>样本不足</span>;
}
