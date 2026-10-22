"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// 校准协议的盲标台：一次一条，看不到模型的结论和理由，自己判断后点结论。

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3011";

type Part = { n: number; agree: number; rate: number | null; low: number | null; high: number | null; kappa: number | null };
type Report = {
  thresholds: { min_labels: number; min_lower_bound: number; min_kappa: number; min_per_stratum: number; audit_rate: number };
  overall: Part;
  strata: (Part & { stratum: string; available: number; needed: number; enough: boolean })[];
  confusion: { model: string; human: Record<string, number> }[];
  audit: Part;
  open: number;
  gate: { open: boolean; reasons: string[] };
};
type Item = {
  id: number;
  purpose: "calibration" | "audit";
  person_name: string;
  category: string;
  quote_zh: string;
  quote_en: string;
  source_url: string;
  published_date: string;
  deadline: string;
  evidence_urls: string[];
};

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const HINT: Record<string, string> = {
  已兑现: "到期前（或期限内）承诺的事情发生了",
  部分兑现: "结果明显少于承诺，但有和目标一致的实质成果",
  未兑现: "到期时没有发生，或发生的和承诺的不是一回事",
  证据不足: "期限已过，但查不到能判定结果的可靠资料",
  待定: "还没到期，或这句话本身没法判定",
};

const subscribeNothing = () => () => {};
const readSavedToken = () => sessionStorage.getItem("review-token") ?? "";

export function CalibrationDesk() {
  // The saved token is read from sessionStorage without setting state in an effect (empty on the server).
  const savedToken = useSyncExternalStore(subscribeNothing, readSavedToken, () => "");
  const [draftToken, setToken] = useState<string | null>(null);
  const token = draftToken ?? savedToken;
  const [report, setReport] = useState<Report | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (savedToken) void load(savedToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedToken]);

  async function load(nextToken = token) {
    sessionStorage.setItem("review-token", nextToken);
    const response = await fetch(`${API}/v1/calibration`, { headers: { "x-review-token": nextToken } });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "无法读取校准台");
      return;
    }
    setError("");
    setReport(body.report);
    setItems(body.items);
    setLabels(body.labels);
  }

  async function label(id: number, humanStatus: string) {
    setBusy(true);
    const response = await fetch(`${API}/v1/calibration/${id}`, {
      method: "POST",
      headers: { "x-review-token": token, "content-type": "application/json" },
      body: JSON.stringify({ human_status: humanStatus, note }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.error || "提交失败");
      return;
    }
    setNote("");
    await load();
  }

  async function sample() {
    setBusy(true);
    const response = await fetch(`${API}/v1/calibration/sample`, {
      method: "POST",
      headers: { "x-review-token": token, "content-type": "application/json" },
      body: JSON.stringify({ n: 120 }),
    });
    setBusy(false);
    if (!response.ok) setError((await response.json()).error || "抽样失败");
    await load();
  }

  const item = items[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="password" value={token} aria-label="审核口令" placeholder="审核口令" onChange={(event) => setToken(event.target.value)} />
        <Button onClick={() => load()}>
          <Icon name="arrow-download" />
          读取
        </Button>
        {report ? (
          <Button variant="secondary" disabled={busy} onClick={sample}>
            再抽 120 条
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-mute">{error}</p> : null}

      {report ? (
        <section className="rounded-[14px] bg-card p-5">
          <p className={`text-sm font-semibold ${report.gate.open ? "text-blue" : ""}`}>
            {report.gate.open ? "已达标：机器判定可以自动公开" : "未达标：机器判定需要人审"}
          </p>
          {report.gate.reasons.length ? <p className="mt-1 text-xs leading-5 text-mute">{report.gate.reasons.join("；")}</p> : null}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {[
              ["已标 / 待标", `${report.overall.n} / ${report.open}`],
              ["一致率", pct(report.overall.rate)],
              ["95% 区间", `${pct(report.overall.low)} – ${pct(report.overall.high)}`],
              ["κ", report.overall.kappa?.toFixed(2) ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dd className="num text-[20px] leading-none font-[800]">{v}</dd>
                <dt className="mt-1 text-[11px] text-mute">{k}</dt>
              </div>
            ))}
          </dl>
          <table className="mt-5 w-full text-xs">
            <thead className="text-left text-mute">
              <tr>
                <th className="py-1 font-normal">模型结论</th>
                <th className="py-1 font-normal">已标 / 需要</th>
                <th className="py-1 font-normal">一致率</th>
                {labels.map((l) => (
                  <th key={l} className="py-1 font-normal">
                    人判{l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.strata.map((s) => (
                <tr key={s.stratum} className="border-t border-line">
                  <td className="py-1.5 font-medium">{s.stratum}</td>
                  <td className={`num py-1.5 ${s.enough ? "" : "text-mute"}`}>
                    {s.n} / {s.needed}
                  </td>
                  <td className="num py-1.5">{pct(s.rate)}</td>
                  {labels.map((l) => (
                    <td key={l} className={`num py-1.5 ${l === s.stratum ? "font-semibold" : "text-mute"}`}>
                      {report.confusion.find((c) => c.model === s.stratum)?.human[l] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-5 text-mute">
            门槛：至少 {report.thresholds.min_labels} 条；一致率 95% 区间下界 ≥ {report.thresholds.min_lower_bound * 100}%；κ ≥ {report.thresholds.min_kappa}；
            每类至少 {report.thresholds.min_per_stratum} 条（不足的类全标）。达标后自动生效的判定抽 {report.thresholds.audit_rate * 100}% 复核，最近 100
            条复核下界跌破 90% 自动退回人审。最近复核 {report.audit.n} 条，一致率 {pct(report.audit.rate)}。
          </p>
        </section>
      ) : null}

      {item ? (
        <section className="rounded-[14px] bg-card p-5">
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-mute">
            <span>{item.purpose === "audit" ? "抽检" : "校准"} · 还剩 {report?.open ?? items.length} 条</span>
            <span>
              {item.person_name} · {item.category}
            </span>
            <span className="num">
              {item.published_date} 说 · 期限 {item.deadline}
            </span>
          </p>
          <blockquote className="mt-3 text-lg leading-8 font-semibold">「{item.quote_zh}」</blockquote>
          {item.quote_en && item.quote_en !== item.quote_zh ? <p className="mt-1 text-sm text-mute">{item.quote_en}</p> : null}
          <p className="mt-3 text-xs">
            <a href={item.source_url} target="_blank" rel="noreferrer" className="text-blue">
              出处 · {host(item.source_url)}
            </a>
          </p>
          {item.evidence_urls.length ? (
            <p className="mt-2 text-xs text-mute">
              模型找到的资料（不代表它的结论，自己点开判断）：
              {item.evidence_urls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="ml-2 text-blue">
                  {host(url)}
                </a>
              ))}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {labels.map((l) => (
              <Button key={l} variant="secondary" disabled={busy} title={HINT[l]} onClick={() => label(item.id, l)}>
                {l}
              </Button>
            ))}
          </div>
          <Input className="mt-3" value={note} placeholder="备注（可选）：为什么这么判" onChange={(event) => setNote(event.target.value)} />
          <p className="mt-3 text-[11px] leading-5 text-mute">
            {Object.entries(HINT)
              .map(([k, v]) => `${k}：${v}`)
              .join("；")}
            。看不到模型的结论，是为了让你的判断不受它影响。
          </p>
        </section>
      ) : report ? (
        <p className="text-sm text-mute">没有待标的条目。可以点「再抽 120 条」，或等新的判定。</p>
      ) : null}
    </div>
  );
}
