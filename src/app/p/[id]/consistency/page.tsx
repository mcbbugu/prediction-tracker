import Link from "next/link";
import { Icon } from "@/components/icon";
import { getJson, type Person } from "@/lib/api";

export const dynamic = "force-dynamic";

type Side = { quote?: string; quote_zh?: string; date?: string; url?: string };
type Pair = {
  id: string;
  topic: string;
  kind: string;
  domain: string;
  label: string;
  verdict_tier: string;
  rationale: string;
  a: Side;
  b: Side;
  explanation: Side | null;
};

const KIND: Record<string, string> = { reversal: "前后翻转", reaffirm: "前后重申", walk: "言行对照" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJson<{ person: Person }>(`/v1/people/${id}`).catch(() => null);
  return { title: `可信度 · ${data?.person.name ?? "人物"}` };
}

function Quote({ side }: { side: Side | null }) {
  if (!side) return null;
  return (
    <p className="mt-1 text-sm">
      <span className="text-mute">{side.date} </span>
      {side.quote_zh || side.quote}
      {side.url ? (
        <>
          {" "}
          <a href={side.url} target="_blank" rel="noreferrer" className="text-mute hover-fine:text-blue">
            出处
          </a>
        </>
      ) : null}
    </p>
  );
}

export default async function ConsistencyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string; label?: string }>;
}) {
  const { id } = await params;
  const { kind, label } = await searchParams;
  const data = await getJson<{ person: Person; pairs: Pair[] }>(`/v1/people/${id}/consistency`);
  const pairs = data.pairs.filter((row) => (!kind || row.kind === kind) && (!label || row.label === label));
  const href = (next: { kind?: string | null; label?: string | null }) => {
    const params = new URLSearchParams();
    const useKind = next.kind === undefined ? kind : next.kind;
    const useLabel = next.label === undefined ? label : next.label;
    if (useKind) params.set("kind", useKind);
    if (useLabel) params.set("label", useLabel);
    const text = params.toString();
    return text ? `/p/${id}/consistency?${text}` : `/p/${id}/consistency`;
  };
  return (
    <article className="mx-auto max-w-[720px] pt-6">
      <p className="inline-flex items-center gap-1 text-sm text-mute">
        <Link href={`/p/${id}`} className="inline-flex items-center gap-1 no-underline hover-fine:text-ink">
          <Icon name="person" size={14} />
          {data.person.name}
        </Link>
        <Icon name="chevron-right" size={12} />
        可信度
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">前后说的话对得上吗</h1>
      <p className="mt-2 text-sm text-mute">判定由 AI 完成，尚未经人工校准。对照少于 5 条的领域不计分，这里仍列出例子。</p>
      <p className="mt-4 flex flex-wrap gap-2 text-xs">
        {(["", "reversal", "reaffirm", "walk"] as const).map((key) => (
          <Link key={key || "all"} href={href({ kind: key || null })} className={!kind && !key || kind === key ? "text-blue no-underline" : "text-mute no-underline hover-fine:text-blue"}>
            {key ? KIND[key] : "全部类型"}
          </Link>
        ))}
        <Link href={href({ label: null })} className={!label ? "text-blue no-underline" : "text-mute no-underline hover-fine:text-blue"}>全部判定</Link>
        <Link href={href({ label: "consistent" })} className={label === "consistent" ? "text-blue no-underline" : "text-mute no-underline hover-fine:text-blue"}>一致</Link>
        <Link href={href({ label: "inconsistent" })} className={label === "inconsistent" ? "text-blue no-underline" : "text-mute no-underline hover-fine:text-blue"}>不一致</Link>
      </p>
      <ul className="mt-6 space-y-3">
        {pairs.map((row) => (
          <li key={row.id} className="rounded-[14px] bg-card p-4">
            <p className="text-xs text-mute">
              {KIND[row.kind] ?? row.kind} · {row.domain} · {row.label === "consistent" ? "一致" : "不一致"} · AI 判定
            </p>
            <p className="mt-1 font-medium">{row.topic}</p>
            <Quote side={row.a} />
            <Quote side={row.b} />
            {row.explanation ? <Quote side={row.explanation} /> : null}
            {row.rationale ? <p className="mt-2 text-[11px] leading-4 text-mute">{row.rationale}</p> : null}
          </li>
        ))}
      </ul>
      {pairs.length === 0 ? <p className="mt-6 text-sm text-mute">这个筛选下没有对照。</p> : null}
    </article>
  );
}
