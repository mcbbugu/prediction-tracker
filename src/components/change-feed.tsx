"use client";

import { ChangeRow } from "@/components/change-row";
import { MoreButton } from "@/components/claim-feed";
import { usePaged } from "@/components/use-paged";
import type { ScoreChange, ScoreChangePage } from "@/lib/api";

// Every score change, newest first, appending pages from GET /v1/people/:id/score-changes.
export function ChangeFeed({ path, personId, initial, nextCursor, total }: { path: string; personId: string; initial: ScoreChange[]; nextCursor: string | null; total: number }) {
  const { items: changes, hasMore, state, more } = usePaged(path, initial, nextCursor, (page: ScoreChangePage) => page.changes);

  if (changes.length === 0) return <p className="rounded-[14px] bg-card px-4 py-3 text-xs text-mute">分数还没有变化过。</p>;
  return (
    <>
      <ul className="rounded-[14px] bg-card px-4 py-1 text-sm">
        {changes.map((change) => (
          <ChangeRow key={`${change.domain}-${change.at}`} change={change} personId={personId} />
        ))}
      </ul>
      <MoreButton shown={changes.length} total={total} hasMore={hasMore} state={state} onClick={more} />
    </>
  );
}
