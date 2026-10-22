"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PUBLIC_API_URL } from "@/lib/api";

// 更正通道：任何人都可以对这条记录提交反证。提交后链接会被存档，主张标「有争议」，等人工复核。
export function ChallengeForm({ claimId }: { claimId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
      setError("请填一个以 http 或 https 开头的出处链接");
      return;
    }
    if (note.trim().length < 4) {
      setError("说明至少写 4 个字：哪里不对，出处里怎么说");
      return;
    }
    setState("sending");
    setError("");
    const response = await fetch(`${PUBLIC_API_URL}/v1/claims/${encodeURIComponent(claimId)}/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.trim(), note: note.trim() }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setState("idle");
      setError(body.error || "提交失败，请稍后再试");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <p className="rounded-2xl bg-card px-4 py-3 text-sm leading-6">
        已收到。你给的链接已经存档，这条记录会标为「有争议」，人工复核后更新结论或说明理由。
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-mute hover-fine:text-blue">
        <Icon name="flag" size={14} />
        这条记录有误？提交反证
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4">
      <p className="text-sm font-semibold">提交反证</p>
      <p className="text-xs leading-5 text-mute">给一个能证明结论有误的公开出处（新闻、公告、原始发言），并说明哪里不对。我们会存档这个链接，复核期间这条记录标「有争议」。</p>
      <Input className="w-full max-w-none" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="出处链接 https://…" aria-label="出处链接" />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="哪里不对？出处里是怎么说的？"
        aria-label="说明"
        rows={3}
        maxLength={1000}
        className="w-full rounded-[10px] border border-line bg-card px-3 py-2 text-sm outline-none focus:border-blue"
      />
      {error ? <p className="text-xs text-ink">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "提交中…" : "提交"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </form>
  );
}
