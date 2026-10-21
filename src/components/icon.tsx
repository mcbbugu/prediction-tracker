"use client";

import { addCollection, Icon as IconifyIcon } from "@iconify/react";
import proicons from "@iconify-json/proicons/icons.json";
import { cn } from "@/lib/utils";

addCollection(proicons);

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <IconifyIcon
      icon={`proicons:${name}`}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden
    />
  );
}
