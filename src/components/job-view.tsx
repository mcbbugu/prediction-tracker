"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3011";

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

export function JobView({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date().toISOString());
  const reduce = useReducedMotion();

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
    if (!job || !ACTIVE.has(job.state)) return;
    const tick = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(tick);
  }, [job]);

  const running = job ? ACTIVE.has(job.state) : true;
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

  return (
    <div className="mx-auto max-w-[760px]">
      <p className="inline-flex items-center gap-1.5 text-sm text-mute">
        <Icon name="sparkle" />
        agent 分析
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        {job?.person_name ?? job?.query ?? "…"}
      </h1>
      <p className="mt-2 text-mute">
        {job?.person_name_en ? `${job.person_name_en} · ` : ""}
        {job?.person_title ?? `查询「${job?.query ?? ""}」`}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-mute">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-sunken px-2 py-0.5 text-ink">
          {running ? <Spinner /> : job?.state === "done" ? <Icon name="checkmark" size={14} /> : <Icon name="alert-circle" size={14} />}
          {running ? "进行中" : job?.state === "done" ? "已完成" : job?.state === "rejected" ? "不在收录范围" : "未完成"}
        </span>
        {job ? <span className="num">用时 {seconds(job.created_at, running ? now : job.updated_at)} 秒</span> : null}
        <span>每一步都是真实执行记录，链接可以点开核对。</span>
      </div>
      {error ? <p className="mt-4 text-sm text-mute">{error}</p> : null}

      <ol className="mt-10">
        <AnimatePresence initial={false}>
          {events.map((event, index) => {
            const live = event.status === "running" && !finished.has(event.id) && running;
            const last = index === events.length - 1 && !(running && events.length === 0);
            return (
              <motion.li
                key={event.id}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="grid grid-cols-[16px_1fr] gap-x-4"
              >
                <TimelineRail last={last}>
                  <StepDot state={live ? "live" : event.status === "running" ? "passed" : event.status} />
                </TimelineRail>
                <div className="pb-6">
                  <p className="text-xs leading-4 text-mute">{event.step}</p>
                  <p className={cn("mt-1 leading-7", event.status === "running" && !live ? "text-mute" : "text-ink")}>{event.message}</p>
                  <EventDetail event={event} />
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {running && events.length === 0 ? (
          <li className="grid grid-cols-[16px_1fr] gap-x-4">
            <TimelineRail last>
              <StepDot state="live" />
            </TimelineRail>
            <p className="pb-6 text-sm leading-4 text-mute">排队中…</p>
          </li>
        ) : null}
      </ol>

      {!running && kept.length > 0 ? (
        <section className="mt-6 rounded-2xl bg-sunken p-5">
          <h2 className="text-lg font-semibold tracking-tight">找到的带期限说法</h2>
          <p className="mt-1 text-sm text-mute">原话都已在存档网页里逐字核对。审核通过前不会出现在公开页面和分数里。</p>
          <ul className="mt-4 space-y-4">
            {kept.map((claim) => (
              <li key={claim.id} className="text-sm leading-6">
                <span className="text-xs text-mute">
                  {claim.domain} · 截止 <span className="num">{claim.deadline}</span>
                </span>
                <span className="mt-0.5 block">{claim.quote}</span>
                <a href={claim.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink">
                  <Icon name="open" size={12} />
                  {host(claim.url)}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/review" className="mt-4 inline-flex items-center gap-1 text-sm text-ink">
            <Icon name="shield-checkmark" size={14} />
            去审核台
          </Link>
        </section>
      ) : null}
    </div>
  );
}

// The rail and the dot share one 16px column, so the line always passes through the dot's center.
function TimelineRail({ last, children }: { last: boolean; children: ReactNode }) {
  return (
    <span className="relative flex justify-center">
      {last ? null : <span className="absolute top-4 bottom-0 left-1/2 w-px -translate-x-1/2 bg-line" aria-hidden />}
      {children}
    </span>
  );
}

function StepDot({ state }: { state: "live" | "passed" | "done" | "failed" | "info" }) {
  if (state === "live") {
    return <span className="relative size-4 animate-spin rounded-full border-[1.5px] border-line border-t-ink bg-white" aria-label="进行中" />;
  }
  return (
    <span
      className={cn(
        "relative grid size-4 place-items-center rounded-full border bg-white",
        state === "failed" ? "border-ink" : "border-line",
      )}
    >
      {state === "failed" ? (
        <Icon name="cancel" size={10} />
      ) : state === "info" ? (
        <span className="size-1 rounded-full bg-mute" />
      ) : (
        <Icon name="checkmark" size={10} className={state === "passed" ? "text-mute" : "text-ink"} />
      )}
    </span>
  );
}

function Spinner() {
  return <span className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-line border-t-ink" aria-label="进行中" />;
}

function EventDetail({ event }: { event: JobEvent }) {
  const [open, setOpen] = useState(false);
  const links = [
    ...((event.data.urls as string[] | undefined) ?? []).map((url) => ({ url, label: host(url) })),
    ...((event.data.archived as ({ url: string; title?: string } | string)[] | undefined) ?? []).map((item) =>
      typeof item === "string" ? { url: item, label: host(item) } : { url: item.url, label: item.title || host(item.url) },
    ),
  ];
  const evidence = (event.data.evidence as { url: string; quote: string }[] | undefined) ?? [];
  const dropped = (event.data.dropped as { quote: string; reason: string }[] | undefined) ?? [];
  if (links.length === 0 && evidence.length === 0 && dropped.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((value) => !value)}
        className="inline-flex cursor-pointer items-center gap-1 text-xs text-mute hover-fine:text-ink"
      >
        <Icon name="chevron-right" size={12} className={cn("transition-transform duration-150", open && "rotate-90")} />
        {open ? "收起" : "展开明细"}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 text-sm">
          {links.map((link, index) => (
            <a key={`${link.url}-${index}`} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-ink">
              <Icon name="open" size={12} className="shrink-0" />
              <span className="truncate">{link.label}</span>
            </a>
          ))}
          {evidence.map((item, index) => (
            <p key={index} className="leading-6">
              “{item.quote}” <span className="text-xs text-mute">· {host(item.url)}</span>
            </p>
          ))}
          {dropped.map((item, index) => (
            <p key={index} className="text-xs leading-5 text-mute">
              丢弃（{item.reason}）：{item.quote.slice(0, 80)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
