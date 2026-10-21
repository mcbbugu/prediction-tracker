"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3011";

export function AnalyzeButton({ query, variant = "primary" }: { query: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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

  return (
    <div>
      <Button variant={variant} onClick={start} disabled={busy}>
        <Icon name="sparkle" />
        {busy ? "正在启动…" : `让 agent 去查「${query}」`}
      </Button>
      {error ? <p className="mt-2 text-sm text-mute">{error}</p> : null}
    </div>
  );
}
