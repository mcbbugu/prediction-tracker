"use client";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none placeholder:text-mute focus:border-ink",
        className,
      )}
      {...props}
    />
  );
}
