import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

export function Catalog({
  title,
  lede,
  icon,
  children,
}: {
  title: string;
  lede: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <div className="pt-6">
      <h1 className="flex items-center gap-3 text-4xl font-semibold tracking-tight">
        <Icon name={icon} size={28} className="text-mute" />
        {title}
      </h1>
      <p className="mt-2 max-w-[52ch] text-mute">{lede}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
