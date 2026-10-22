"use client";

import { useMemo, useState } from "react";
import type { ClaimLink, Org } from "@/lib/interests";
import { buildMoneyFlow, GROUP_LABEL, usd, type SourceGroup } from "@/lib/money-flow";

// 利益版图：钱从哪来 → 经过哪家公司 → 他 → 他说了什么.
// Money is ultramarine, words are ink. Live ties carry slowly moving dots; ended ties are not drawn.

const W = 960;
const SRC_X = 236; // source glyphs; labels end left of it
const ORG_X = 360;
const ORG_W = 150;
const PERSON_X = 640;
const PERSON_W = 8;
const CLAIM_X = 716;
const CLAIM_W = W - CLAIM_X - 4;
const TOP = 30;

type Edge = {
  id: string;
  a: string;
  b: string;
  d: string;
  width: number;
  tone: "money" | "words" | "quiet" | "depends";
  known: boolean;
  live: boolean;
  tip: string;
};

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

function Glyph({ group, x, y }: { group: SourceGroup; x: number; y: number }) {
  if (group === "market") return <circle cx={x} cy={y} r={3.6} className="fill-blue" />;
  if (group === "contract") return <rect x={x - 3.2} y={y - 3.2} width={6.4} height={6.4} className="fill-blue" />;
  if (group === "capital") return <rect x={x - 3} y={y - 3} width={6} height={6} transform={`rotate(45 ${x} ${y})`} className="fill-blue" />;
  return <circle cx={x} cy={y} r={3.2} fill="none" strokeWidth={1.3} className="stroke-mute" />;
}

export function InterestFlow({
  personName,
  orgs,
  claims = [],
  claimLinks = [],
  compact = false,
  maxOrgs = 8,
  maxSources = 6,
}: {
  personName: string;
  orgs: Org[];
  claims?: { id: string; status: string }[];
  claimLinks?: ClaimLink[];
  compact?: boolean;
  maxOrgs?: number;
  maxSources?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const flow = useMemo(() => buildMoneyFlow(orgs, claims, claimLinks, { maxOrgs, maxSources }), [orgs, claims, claimLinks, maxOrgs, maxSources]);

  const layout = useMemo(() => {
    const rowH = compact ? 22 : 26;
    const gap = compact ? 12 : 18;
    const nodes = new Map<string, { tip: string }>();
    const edges: Edge[] = [];
    const sourceRows: { id: string; y: number; group: SourceGroup; label: string; metric: string; live: boolean; verified: boolean }[] = [];
    const moreRows: { key: string; y: number; text: string }[] = [];
    const orgBoxes: { id: string; y: number; h: number; label: string; sub: string; est: string }[] = [];

    // Column 1 and 2: each organisation owns a block of source rows.
    let y = TOP;
    const maxEst = Math.max(0, ...flow.orgs.map((o) => o.estimate?.usd ?? 0));
    for (const org of flow.orgs) {
      const rows = Math.max(2, org.sources.length + (org.hidden ? 1 : 0));
      const h = rows * rowH;
      orgBoxes.push({ id: org.id, y, h, label: org.label, sub: org.sub, est: org.estimate ? `约 ${usd(org.estimate.usd)}/年 · 推算` : "" });
      nodes.set(org.id, {
        tip: org.estimate
          ? `归他名下约 ${usd(org.estimate.usd)}/年（推算）\n${org.estimate.formula}`
          : `${org.label}：${org.sub || "任职"}\n公司营收待采集，暂不能推算归他名下的钱`,
      });
      org.sources.forEach((source, index) => {
        const sy = y + rowH * (index + 0.5) + (rows - org.sources.length - (org.hidden ? 1 : 0)) * rowH * 0.5;
        sourceRows.push({ id: source.id, y: sy, group: source.group, label: source.label, metric: source.metric, live: source.current, verified: source.verified });
        nodes.set(source.id, {
          tip: [
            `${GROUP_LABEL[source.group]} · ${source.label}`,
            ...source.details.slice(0, 5),
            source.details.length > 5 ? `…另 ${source.details.length - 5} 条` : "",
            source.estimate ? `归他名下约 ${usd(source.estimate.usd)}/年（推算：${source.estimate.formula}）` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        });
        const depends = source.group === "depends";
        const width = source.share != null && !depends ? 1.5 + source.share * 16 : 1.4;
        const oy = y + 10 + ((index + 0.5) / Math.max(1, org.sources.length)) * (h - 20);
        // Dependencies: the money leaves the organisation, so the line runs org → supplier.
        edges.push({
          id: `e:${source.id}`,
          a: source.id,
          b: org.id,
          d: depends ? curve(ORG_X, oy, SRC_X + 6, sy) : curve(SRC_X + 6, sy, ORG_X, oy),
          width,
          tone: depends ? "depends" : "money",
          known: source.share != null,
          live: source.current && !depends,
          tip: "",
        });
      });
      if (org.hidden) moreRows.push({ key: org.id, y: y + h - rowH * 0.5, text: `另 ${org.hidden} 项，见详情页` });
      y += h + gap;
    }
    const bottom = Math.max(y - gap, TOP + 80);

    // Column 3: the person — a short bar where the money converges and the words leave.
    const toPerson = flow.orgs.map((org) => ({ org, width: org.estimate && maxEst > 0 ? 2 + (org.estimate.usd / maxEst) * 18 : 2 }));
    const inTotal = toPerson.reduce((sum, item) => sum + item.width + 3, 0);
    const maxCount = Math.max(1, ...flow.claims.map((c) => c.count));
    const outWidths = flow.claims.map((c) => 2 + (c.count / maxCount) * 14);
    const outTotal = outWidths.reduce((sum, w) => sum + w + 3, 0);
    const claimH = compact ? 40 : 46;
    const claimsTotal = flow.claims.length * (claimH + 10) - 10;
    const mid = Math.max((TOP + bottom) / 2, TOP + claimsTotal / 2);
    const barH = Math.max(inTotal, outTotal, 48) + 16;
    const personTop = mid - barH / 2;
    let py = mid - inTotal / 2;
    for (const { org, width } of toPerson) {
      const box = orgBoxes.find((b) => b.id === org.id)!;
      edges.push({
        id: `e:${org.id}:person`,
        a: org.id,
        b: "person",
        d: curve(ORG_X + ORG_W, box.y + box.h / 2, PERSON_X, py + width / 2),
        width,
        tone: "money",
        known: Boolean(org.estimate),
        live: true,
        tip: "",
      });
      py += width + 3;
    }

    // Money between his own companies.
    for (const tie of flow.inter) {
      const from = orgBoxes.find((b) => b.id === tie.from);
      const to = orgBoxes.find((b) => b.id === tie.to);
      if (!from || !to) continue;
      const y1 = from.y + from.h * 0.7;
      const y2 = to.y + to.h * 0.3;
      const bulge = ORG_X + ORG_W + 26 + Math.min(40, Math.abs(y2 - y1) / 8);
      edges.push({
        id: `i:${tie.from}>${tie.to}`,
        a: tie.from,
        b: tie.to,
        d: `M${ORG_X + ORG_W} ${y1} C${bulge} ${y1} ${bulge} ${y2} ${ORG_X + ORG_W + 4} ${y2}`,
        width: 1.4,
        tone: "money",
        known: tie.known,
        live: true,
        tip: `${from.label} → ${to.label}：${tie.label}`,
      });
    }

    // Column 4: what he said, grouped by the organisation it touches, stacked around the person.
    let oy = mid - outTotal / 2;
    let cy = mid - claimsTotal / 2;
    const claimBoxes = flow.claims.map((group, index) => {
      const width = outWidths[index];
      nodes.set(group.id, {
        tip: `${group.label}：${group.count} 句\n已兑现或部分兑现 ${group.fulfilled} · 未兑现 ${group.failed} · 其余待定或证据不足`,
      });
      edges.push({
        id: `e:person:${group.id}`,
        a: "person",
        b: group.id,
        d: curve(PERSON_X + PERSON_W, oy + width / 2, CLAIM_X, cy + claimH / 2),
        width,
        tone: group.id === "c:unrelated" ? "quiet" : "words",
        known: true,
        live: true,
        tip: "",
      });
      oy += width + 3;
      const box = { ...group, y: cy, h: claimH };
      cy += claimH + 10;
      return box;
    });
    nodes.set("person", { tip: `${personName}\n左边流进来的是钱，右边流出去的是他公开说的话` });

    const height = Math.max(bottom, mid + claimsTotal / 2, personTop + barH + 26) + 8;
    return { edges, nodes, sourceRows, moreRows, orgBoxes, claimBoxes, height, personTop, personBottom: personTop + barH };
  }, [flow, compact, personName]);

  // Hovering lights the whole path through a node: sources → company → him → what he said about it.
  const lit = useMemo(() => {
    if (!active) return null;
    const on = new Set<string>([active]);
    const orgOf = (id: string) => flow.orgs.find((o) => o.id === id || o.sources.some((s) => s.id === id));
    const claimOf = (orgId: string) => flow.claims.find((c) => c.orgId === orgId)?.id;
    if (active === "person") return null;
    const add = (orgId: string, withSources: boolean) => {
      on.add(orgId).add("person");
      const claim = claimOf(orgId);
      if (claim) on.add(claim);
      if (withSources) flow.orgs.find((o) => o.id === orgId)?.sources.forEach((s) => on.add(s.id));
    };
    if (active.startsWith("s:")) add(orgOf(active)!.id, false);
    else if (active.startsWith("o:")) {
      add(active, true);
      for (const tie of flow.inter) {
        if (tie.from === active) on.add(tie.to);
        if (tie.to === active) on.add(tie.from);
      }
    } else if (active.startsWith("c:")) {
      on.add("person");
      const group = flow.claims.find((c) => c.id === active);
      if (group?.orgId) add(group.orgId, true);
    }
    return on;
  }, [active, flow]);

  if (flow.orgs.length === 0) return <p className="text-xs text-mute">还没有采集到仍在进行的利益关系。</p>;

  const isOn = (id: string) => !lit || lit.has(id);
  const edgeOn = (edge: Edge) => !lit || (lit.has(edge.a) && lit.has(edge.b));
  const tip = active ? (layout.nodes.get(active)?.tip ?? layout.edges.find((e) => e.id === active)?.tip) : null;
  const hover = (id: string) => ({ onPointerEnter: () => setActive(id), onPointerLeave: () => setActive(null) });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${layout.height}`} className="block w-full select-none" role="img" aria-label={`${personName}的利益版图：钱从哪来，经过哪家公司，流到他身上，再变成他说的话`}>
        <style>{`
          @keyframes mf-dense { to { stroke-dashoffset: -24; } }
          @keyframes mf-sparse { to { stroke-dashoffset: -44; } }
          .mf-dot { stroke-linecap: round; fill: none; pointer-events: none; }
          .mf-dense { stroke-dasharray: 0.01 24; animation: mf-dense 1.5s linear infinite; }
          .mf-sparse { stroke-dasharray: 0.01 44; animation: mf-sparse 2.75s linear infinite; }
          .mf-edge, .mf-node { transition: opacity 180ms ease; }
          @media (prefers-reduced-motion: reduce) { .mf-dot { display: none; } }
        `}</style>

        <g className="fill-mute text-[11px]">
          <text x={SRC_X + 4} y={12} textAnchor="end">钱从哪来</text>
          <text x={ORG_X} y={12}>经过哪家公司</text>
          <text x={PERSON_X + PERSON_W / 2} y={12} textAnchor="middle">他</text>
          <text x={CLAIM_X} y={12}>他说了什么</text>
        </g>

        {/* Lines first, so nodes sit on top. */}
        {layout.edges.map((edge, index) => {
          const on = edgeOn(edge);
          const color = edge.tone === "money" ? "stroke-blue" : edge.tone === "words" ? "stroke-ink" : "stroke-mute";
          const base = edge.tone === "depends" ? 0.35 : edge.tone === "money" ? (edge.known ? 0.28 : 0.4) : edge.tone === "words" ? 0.16 : 0.22;
          const dots = edge.live && edge.tone !== "depends";
          const dense = edge.width >= 5;
          return (
            <g key={edge.id} className="mf-edge" style={{ opacity: on ? 1 : 0.12 }} {...(edge.tip ? hover(edge.id) : {})}>
              <path
                d={edge.d}
                fill="none"
                className={color}
                strokeOpacity={base}
                strokeWidth={edge.width}
                strokeDasharray={edge.known ? undefined : "3 3"}
              />
              {edge.id.startsWith("i:") ? <path d={edge.d} fill="none" stroke="transparent" strokeWidth={10} /> : null}
              {dots ? (
                <path
                  d={edge.d}
                  className={`mf-dot ${color} ${dense ? "mf-dense" : "mf-sparse"}`}
                  strokeOpacity={edge.tone === "quiet" ? 0.5 : 0.85}
                  strokeWidth={Math.max(2.4, Math.min(edge.width * 0.55, 5))}
                  style={{ animationDelay: `${-((index * 0.37) % 2.75)}s` }}
                />
              ) : null}
            </g>
          );
        })}

        {/* Column 1: where the money comes from (and, hollow, what he depends on). */}
        {layout.sourceRows.map((row) => (
          <g key={row.id} className="mf-node cursor-default" style={{ opacity: isOn(row.id) ? 1 : 0.25 }} {...hover(row.id)}>
            <rect x={0} y={row.y - 11} width={SRC_X + 8} height={22} fill="transparent" />
            <Glyph group={row.group} x={SRC_X} y={row.y} />
            <text x={SRC_X - 10} y={row.y} dy="0.35em" textAnchor="end" className="text-[12px]">
              {row.metric ? <tspan className={`fill-mute text-[11px] ${row.verified ? "" : "italic opacity-70"}`}>{row.metric}　</tspan> : null}
              <tspan className={row.group === "depends" ? "fill-mute" : "fill-ink font-medium"}>{row.label.length > 14 ? `${row.label.slice(0, 13)}…` : row.label}</tspan>
            </text>
          </g>
        ))}
        {layout.moreRows.map((row) => (
          <text key={row.key} x={SRC_X - 10} y={row.y} dy="0.35em" textAnchor="end" className="fill-mute text-[11px]">
            {row.text}
          </text>
        ))}

        {/* Column 2: his companies. */}
        {layout.orgBoxes.map((box) => (
          <g key={box.id} className="mf-node cursor-default" style={{ opacity: isOn(box.id) ? 1 : 0.3 }} {...hover(box.id)}>
            <rect x={ORG_X} y={box.y} width={ORG_W} height={box.h} rx={8} className="fill-sunken" />
            <rect x={ORG_X} y={box.y} width={3} height={box.h} className="fill-blue" />
            <text x={ORG_X + 14} y={box.y + 20} className="fill-ink text-[14px] font-semibold">
              {box.label.length > 9 ? `${box.label.slice(0, 8)}…` : box.label}
            </text>
            <text x={ORG_X + 14} y={box.y + 37} className="fill-mute text-[11px]">
              {box.sub.length > 12 ? `${box.sub.slice(0, 11)}…` : box.sub}
            </text>
            {box.est && box.h > 56 ? (
              <text x={ORG_X + 14} y={box.y + 53} className="fill-blue text-[11px] font-medium">
                {box.est}
              </text>
            ) : null}
          </g>
        ))}

        {/* Column 3: him. */}
        <g className="mf-node cursor-default" {...hover("person")}>
          <rect x={PERSON_X} y={layout.personTop} width={PERSON_W} height={layout.personBottom - layout.personTop} rx={4} className="fill-ink" />
          <text x={PERSON_X + PERSON_W / 2} y={layout.personBottom + 18} textAnchor="middle" className="fill-ink text-[13px] font-semibold">
            {personName}
          </text>
        </g>

        {/* Column 4: what he said. */}
        {layout.claimBoxes.map((box) => {
          const quiet = box.id === "c:unrelated";
          return (
            <g key={box.id} className="mf-node cursor-default" style={{ opacity: isOn(box.id) ? 1 : 0.3 }} {...hover(box.id)}>
              <rect x={CLAIM_X} y={box.y} width={CLAIM_W} height={box.h} rx={8} className={quiet ? "fill-sunken" : "fill-ink"} />
              <text x={CLAIM_X + 12} y={box.y + box.h / 2 - 7} dy="0.35em" className={`text-[13px] font-semibold ${quiet ? "fill-mute" : "fill-white"}`}>
                {box.label}
              </text>
              <text x={CLAIM_X + 12} y={box.y + box.h / 2 + 9} dy="0.35em" className={`text-[11px] ${quiet ? "fill-mute" : "fill-white/70"}`}>
                已兑现 {box.fulfilled} · 未兑现 {box.failed}
              </text>
              <text x={CLAIM_X + CLAIM_W - 12} y={box.y + box.h / 2} dy="0.35em" textAnchor="end" className={`num text-[18px] font-[800] ${quiet ? "fill-mute" : "fill-white"}`}>
                {box.count}
                <tspan className="text-[11px] font-normal"> 句</tspan>
              </text>
            </g>
          );
        })}
      </svg>

      {tip ? (
        <p className="pointer-events-none absolute top-6 right-2 max-w-[300px] rounded-lg bg-ink px-3 py-2 text-[11px] leading-5 whitespace-pre-line text-white shadow-lg">{tip}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mute">
        {(["market", "contract", "capital", "depends"] as const).map((group) => (
          <span key={group} className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <Glyph group={group} x={5} y={5} />
            </svg>
            {GROUP_LABEL[group]}
          </span>
        ))}
        <span>群青是钱，黑色是他的话；虚线表示规模未公开；光点表示仍在进行；斜体数字来自网页抓取，未经核验</span>
      </div>
      {!compact ? (
        <p className="mt-1 text-[11px] text-mute">
          {flow.hasRevenue
            ? "机构之间的线宽按「推算」的归他名下营收比较（持股 × 营收 × 占比），悬停看算式。"
            : "机构营收还在采集，暂不能推算归他名下的钱；目前只有同一机构内部的线宽按披露占比画。"}
          {flow.minor.length ? ` 其他仍在进行、但还没有对外敞口或相关主张的：${flow.minor.slice(0, 8).join("、")}${flow.minor.length > 8 ? " 等" : ""}。` : ""}
          {flow.past.length ? ` 已结束的关系不进流向：${flow.past.slice(0, 8).join("、")}${flow.past.length > 8 ? " 等" : ""}。` : ""}
        </p>
      ) : null}
    </div>
  );
}
