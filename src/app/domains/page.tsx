import Link from "next/link";
import { Catalog } from "@/components/catalog";
import { hasInterval, ScoreText } from "@/components/score-badge";
import { ScoreNum } from "@/components/score-num";
import { getJson, type HomePayload } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const data = await getJson<HomePayload>("/v1/home");
  // Larger samples first; a one-claim score is mostly the prior.
  const scores = [...data.scores].sort((a, b) => b.n - a.n || (b.value ?? -1) - (a.value ?? -1));
  return (
    <Catalog title="领域" icon="grid" lede="分数按领域分开。同一个人可以在一件事上可信，在另一件事上样本还不够。">
      <div className="grid gap-3 sm:grid-cols-2">
        {scores.map((score) => {
          const person = data.people.find((item) => item.id === score.person_id);
          return (
            <Link
              key={`${score.person_id}-${score.domain}`}
              href={`/p/${score.person_id}`}
              className="flex items-end justify-between rounded-3xl border border-line bg-card p-5 no-underline"
            >
              <span>
                <span className="block font-semibold tracking-tight text-2xl">{score.domain}</span>
                <span className="text-sm text-mute">
                  {person?.name} · 已判定 {score.n} 条
                  {score.value != null && hasInterval(score) ? ` · 80% 区间 ${score.low}–${score.high}` : ""}
                </span>
              </span>
              {score.value != null ? (
                <ScoreNum value={score.value} className="text-4xl" />
              ) : (
                <ScoreText score={score} className="text-xl" />
              )}
            </Link>
          );
        })}
      </div>
    </Catalog>
  );
}
