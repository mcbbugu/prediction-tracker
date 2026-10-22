"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";
import { PUBLIC_API_URL } from "@/lib/api";

type Proposal = {
  id: string;
  person_id: string;
  person_name: string;
  category: string;
  quote_zh: string;
  quote_en: string;
  source_url: string;
  published_date: string;
  deadline: string;
  status: string;
  rationale: string;
  actual_result: string;
  provenance: string;
  evidence: { url: string }[];
};

type Verdict = {
  id: number;
  claim_id: string;
  person_id: string;
  person_name: string;
  category: string;
  quote_zh: string;
  quote_en: string;
  source_url: string;
  deadline: string;
  current_status: string;
  status: string;
  actual_result: string;
  rationale: string;
  evidence: { url: string; quote: string; fetched_at?: string }[];
  rejected_evidence: { url: string; quote: string; reason: string }[];
};

type Run = {
  id: string;
  step: string;
  status: string;
  created_at: string;
  detail: { reason?: string; missing?: string[] };
};

const STATUSES = ["已兑现", "部分兑现", "未兑现", "待定", "证据不足"];
const JUDGED = new Set(["已兑现", "部分兑现", "未兑现"]);
const API = PUBLIC_API_URL;

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const subscribeNothing = () => () => {};
const readSavedToken = () => sessionStorage.getItem("review-token") ?? "";

export function ReviewDesk() {
  // The saved token is read from sessionStorage without setting state in an effect (empty on the server).
  const savedToken = useSyncExternalStore(subscribeNothing, readSavedToken, () => "");
  const [draftToken, setToken] = useState<string | null>(null);
  const token = draftToken ?? savedToken;
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("all");

  useEffect(() => {
    if (savedToken) void load(savedToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedToken]);

  async function load(nextToken = token) {
    sessionStorage.setItem("review-token", nextToken);
    const response = await fetch(`${API}/v1/review`, { headers: { "x-review-token": nextToken } });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "无法读取审核台");
      setProposals([]);
      setVerdicts([]);
      setRuns([]);
      return;
    }
    setError("");
    setProposals(body.proposals);
    setVerdicts(body.verdicts ?? []);
    setRuns(body.runs);
  }

  function fail(message: string) {
    setNotice(message);
    setOpen(true);
  }

  async function act(id: string, action: "publish" | "return" | "insufficient") {
    const response = await fetch(`${API}/v1/review/${id}/${action}`, {
      method: "POST",
      headers: { "x-review-token": token },
    });
    const body = await response.json();
    if (!response.ok) return fail(body.error || "动作没有完成");
    setProposals((list) => list.filter((item) => item.id !== id));
  }

  async function decide(id: number, action: "accept" | "reject") {
    const response = await fetch(`${API}/v1/verdicts/${id}/${action}`, {
      method: "POST",
      headers: { "x-review-token": token, "content-type": "application/json" },
      body: "{}",
    });
    const body = await response.json();
    if (!response.ok) return fail(body.error || "动作没有完成");
    setVerdicts((list) => list.filter((item) => item.id !== id));
  }

  async function edit(id: string, patch: { status?: string; actual_result?: string; evidence_urls?: string[] }) {
    const response = await fetch(`${API}/v1/review/${id}`, {
      method: "PATCH",
      headers: { "x-review-token": token, "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json();
    if (!response.ok) return fail(body.error || "修改没有保存");
    setProposals((list) => list.map((item) => (item.id === id ? { ...item, ...body.claim } : item)));
  }

  const people = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const item of proposals) {
      const entry = map.get(item.person_id) ?? { name: item.person_name, count: 0 };
      entry.count += 1;
      map.set(item.person_id, entry);
    }
    return [...map.entries()];
  }, [proposals]);

  const visible = person === "all" ? proposals : proposals.filter((item) => item.person_id === person);

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[1fr_280px]">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="password"
            value={token}
            aria-label="审核口令"
            placeholder="审核口令"
            onChange={(event) => setToken(event.target.value)}
          />
          <Button onClick={() => load()}>
            <Icon name="arrow-download" />
            读取提案
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-mute">{error}</p> : null}

        {verdicts.length > 0 ? (
          <section className="mt-8">
            <h2 className="inline-flex items-center gap-1.5 text-lg font-semibold tracking-tight">
              <Icon name="shield-checkmark" />
              到期判定 {verdicts.length}
            </h2>
            <p className="mt-1 text-sm text-mute">
              agent 搜到网页后，由程序自己打开并存档，判定只依据存档原文。下面每条证据都已核对过确实出现在原文里。
            </p>
            {verdicts.map((verdict) => (
              <VerdictCard key={verdict.id} verdict={verdict} onDecide={decide} />
            ))}
          </section>
        ) : null}

        {proposals.length > 0 ? (
          <h2 className="mt-10 inline-flex items-center gap-1.5 text-lg font-semibold tracking-tight">
            <Icon name="quote" />
            待发布主张 {proposals.length}
          </h2>
        ) : null}

        {people.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant={person === "all" ? "primary" : "secondary"} className="h-8 px-3" onClick={() => setPerson("all")}>
              全部 {proposals.length}
            </Button>
            {people.map(([id, entry]) => (
              <Button
                key={id}
                variant={person === id ? "primary" : "secondary"}
                className="h-8 px-3"
                onClick={() => setPerson(id)}
              >
                {entry.name} {entry.count}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-6">
          {visible.length === 0 ? <p className="text-sm text-mute">没有待发布提案。</p> : null}
          {visible.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} onAct={act} onEdit={edit} />
          ))}
        </div>
      </div>
      <aside>
        <h2 className="inline-flex items-center gap-1.5 border-b border-line pb-2 text-sm text-mute">
          <Icon name="history" />
          运行记录
        </h2>
        <ol className="mt-4">
          {runs.map((run) => (
            <li key={run.id} className="border-b border-line py-3 text-sm">
              <b className="block">{run.step}</b>
              <span className="text-mute">
                {run.status}
                {run.detail?.reason ? ` · ${run.detail.reason}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </aside>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="没有完成">{notice}</DialogContent>
      </Dialog>
    </div>
  );
}

function VerdictCard({
  verdict,
  onDecide,
}: {
  verdict: Verdict;
  onDecide: (id: number, action: "accept" | "reject") => void;
}) {
  return (
    <article className="border-t border-line py-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-mute">
        <span>{verdict.person_name}</span>
        <span>{verdict.category}</span>
        <span className="num">截止 {verdict.deadline}</span>
        <span className="inline-flex items-center gap-1">
          <StatusPill status={verdict.current_status} />
          <Icon name="arrow-right" size={12} />
          <StatusPill status={verdict.status} />
        </span>
      </div>
      <p className="mt-3 text-[17px] leading-7">{verdict.quote_zh}</p>
      <p className="mt-1 text-sm leading-6 text-mute">“{verdict.quote_en}”</p>
      <div className="mt-4 rounded-xl bg-sunken p-4">
        <p className="text-xs text-mute">实际结果</p>
        <p className="mt-1 text-sm leading-6">{verdict.actual_result || "—"}</p>
        <p className="mt-3 text-xs text-mute">理由</p>
        <p className="mt-1 text-sm leading-6">{verdict.rationale || "—"}</p>
        <p className="mt-3 text-xs text-mute">证据（原文摘句）</p>
        {verdict.evidence.length === 0 ? <p className="mt-1 text-sm text-mute">没有通过原文核对的证据。</p> : null}
        <ul className="mt-1 space-y-3">
          {verdict.evidence.map((item, index) => (
            <li key={`${item.url}-${index}`} className="text-sm leading-6">
              <span className="block">“{item.quote}”</span>
              <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink">
                <Icon name="open" size={12} />
                {host(item.url)}
              </a>
            </li>
          ))}
        </ul>
        {verdict.rejected_evidence.length > 0 ? (
          <p className="mt-3 text-xs text-mute">另有 {verdict.rejected_evidence.length} 条模型引用在原文里找不到，已丢弃。</p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={() => onDecide(verdict.id, "accept")}>
          <Icon name="checkmark" />
          采纳判定
        </Button>
        <Button variant="secondary" onClick={() => onDecide(verdict.id, "reject")}>
          <Icon name="cancel" />
          驳回
        </Button>
      </div>
    </article>
  );
}

function ProposalCard({
  proposal,
  onAct,
  onEdit,
}: {
  proposal: Proposal;
  onAct: (id: string, action: "publish" | "return" | "insufficient") => void;
  onEdit: (id: string, patch: { status?: string; actual_result?: string; evidence_urls?: string[] }) => void;
}) {
  const [result, setResult] = useState(proposal.actual_result);
  const [evidence, setEvidence] = useState(proposal.evidence.map((item) => item.url).join("\n"));
  const dirty =
    result !== proposal.actual_result || evidence.trim() !== proposal.evidence.map((item) => item.url).join("\n");
  const missingEvidence = JUDGED.has(proposal.status) && proposal.evidence.length === 0;

  return (
    <article className="border-t border-line py-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-mute">
        <StatusPill status={proposal.status} />
        <span>{proposal.person_name}</span>
        <span>{proposal.category}</span>
        <span className="num">
          {proposal.published_date} → 截止 {proposal.deadline}
        </span>
        <span className="rounded-md border border-line px-1.5 py-0.5">
          {proposal.provenance === "manual" ? "人工整理" : "agent 提案"}
        </span>
      </div>
      <p className="mt-3 text-[17px] leading-7">{proposal.quote_zh}</p>
      <p className="mt-1 text-sm leading-6 text-mute">“{proposal.quote_en}”</p>
      <a
        href={proposal.source_url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-sm text-ink"
      >
        <Icon name="open" size={14} />
        出处 · {host(proposal.source_url)}
      </a>

      <div className="mt-4 rounded-xl bg-sunken p-4">
        <p className="text-xs text-mute">判定</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <Button
              key={status}
              variant={proposal.status === status ? "primary" : "secondary"}
              className="h-8 px-3"
              onClick={() => status !== proposal.status && onEdit(proposal.id, { status })}
            >
              {status}
            </Button>
          ))}
        </div>
        <label className="mt-4 block text-xs text-mute" htmlFor={`result-${proposal.id}`}>
          实际结果
        </label>
        <textarea
          id={`result-${proposal.id}`}
          value={result}
          onChange={(event) => setResult(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-ink"
        />
        <label className="mt-3 block text-xs text-mute" htmlFor={`evidence-${proposal.id}`}>
          证据链接（一行一个）
        </label>
        <textarea
          id={`evidence-${proposal.id}`}
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          rows={Math.max(2, proposal.evidence.length)}
          className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-xs leading-6 text-ink outline-none focus:border-ink"
        />
        {proposal.evidence.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-3">
            {proposal.evidence.map((item) => (
              <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink">
                <Icon name="open" size={12} />
                {host(item.url)}
              </a>
            ))}
          </div>
        ) : null}
        {dirty ? (
          <Button
            variant="secondary"
            className="mt-3 h-8 px-3"
            onClick={() =>
              onEdit(proposal.id, {
                actual_result: result,
                evidence_urls: evidence.split(/\s+/).filter(Boolean),
              })
            }
          >
            <Icon name="checkmark" />
            保存修改
          </Button>
        ) : null}
      </div>

      <p className={cn("mt-3 text-sm", missingEvidence ? "text-ink" : "text-mute")}>
        {missingEvidence ? "已判定但没有证据链接，补上证据后才能发布。" : proposal.rationale}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={() => onAct(proposal.id, "publish")} disabled={dirty || missingEvidence}>
          <Icon name="checkmark" />
          发布
        </Button>
        <Button variant="secondary" onClick={() => onAct(proposal.id, "return")}>
          <Icon name="arrow-undo" />
          退回
        </Button>
        <Button variant="secondary" onClick={() => onAct(proposal.id, "insufficient")}>
          <Icon name="alert-circle" />
          标为证据不足
        </Button>
      </div>
    </article>
  );
}
