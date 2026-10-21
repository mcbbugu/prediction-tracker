import Link from "next/link";
import { Catalog } from "@/components/catalog";
import { Portrait } from "@/components/portrait";
import { hasInterval, ScoreText } from "@/components/score-badge";
import { ScoreNum } from "@/components/score-num";
import { getJson, type HomePayload } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SpeakersPage() {
  const data = await getJson<HomePayload>("/v1/home");
  return (
    <Catalog title="人物" icon="person" lede="每一位人物是一个可调用的先验。点进去看领域分数和原话。">
      {data.people.map((person) => {
        const scores = data.scores.filter((score) => score.person_id === person.id);
        const headline = scores.find((score) => score.value != null) ?? scores.find((score) => hasInterval(score));
        const count = data.claims.filter((claim) => claim.person_id === person.id).length;
        return (
          <Link
            key={person.id}
            href={`/p/${person.id}`}
            className="grid grid-cols-[72px_1fr_auto] items-center gap-4 border-b border-line py-5 no-underline"
          >
            <Portrait person={person} className="w-[72px]" />
            <span>
              <span className="block font-semibold tracking-tight text-2xl">{person.name}</span>
              <span className="text-sm text-mute">
                {person.name_en} · {person.title} · {count} 条主张
              </span>
              <span className="mt-2 flex flex-wrap gap-2">
                {scores.map((score) => (
                  <span key={score.domain} className="rounded-full bg-card-2 px-2 py-0.5 text-xs text-mute">
                    {score.domain}{" "}
                    <ScoreText score={score} />
                  </span>
                ))}
              </span>
            </span>
            {headline && headline.value == null ? (
              <ScoreText score={headline} className="text-xl" />
            ) : (
              <ScoreNum value={headline?.value} className="text-4xl" />
            )}
          </Link>
        );
      })}
    </Catalog>
  );
}
