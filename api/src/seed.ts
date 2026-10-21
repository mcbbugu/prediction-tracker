import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db";
import { logEvent, migrate } from "./migrate";
import { recomputeScores } from "./score";

type SeedClaim = {
  id: string;
  category: string;
  quote: { en: string; zh: string };
  source_url: string;
  published_date: string;
  deadline: string;
  actual_result?: string;
  evidence_urls?: string[];
  status: string;
};

type SeedPerson = {
  id: string;
  name: string;
  name_en: string;
  title: string;
  predictions?: SeedClaim[];
};

const SEED_RATIONALE =
  "人工整理的种子记录：原话、出处、实际结果和证据由人写入。发布前请逐条点开出处和证据核对。";

function norm(value: string) {
  return value.toLowerCase().replace(/[“”"'‘’]/g, "").replace(/\s+/g, " ").trim();
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const portraits: Record<
  string,
  { path: string; credit: string; source: string; license: string }
> = {
  musk: {
    path: "/portraits/musk.jpg",
    credit: "Trevor Cokley / U.S. Air Force",
    source: "https://commons.wikimedia.org/wiki/File:Elon_Musk_Colorado_2022_(cropped2).jpg",
    license: "Public domain",
  },
  altman: {
    path: "/portraits/altman.jpg",
    credit: "Steve Jennings / TechCrunch",
    source: "https://commons.wikimedia.org/wiki/File:Sam_Altman_TechCrunch_SF_2019_Day_2_Oct_3_(cropped).jpg",
    license: "CC BY 2.0",
  },
  huang: {
    path: "/portraits/huang.jpg",
    credit: "Peter Dasilva / European Union",
    source: "https://commons.wikimedia.org/wiki/File:Jensen_Huang_(cropped)_(2024).jpg",
    license: "CC BY 4.0",
  },
};

async function main() {
  await migrate();
  const index = JSON.parse(readFileSync(join(root, "data/people/index.json"), "utf8")) as {
    people: string[];
  };

  let queued = 0;
  let skipped = 0;
  for (const id of index.people) {
    const person = JSON.parse(readFileSync(join(root, `data/people/${id}.json`), "utf8")) as SeedPerson;
    const portrait = portraits[id];
    await sql`
      INSERT INTO people (id, name, name_en, title, portrait_path, portrait_credit, portrait_source_url, portrait_license)
      VALUES (
        ${person.id},
        ${person.name},
        ${person.name_en},
        ${person.title},
        ${portrait?.path ?? null},
        ${portrait?.credit ?? null},
        ${portrait?.source ?? null},
        ${portrait?.license ?? null}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        name_en = EXCLUDED.name_en,
        title = EXCLUDED.title,
        portrait_path = EXCLUDED.portrait_path,
        portrait_credit = EXCLUDED.portrait_credit,
        portrait_source_url = EXCLUDED.portrait_source_url,
        portrait_license = EXCLUDED.portrait_license
    `;

    // Hand-curated claims enter the review queue. Nothing already in the database is overwritten or deleted.
    const existing = await sql<{ id: string; quote_en: string }[]>`
      SELECT id, quote_en FROM claims WHERE person_id = ${person.id}
    `;
    const knownIds = new Set(existing.map((row) => row.id));
    const knownQuotes = new Set(existing.map((row) => norm(row.quote_en)));
    for (const claim of person.predictions ?? []) {
      if (knownIds.has(claim.id) || knownQuotes.has(norm(claim.quote.en))) {
        skipped += 1;
        continue;
      }
      const evidence = (claim.evidence_urls ?? []).map((url) => ({ url }));
      await sql`
        INSERT INTO claims (
          id, person_id, category, claim_type, quote_en, quote_zh, source_url,
          published_date, deadline, actual_result, status, publication, rationale, evidence, provenance
        ) VALUES (
          ${claim.id},
          ${person.id},
          ${claim.category},
          'prediction',
          ${claim.quote.en},
          ${claim.quote.zh},
          ${claim.source_url},
          ${claim.published_date},
          ${claim.deadline},
          ${claim.actual_result ?? ""},
          ${claim.status},
          'proposed',
          ${SEED_RATIONALE},
          ${sql.json(evidence)},
          'manual'
        )
      `;
      await logEvent({
        claim_id: claim.id,
        person_id: person.id,
        action: "imported",
        actor: "seed",
        after: { status: claim.status, publication: "proposed" },
        note: `data/people/${id}.json`,
      });
      knownQuotes.add(norm(claim.quote.en));
      queued += 1;
    }

    await recomputeScores(person.id);
  }

  console.log(`seeded ${index.people.join(", ")}`);
  console.log(`queued for review: ${queued}, already in database: ${skipped}`);
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
