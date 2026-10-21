import { cn } from "@/lib/utils";

// 先验 brand mark: a P (Prior) whose bowl is pierced by a four-point star — a compass needle pointing at
// the reliable signal. Drawn as vector, kept in sync with src/app/icon.svg.
export function PriorMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size * (41 / 46)} height={size} viewBox="4 3 41 46" aria-hidden className={className}>
      <g fill="#2f3fc4">
        <path d="M6 5H14.6V45.4Q14.8 46.3 16.2 46.6V47.2H5.6V46.6Q7 46.3 7.2 45.4V6.4Q7 5.5 6 5.3Z" />
        <path d="M14.6 5H24C33 5 38.6 11 38.6 19.8H30.2C30.2 13.4 28.2 9.6 23.2 9.6H14.6Z" />
        <path d="M38.6 24.6C38.3 31 33.2 35 24.6 35.3C27.6 32.1 29.8 28.6 30.2 24.6Z" />
        <path d="M22 11C22.25 19 24.5 21.9 43.6 22.2C24.5 22.5 22.25 25.4 22 35.3C21.75 25.4 19.4 22.5 15.4 22.2C19.4 21.9 21.75 19 22 11Z" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("leading-none font-[900] tracking-tight text-ink", className)}>先验</span>;
}

// Large version for the top-left corner on wide screens.
export function BrandCorner() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <PriorMark size={36} />
      <Wordmark className="text-[22px]" />
    </span>
  );
}

// Compact version inside the search bar, for screens too narrow for the corner.
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <PriorMark size={24} />
      <Wordmark className="text-[18px]" />
    </span>
  );
}
