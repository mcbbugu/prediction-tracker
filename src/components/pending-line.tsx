"use client";

import { ThinkingShimmer } from "@/components/beui/agents/loading-states/thinking-shimmer";
import { Loader } from "@/components/beui/motion/loader";

export function PendingLine({ label = "正在加载" }: { label?: string }) {
  return (
    <p className="inline-flex h-6 items-center gap-2 text-sm">
      <Loader variant="spinner" size={14} speed={0.8} label={label} className="text-ink" />
      <ThinkingShimmer duration={1.8} className="font-normal">
        {label}
      </ThinkingShimmer>
    </p>
  );
}
