import Link from "next/link";
import { Icon } from "@/components/icon";
import { InterestFlow } from "@/components/interest-flow";
import { InterestLedger } from "@/components/interest-ledger";
import { InterestTimeline } from "@/components/interest-timeline";
import { Portrait } from "@/components/portrait";
import { getJson, type Claim, type Interest, type Person, type PersonInterests } from "@/lib/api";
import { isCurrent, loadInterests, orgLabel, stakeOf } from "@/lib/interests";
import { assignClaims, buildMoneyFlow } from "@/lib/money-flow";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJson<{ person: Person }>(`/v1/people/${id}`).catch(() => null);
  return { title: `利益关系 · ${data?.person.name ?? "人物"}` };
}

export default async function InterestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJson<{ person: Person; claims: Claim[]; interests?: PersonInterests }>(`/v1/people/${id}`);
  const fallback = data.interests ?? { status: "not_collected" as const, relations: [] as Interest[] };
  const flow = await loadInterests(id, fallback.relations);
  const claims = new Map(data.claims.map((claim) => [claim.id, claim]));
  const orgs = [...flow.orgs].sort(
    (a, b) =>
      Number(b.relations.some(isCurrent)) - Number(a.relations.some(isCurrent)) || (stakeOf(b) ?? -1) - (stakeOf(a) ?? -1),
  );
  const exposureCount = orgs.reduce((sum, org) => sum + org.exposures.length, 0);
  const relationCount = orgs.reduce((sum, org) => sum + org.relations.length, 0);

  const claimsByOrg = assignClaims(orgs, data.claims, flow.claim_links);
  const split = fallback.status === "collected" ? fallback : null;
  const unrelatedCount = claimsByOrg.get(null)?.length ?? 0;
  const relatedCount = data.claims.length - unrelatedCount;
  const sizedCount = orgs.reduce((sum, org) => sum + org.exposures.filter((e) => e.metric && !(e.metric.kind === "amount_usd" && e.metric.value < 10_000)).length, 0);

  // 现任：the organisations he talks about most, with his first-listed current role there.
  const said = (org: (typeof orgs)[number]) => claimsByOrg.get(org.org_key)?.length ?? 0;
  const roles = orgs
    .filter((org) => org.relations.some((r) => r.kind === "role" && isCurrent(r)))
    .sort((a, b) => said(b) - said(a))
    .slice(0, 3)
    .map((org) => `${orgLabel(org)} ${org.relations.find((r) => r.kind === "role" && isCurrent(r))!.role.split(/[、,，]/)[0]}`);

  // 钱最多从哪来：the flow's top three organisations and their two largest disclosed sources.
  const money = buildMoneyFlow(orgs, data.claims, flow.claim_links, { maxOrgs: 3, maxSources: 8 });
  const topMoney = money.orgs.map((org) => ({
    key: org.id.slice(2),
    label: org.label,
    stake: org.stake,
    from: org.sources
      .filter((s) => s.group !== "depends" && s.metric)
      .slice(0, 2)
      .map((s) => `${s.label} ${s.metric.replace(/ \d{4}$/, "")}`)
      .join("、"),
  }));


  return (
    <div className="pt-6">
      <p className="flex items-center gap-1 text-xs text-mute">
        <Link href={`/p/${id}`} className="no-underline hover-fine:text-ink">
          {data.person.name}
        </Link>
        <Icon name="chevron-right" size={11} />
        <span>利益关系</span>
      </p>
      <section className="mt-3 rounded-[18px] bg-card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <Portrait person={data.person} riso className="w-[64px] shrink-0 !rounded-[12px]" />
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-[900] tracking-tight">{data.person.name}的利益版图</h1>
            {roles.length ? <p className="mt-0.5 text-sm text-mute">现任：{roles.join(" · ")}</p> : null}
          </div>
        </div>

        <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-[1fr_1fr_1.4fr]">
          {[
            { label: "关于自家公司的话", part: split?.related ?? null, count: relatedCount },
            { label: "其他话题", part: split?.unrelated ?? null, count: unrelatedCount },
          ].map(({ label, part, count }) => (
            <div key={label}>
              <p className="text-xs text-mute">{label}</p>
              {part?.value != null ? (
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="display-num text-[34px] leading-none font-[800]">{part.value.toFixed(0)}</span>
                  <span className="num text-xs text-mute">
                    兑现率 · 区间 {part.low}–{part.high}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-[22px] leading-[34px] font-[800] text-mute">{count ? "样本不足" : "—"}</p>
              )}
              <p className="num mt-1 text-xs text-mute">
                {count} 句{part?.n ? ` · ${part.n} 句已判定` : count ? " · 还没有已判定的" : ""}
              </p>
            </div>
          ))}
          <div>
            <p className="text-xs text-mute">钱最多从哪来</p>
            {topMoney.length ? (
              <ul className="mt-1.5 space-y-1 text-sm">
                {topMoney.map((item) => (
                  <li key={item.label} className="truncate">
                    <a href={`#org-${item.key}`} className="font-semibold text-ink no-underline hover-fine:text-blue">
                      {item.label}
                    </a>
                    {item.stake ? <span className="num ml-1.5 text-xs text-blue">持股 {item.stake}%</span> : null}
                    {item.from ? <span className="ml-1.5 text-xs text-mute">← {item.from}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-mute">还没有采到</p>
            )}
          </div>
        </div>

        <p className="num mt-5 border-t border-line pt-3 text-[11px] text-mute">
          {orgs.length} 家机构 · {relationCount} 段关系
          {flow.layered ? ` · ${exposureCount} 项对外敞口（${sizedCount} 项有规模数字）` : " · 对外敞口采集中"}
          {split ? "" : " · 利益相关与无关的兑现率还没有算出"}
        </p>
      </section>

      <section className="mt-6 rounded-[18px] bg-card p-5">
        <InterestFlow personName={data.person.name} orgs={orgs} claims={data.claims.map(({ id, status }) => ({ id, status }))} claimLinks={flow.claim_links} maxOrgs={12} maxSources={8} />
      </section>

      <section id="timeline" className="mt-8 scroll-mt-24">
        <h2 className="text-[15px] font-bold">时间线</h2>
        <p className="mt-0.5 text-xs text-mute">他说每句话的时候，在哪家机构任职、持股</p>
        <div className="mt-3">
          <InterestTimeline personId={id} orgs={orgs} claimsByOrg={claimsByOrg} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-bold">全部关系</h2>
        <div className="mt-3">
          <InterestLedger personId={id} orgs={orgs} claimLinks={flow.claim_links} claims={claims} />
        </div>
        {!flow.layered ? (
          <p className="mt-3 px-1 text-[11px] text-mute">机构对外的营收、合同和投资正在采集；采到后会出现在每家机构下面和上方的流向图里。</p>
        ) : null}
      </section>
    </div>
  );
}
