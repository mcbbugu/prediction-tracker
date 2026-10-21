import { cn } from "@/lib/utils";

export function scoreTone(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "text-mute";
  if (value >= 70) return "text-score-high";
  if (value >= 52) return "text-score-mid";
  return "text-score-low";
}

export function ScoreNum({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  return (
    <span className={cn("num", scoreTone(value), className)}>
      {value == null ? "—" : value.toFixed(1)}
    </span>
  );
}
