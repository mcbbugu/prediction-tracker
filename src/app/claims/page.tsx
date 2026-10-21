import Link from "next/link";
import { Catalog } from "@/components/catalog";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/status-pill";
import { getJson, type HomePayload } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ClaimsPage() {
  const data = await getJson<HomePayload>("/v1/home");
  const claims = [...data.claims].sort((a, b) => b.published_date.localeCompare(a.published_date));
  return (
    <Catalog title="主张" icon="quote" lede="每一条都有原话、出处和到期后的核对。这是人物分数的数据集。">
      {claims.map((claim) => (
        <Link
          key={claim.id}
          href={`/p/${claim.person_id}/${claim.id}`}
          className="grid gap-2 border-b border-line py-4 no-underline sm:grid-cols-[140px_1fr]"
        >
          <span className="flex items-center gap-2 text-xs text-mute">
            <StatusPill status={claim.status} />
            <span>{claim.person_name}</span>
          </span>
          <span>
            <span className="block leading-7">{claim.quote_zh}</span>
            <span className="inline-flex flex-wrap items-center gap-1 text-xs text-mute">
              <Icon name="tag" size={12} />
              {claim.category}
              <Icon name="calendar" size={12} />
              {claim.published_date}
              <Icon name="arrow-right" size={12} />
              {claim.deadline}
            </span>
          </span>
        </Link>
      ))}
    </Catalog>
  );
}
