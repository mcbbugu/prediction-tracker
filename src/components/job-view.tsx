"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AgentActivity, type AgentActivityItem } from "@/components/beui/agents/agent-activity";
import { ThinkingShimmer } from "@/components/beui/agents/loading-states/thinking-shimmer";
import { CARD_TARGET_CLASS, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/beui/motion/card";
import { PendingLine } from "@/components/pending-line";
import { PUBLIC_API_URL, type AnalysisArchive, type AnalysisCandidate, type AnalysisRelation, type AnalysisSearch, type AnalysisVerdict, type JobEventData } from "@/lib/api";
import { cn } from "@/lib/utils";

const API = PUBLIC_API_URL;

type JobEvent = {
  id: number;
  step: string;
  status: "running" | "done" | "failed" | "info";
  message: string;
  data: JobEventData;
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
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState("");
  const [queuePosition, setQueuePosition] = useState(0);
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
        setQueuePosition(Number(body.queue_position) || 0);
        setError("");
        if (ACTIVE.has(body.job.state)) timer = setTimeout(poll, 2000);
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
    job?.state === "queued" ? `排队中，前面还有 ${queuePosition} 个` : job?.state === "running" ? "进行中" : job?.state === "done" ? "已完成" : job?.state === "rejected" ? "不在收录范围" : "未完成";
  const elapsed = job ? elapsedLabel(job.created_at, running ? now : job.updated_at) : "";
  const items = useMemo(() => toActivity(events, finished, running), [events, finished, running]);
  const summary = traceSummary(events, elapsed);

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
        <Link href={`/p/${job.person_id}`} prefetch={false} className="mt-4 inline-flex h-9 items-center rounded-full bg-blue px-4 text-sm text-white no-underline">
          查看人物页
        </Link>
      ) : null}

      {summary ? (
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summary.map((item) => (
            <div key={item.label} className="rounded-2xl border border-line px-3 py-2">
              <dd className="num text-lg leading-none font-semibold">{item.value}</dd>
              <dt className="mt-1 text-xs text-mute">{item.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-8">
        <AgentActivity
          items={items.length > 0 ? items : [{ id: "wait", type: "text", content: job.state === "queued" ? `排队中，前面还有 ${queuePosition} 个` : "正在开始" }]}
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
    const detail = stepDetail(group.step, group.events, !running);
    const hasDetail = detail != null;
    if (!hasDetail && links.length > 0) {
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
    if (detail) {
      items.push({ id: `${group.step}-detail`, type: "text", content: detail });
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

function doneData(events: JobEvent[]) {
  return events.filter((event) => event.status === "done").at(-1)?.data;
}

function traceSummary(events: JobEvent[], elapsed: string) {
  const finish = events.find((event) => event.step === "完成" && event.status === "done")?.data;
  const check = events.find((event) => event.step === "核对原话" && event.status === "done")?.data;
  const archives = events.find((event) => event.step === "存档网页" && event.status === "done")?.data.archives;
  if (!finish && !check && !archives) return null;
  const passed = check?.kept?.length ?? 0;
  const dropped = check?.dropped?.length ?? 0;
  const archived = archives?.filter((row) => row.ok).length ?? check?.kept?.length ?? 0;
  const searchCount = finish?.search_count;
  return [
    { label: "耗时", value: finish?.elapsed_ms != null ? elapsedLabel(new Date(0).toISOString(), new Date(finish.elapsed_ms).toISOString()) : elapsed },
    { label: "搜索次数", value: searchCount == null ? "—" : String(searchCount) },
    { label: "存档", value: String(archived) },
    { label: "通过 / 丢弃", value: `${passed} / ${dropped}` },
  ];
}

function stepDetail(step: string, events: JobEvent[], open: boolean) {
  const data = doneData(events);
  if (!data) return null;
  if (step === "搜索公开发言" && data.searches?.length) return <SearchList searches={data.searches} open={open} />;
  if (step === "存档网页" && data.archives?.length) return <ArchiveTable rows={data.archives} open={open} />;
  if (step === "核对原话" && ((data.kept?.length ?? 0) > 0 || (data.dropped?.length ?? 0) > 0)) {
    return <QuoteCheck kept={data.kept ?? []} dropped={data.dropped ?? []} open={open} />;
  }
  if (step === "到期核对") return <VerdictList events={events} open={open} />;
  if (step === "抽取预测" && data.candidates) return <CandidateList rows={data.candidates} open={open} />;
  if (step === "利益关系" && data.relations) return <RelationList rows={data.relations} open={open} />;
  if (step === "可信度对照" && (data.topics?.length || data.outcomes?.length)) return <ConsistencyList data={data} open={open} />;
  return null;
}

function Fold({ title, open, children }: { title: string; open: boolean; children: ReactNode }) {
  return (
    <details className="mt-1 text-sm" {...(open ? { open: true } : {})}>
      <summary className="cursor-pointer text-mute">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function SearchList({ searches, open }: { searches: AnalysisSearch[]; open: boolean }) {
  return (
    <Fold title={`${searches.length} 次搜索`} open={open}>
      <div className="grid gap-3">
        {searches.map((search) => (
          <div key={search.query}>
            <p className="text-ink">{search.error ? `失败：${search.error}` : search.query}</p>
            <ul className="mt-1 grid gap-1">
              {search.urls.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer" className="text-blue">
                    {host(url)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Fold>
  );
}

function ArchiveTable({ rows, open }: { rows: AnalysisArchive[]; open: boolean }) {
  return (
    <Fold title={`${rows.filter((row) => row.ok).length} 份存档`} open={open}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-mute">
            <tr>
              <th className="py-1 pr-3 font-normal">链接</th>
              <th className="py-1 pr-3 font-normal">状态</th>
              <th className="py-1 pr-3 font-normal">途径</th>
              <th className="py-1 pr-3 font-normal">SHA-256</th>
              <th className="py-1 font-normal">快照</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.source_id ?? ""}-${row.url}`} className="border-t border-line align-top">
                <td className="py-1.5 pr-3">
                  <a href={row.url} target="_blank" rel="noreferrer" className="text-blue">
                    {host(row.url)}
                  </a>
                </td>
                <td className={cn("py-1.5 pr-3", row.ok ? "text-blue" : "text-mute")}>{row.ok ? "已存档" : row.reason || "失败"}</td>
                <td className="py-1.5 pr-3 text-mute">{row.fetched_via ?? "—"}</td>
                <td className="num py-1.5 pr-3 text-mute" title={row.sha256 ?? undefined}>
                  {row.sha256 ? row.sha256.slice(0, 12) : "—"}
                </td>
                <td className="py-1.5">
                  {row.wayback_url ? (
                    <a href={row.wayback_url} target="_blank" rel="noreferrer" className="text-blue">
                      Wayback
                    </a>
                  ) : (
                    <span className="text-mute">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Fold>
  );
}

function QuoteCheck({ kept, dropped, open }: { kept: AnalysisCandidate[]; dropped: AnalysisCandidate[]; open: boolean }) {
  return (
    <Fold title={`通过 ${kept.length} · 丢弃 ${dropped.length}`} open={open}>
      <ul className="grid gap-2">
        {kept.map((item) => (
          <li key={item.id ?? item.quote} className="text-blue">
            ✓ {item.quote}
          </li>
        ))}
        {dropped.map((item) => (
          <li key={`${item.reason}-${item.quote}`} className="text-mute">
            {item.quote || "（空）"} — {item.reason}
          </li>
        ))}
      </ul>
    </Fold>
  );
}

function CandidateList({ rows, open }: { rows: AnalysisCandidate[]; open: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-mute">没有抽出候选。</p>;
  return (
    <Fold title={`${rows.length} 条候选`} open={open}>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={`${row.source_id}-${row.quote}`}>
            <span className="num text-mute">{row.deadline || "无期限"}</span> {row.quote}
          </li>
        ))}
      </ul>
    </Fold>
  );
}

function VerdictList({ events, open }: { events: JobEvent[]; open: boolean }) {
  const summary = doneData(events);
  const rows = summary?.verdicts?.length
    ? summary.verdicts
    : events
        .filter((event) => event.status === "done" && event.data.status)
        .map((event) => ({
          claim: String((event.data as { claim?: string }).claim ?? ""),
          status: event.data.status ?? null,
          accepted: event.data.accepted,
          rejected: event.data.rejected,
        }));
  if (rows.length === 0) return <p className="text-sm text-mute">没有已过截止日的新主张。</p>;
  return (
    <Fold title={`${rows.length} 条判定`} open={open}>
      <ul className="grid gap-3">
        {rows.map((row) => (
          <li key={row.claim || row.status}>
            <p className="text-ink">{row.status ?? "未完成"}</p>
            <VerdictLinks row={row} />
          </li>
        ))}
      </ul>
    </Fold>
  );
}

function VerdictLinks({ row }: { row: AnalysisVerdict }) {
  const accepted = row.accepted ?? [];
  const rejected = row.rejected ?? [];
  if (accepted.length === 0 && rejected.length === 0) return null;
  return (
    <ul className="mt-1 grid gap-1">
      {accepted.map((item) => (
        <li key={item.source_id}>
          <a href={item.url} target="_blank" rel="noreferrer" className="text-blue">
            采信 · {host(item.url)}
          </a>
        </li>
      ))}
      {rejected.map((item) => (
        <li key={`${item.url}-${item.reason}`} className="text-mute">
          丢弃 · {item.reason}
        </li>
      ))}
    </ul>
  );
}

function ConsistencyList({ data, open }: { data: JobEventData; open: boolean }) {
  const topics = data.topics ?? [];
  const outcomes = new Map((data.outcomes ?? []).map((row) => [row.topic, row]));
  const rows = topics.length > 0 ? topics : (data.outcomes ?? []).map((row) => ({ topic: row.topic, domain: "", why: "" }));
  if (rows.length === 0) return null;
  return (
    <Fold title={`${rows.length} 个话题`} open={open}>
      <ul className="grid gap-2">
        {rows.map((topic) => {
          const outcome = outcomes.get(topic.topic);
          const result = !outcome
            ? ""
            : outcome.status === "kept"
              ? outcome.label === "consistent"
                ? "一致"
                : "不一致"
              : outcome.status === "none"
                ? "没有后来的说法"
                : `丢弃：${outcome.reason ?? ""}`;
          return (
            <li key={topic.topic}>
              <p className="text-ink">{topic.topic}</p>
              <p className="text-mute">{[topic.domain, topic.why, result].filter(Boolean).join(" · ")}</p>
            </li>
          );
        })}
      </ul>
      {data.bias ? <p className="mt-2 text-mute">{data.bias}</p> : null}
    </Fold>
  );
}

function RelationList({ rows, open }: { rows: AnalysisRelation[]; open: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-mute">没有新增关系。</p>;
  return (
    <Fold title={`${rows.length} 条关系`} open={open}>
      <ul className="grid gap-1">
        {rows.map((row) => (
          <li key={row.id}>
            {row.counterparty_zh || row.counterparty} · {row.role}{" "}
            <a href={row.source_url} target="_blank" rel="noreferrer" className="text-blue">
              {host(row.source_url)}
            </a>
          </li>
        ))}
      </ul>
    </Fold>
  );
}

function linksOf(event: JobEvent) {
  return [
    ...((event.data.urls as string[] | undefined) ?? []).map((url) => ({ url, label: host(url) })),
    ...((event.data.archived as ({ url: string; title?: string } | string)[] | undefined) ?? []).map((item) =>
      typeof item === "string" ? { url: item, label: host(item) } : { url: item.url, label: item.title || host(item.url) },
    ),
  ];
}
