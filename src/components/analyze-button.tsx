"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { PUBLIC_API_URL } from "@/lib/api";

const API = PUBLIC_API_URL;

export function AnalyzeButton({ query, variant = "primary", auto = false }: { query: string; variant?: "primary" | "secondary"; auto?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(auto);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/v1/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "没能启动分析");
      router.push(`/jobs/${body.job_id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没能启动分析");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!auto) return;
    // Start on the next tick so no state is set synchronously inside the effect.
    const timer = setTimeout(() => void start(), 0);
    return () => clearTimeout(timer);
    // 只在这句话变化时启动一次；接口会复用一小时内的同一任务。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, query]);

  return (
    <div>
      <Button variant={variant} onClick={start} disabled={busy}>
        <Icon name="sparkle" />
        {busy ? "正在查，完成后打开他的页面" : `让 agent 去查「${query}」`}
      </Button>
      {error ? <p className="mt-2 text-sm text-mute">{error}</p> : null}
    </div>
  );
}
