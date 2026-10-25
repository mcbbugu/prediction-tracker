"use client";

import { ClaimRow, SiteClaimRow, type Chip } from "@/components/claim-row";
import { usePaged } from "@/components/use-paged";
import type { Claim, ClaimPage } from "@/lib/api";

// A claim list that starts with the server-rendered first page and appends the next pages from the API.
// path is the API path with its filters, e.g. /v1/people/musk/claims?status=judged.
export function ClaimFeed({
  path,
  initial,
  nextCursor,
  total,
  today,
  chips = {},
  variant = "person",
}: {
  path: string;
  initial: Claim[];
  nextCursor: string | null;
  total: number;
  today: string;
  chips?: Record<string, Chip[]>;
  // person: rows on a person's pages (card list); site: the site-wide /claims list, with the speaker's name.
  variant?: "person" | "site";
}) {
  const { items: claims, hasMore, state, more } = usePaged(path, initial, nextCursor, (page: ClaimPage) => page.claims);

  if (claims.length === 0) return <p className="rounded-[14px] bg-card py-10 text-center text-sm text-mute">没有符合条件的主张。</p>;
  if (variant === "site")
    return (
      <>
        <ul>
          {claims.map((claim) => (
            <SiteClaimRow key={claim.id} claim={claim} today={today} />
          ))}
        </ul>
        <MoreButton shown={claims.length} total={total} hasMore={hasMore} state={state} onClick={more} />
      </>
    );
  return (
    <>
      <ul className="overflow-hidden rounded-[14px] bg-card">
        {claims.map((claim) => (
          <ClaimRow key={claim.id} claim={claim} today={today} chips={chips[claim.id]} />
        ))}
      </ul>
      <MoreButton shown={claims.length} total={total} hasMore={hasMore} state={state} onClick={more} />
    </>
  );
}

export function MoreButton({ shown, total, hasMore, state, onClick }: { shown: number; total: number; hasMore: boolean; state: "idle" | "loading" | "error"; onClick: () => void }) {
  return (
    <p className="mt-3 flex items-center justify-center gap-3 text-xs text-mute">
      <span className="num">
        已显示 {shown} / {total} 条
      </span>
      {hasMore ? (
        <button
          type="button"
          onClick={onClick}
          disabled={state === "loading"}
          className="rounded-full bg-card px-3 py-1.5 text-ink hover-fine:text-blue disabled:opacity-60"
        >
          {state === "loading" ? "加载中…" : state === "error" ? "没加载出来，再试一次" : "加载更多"}
        </button>
      ) : null}
    </p>
  );
}
