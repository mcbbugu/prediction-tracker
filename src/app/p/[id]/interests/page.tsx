import Link from "next/link";
import { Icon } from "@/components/icon";
import { InterestFlow } from "@/components/interest-flow";
import { InterestLedger } from "@/components/interest-ledger";
import { InterestTimeline } from "@/components/interest-timeline";
import { Portrait } from "@/components/portrait";
import { getJson, type Claim, type Interest, type Person, type PersonInterests } from "@/lib/api";
import { isCurrent, loadInterests, stakeOf } from "@/lib/interests";
import { assignClaims } from "@/lib/money-flow";

export const dynamic = "force-dynamic";

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
  const linkedClaims = new Set(flow.claim_links.map((link) => link.claim_id));

  const claimsByOrg = assignClaims(orgs, data.claims, flow.claim_links);

  return (
    <div className="pt-6">
      <p className="flex items-center gap-1 text-xs text-mute">
        <Link href={`/p/${id}`} className="no-underline hover-fine:text-ink">
          {data.person.name}
        </Link>
        <Icon name="chevron-right" size={11} />
        <span>利益关系</span>
      </p>
      <section className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[18px] bg-card p-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Portrait person={data.person} riso className="w-[64px] shrink-0 !rounded-[12px]" />
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-[900] tracking-tight">{data.person.name}的利益版图</h1>
            <p className="text-sm text-mute">公开可核查的任职、持股、交易，以及这些机构对外的地域、工厂、供应链和合作敞口</p>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-x-6">
          {[
            ["机构", orgs.length],
            ["关系", relationCount],
            ["对外敞口", flow.layered ? exposureCount : "采集中"],
            ["关联主张", flow.layered ? linkedClaims.size : "采集中"],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dd className="display-num text-[24px] leading-none font-[800]">{value}</dd>
              <dt className="mt-1 text-[11px] whitespace-nowrap text-mute">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6 rounded-[18px] bg-card p-5">
        <InterestFlow personName={data.person.name} orgs={orgs} claims={data.claims.map(({ id, status }) => ({ id, status }))} claimLinks={flow.claim_links} maxOrgs={12} maxSources={8} />
      </section>

      <section className="mt-8">
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
