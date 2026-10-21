"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

// Clipboard API first; some embedded browsers deny it, so fall back to a hidden textarea + execCommand.
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        setState((await copyText(text)) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 1600);
      }}
      className={`inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-white/85 transition-colors hover-fine:bg-white/20 ${className ?? ""}`}
      aria-label="复制调用示例"
    >
      <Icon name={state === "copied" ? "checkmark" : "copy"} size={12} />
      {state === "copied" ? "已复制" : state === "failed" ? "请手动复制" : "复制"}
    </button>
  );
}
