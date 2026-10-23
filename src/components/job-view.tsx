"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AgentActivity, type AgentActivityItem } from "@/components/beui/agents/agent-activity";
import { ThinkingShimmer } from "@/components/beui/agents/loading-states/thinking-shimmer";
import { CARD_TARGET_CLASS, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/beui/motion/card";
import { PendingLine } from "@/components/pending-line";
import { PUBLIC_API_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

const API = PUBLIC_API_URL;

type JobEvent = {
  id: number;
  step: string;
  status: "running" | "done" | "failed" | "info";
  message: string;
  data: Record<string, unknown>;
  created_at: string;
};

type Job = {
  id: string;
  query: string;
  state: "queued" | "running" | "done" | "failed" | "rejected";
  person_id: string | null;
  person_name: string | null;
  person_name_en: string | null;
  person_title: string | null;
  visibility: string | null;
  created_at: string;
  updated_at: string;
};

type KeptClaim = { id: string; quote: string; deadline: string; domain: string; url: string };

const ACTIVE = new Set(["queued", "running"]);

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function seconds(from: string, to: string) {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
}

function elapsedLabel(from: string, to: string) {
  const total = seconds(from, to);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  if (minutes > 0) return `${minutes} 分 ${remain} 秒`;
  return `${remain} 秒`;
}

export function JobView({ id }: { id: string }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`${API}/v1/jobs/${id}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "读取任务失败");
        if (stop) return;
        setJob(body.job);
        setEvents(body.events);
        setError("");
        if (ACTIVE.has(body.job.state)) timer = setTimeout(poll, 1500);
      } catch (reason) {
        if (stop) return;
        setError(reason instanceof Error ? reason.message : "读取任务失败");
        timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (job?.state === "done" && job.person_id) router.replace(`/p/${job.person_id}`);
  }, [job, router]);

  useEffect(() => {
    if (!job || !ACTIVE.has(job.state)) return;
    const tick = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(tick);
  }, [job]);

  const running = job ? ACTIVE.has(job.state) : false;
  const finished = useMemo(() => {
    const closed = new Set<number>();
    events.forEach((event, index) => {
      if (event.status !== "running") return;
      if (events.slice(index + 1).some((later) => later.step === event.step && later.status !== "running")) closed.add(event.id);
      else if (events.slice(index + 1).some((later) => later.step !== event.step && later.status === "running")) closed.add(event.id);
    });
    return closed;
  }, [events]);

  const kept = (events.find((event) => event.step === "核对原话" && event.status === "done")?.data.kept ?? []) as KeptClaim[];
  const statusLabel =
    job?.state === "queued" ? "排队中" : job?.state === "running" ? "进行中" : job?.state === "done" ? "已完成" : job?.state === "rejected" ? "不在收录范围" : "未完成";
  const elapsed = job ? elapsedLabel(job.created_at, running ? now : job.updated_at) : "";
  const items = useMemo(() => toActivity(events, finished, running), [events, finished, running]);

  if (!job) {
    return (
      <div className="mx-auto max-w-[720px] pt-10">
        {error ? <p className="text-sm text-mute">{error}</p> : <PendingLine label="正在读取这次分析" />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] pt-6">
      <p className="text-[13px] font-medium tracking-wide text-blue">Agent</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{job.person_name ?? job.query}</h1>
      <p className="mt-2 text-mute">
        {job.person_name_en ? `${job.person_name_en} · ` : ""}
        {job.person_title ?? `查询「${job.query}」`}
      </p>

      {!running && job.person_id ? (
        <Link href={`/p/${job.person_id}`} prefetch={false} className="mt-4 inline-flex text-sm text-blue">
          打开{job.person_name ?? "这个人"}的页面
        </Link>
      ) : null}

      <div className="mt-8">
        <AgentActivity
          items={items.length > 0 ? items : [{ id: "wait", type: "text", content: job.state === "queued" ? "排队中" : "正在开始" }]}
          status={running ? "working" : "complete"}
          duration={job ? seconds(job.created_at, running ? now : job.updated_at) : 0}
          collapseOnComplete={false}
          defaultOpen
          maxHeight={running ? 520 : 100000}
          contentClassName="[&>[role=listitem]:has([data-kind=step])]:mt-5 [&>[role=listitem]:has([data-kind=step]):first-child]:mt-0"
          activeLabel={statusLabel}
          renderWorkingStatus={() => <ThinkingShimmer className="font-normal">{`${statusLabel} · ${elapsed}`}</ThinkingShimmer>}
          renderCompletedStatus={() => <span>{statusLabel} · 用时 {elapsed}</span>}
        />
      </div>
      {error ? <p className="mt-4 text-sm text-mute">{error}</p> : null}

      {!running && kept.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">找到的带期限说法</h2>
          <p className="mt-1 text-sm text-mute">原话都已在存档网页里逐字核对，写进这个人的页面。</p>
          <div className="mt-4 grid gap-3">
            {kept.map((claim) => (
              <Card key={claim.id} interactive size="compact" className="bg-white/90">
                <CardHeader>
                  <CardDescription>
                    {claim.domain} · 截止 <span className="num">{claim.deadline}</span>
                  </CardDescription>
                  <CardTitle className="font-medium leading-7">{claim.quote}</CardTitle>
                </CardHeader>
                <CardContent>
                  <a href={claim.url} target="_blank" rel="noreferrer" className={cn(CARD_TARGET_CLASS, "text-sm text-blue")}>
                    {host(claim.url)}
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function toActivity(events: JobEvent[], finished: Set<number>, running: boolean): AgentActivityItem[] {
  const groups: { step: string; events: JobEvent[]; live: boolean }[] = [];
  for (const event of events) {
    const live = event.status === "running" && !finished.has(event.id) && running;
    const last = groups[groups.length - 1];
    if (last && last.step === event.step) {
      last.events.push(event);
      last.live = last.live || live;
    } else {
      groups.push({ step: event.step, events: [event], live });
    }
  }

  const items: AgentActivityItem[] = [];
  for (const group of groups) {
    items.push({
      id: `${group.step}-step`,
      type: "step",
      label: group.step,
      status: group.live ? "active" : "complete",
    });
    const links = uniqueLinks(group.events.flatMap(linksOf));
    const notes = group.events.filter((event) => event.status !== "running");
    const linkNote = links.length > 0 ? notes.at(-1) : undefined;
    const visible = (linkNote ? notes.filter((event) => event !== linkNote) : notes);
    const shown = visible.length > 0 ? visible : linkNote ? [] : group.events.slice(-1);
    for (const event of shown) {
      items.push({
        id: String(event.id),
        type: "text",
        content: group.live && event.status === "running" ? <ThinkingShimmer className="font-normal">{event.message}</ThinkingShimmer> : event.message,
      });
    }
    if (group.live && notes.length > 0) {
      const current = group.events.find((event) => event.status === "running" && !finished.has(event.id));
      if (current) {
        items.push({
          id: `${current.id}-live`,
          type: "text",
          content: <ThinkingShimmer className="font-normal">{current.message}</ThinkingShimmer>,
        });
      }
    }
    if (links.length > 0) {
      items.push({
        id: `${group.step}-links`,
        type: "search",
        query: linkNote?.message ?? `${links.length} 个出处`,
        results: links.map((link, index) => {
          const domain = host(link.url);
          return {
            id: `${group.step}-${index}`,
            title: link.label,
            domain: link.label === domain ? undefined : domain,
            url: link.url,
          };
        }),
      });
    }
    const dropped = group.events.flatMap((event) => (event.data.dropped as { quote: string; reason: string }[] | undefined) ?? []);
    for (const [index, item] of dropped.entries()) {
      items.push({
        id: `${group.step}-drop-${index}`,
        type: "text",
        content: `丢弃（${item.reason}）：${item.quote.slice(0, 80)}`,
      });
    }
  }
  return items;
}

function uniqueLinks(links: { url: string; label: string }[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function linksOf(event: JobEvent) {
  return [
    ...((event.data.urls as string[] | undefined) ?? []).map((url) => ({ url, label: host(url) })),
    ...((event.data.archived as ({ url: string; title?: string } | string)[] | undefined) ?? []).map((item) =>
      typeof item === "string" ? { url: item, label: host(item) } : { url: item.url, label: item.title || host(item.url) },
    ),
  ];
}
