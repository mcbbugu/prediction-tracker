import { sql } from "../../core/db";
import { archiveDocument, snapshot, type Snapshot } from "../../evidence/sources";
import { cluesFrom, orderSources } from "./chunk";
import { findPodcastTranscripts } from "./podcast-transcripts";
import { findRss } from "./rss";
import { findSecTranscripts } from "./sec-transcripts";
import type { RawDoc, SourceAdapter, SourcePerson } from "./types";
import { findWebSearch } from "./web-search";
import { findYoutubeCaptions } from "./youtube-captions";

const ADAPTERS: SourceAdapter[] = [
  { name: "sec_transcripts", find: (person) => findSecTranscripts(person) },
  { name: "youtube_captions", find: (person) => findYoutubeCaptions(person) },
  { name: "podcast_transcripts", find: (person) => findPodcastTranscripts(person) },
  { name: "rss", find: (person) => findRss(person) },
  { name: "web_search", find: (person, ctx) => findWebSearch(person, ctx.clues, ctx.searchesUsed) },
];

export type SourceRun = {
  source: string;
  documents: number;
  claims: number;
  searches: number;
  elapsed_ms: number;
  detail: string;
  urls: string[];
};

export type CollectedPage = { source: string; page: Snapshot };

async function rates() {
  const rows = await sql<{ source: string; rate: number }[]>`
    SELECT source,
      coalesce(sum(claims)::float8 / nullif(sum(documents), 0), 0) AS rate
    FROM source_yield
    GROUP BY source
  `;
  return Object.fromEntries(rows.map((row) => [row.source, Number(row.rate)]));
}

async function materialize(doc: RawDoc): Promise<Snapshot | null> {
  if (doc.text && doc.text.length >= 400 && doc.bytes) {
    return archiveDocument({
      url: doc.url,
      finalUrl: doc.finalUrl,
      transcriptKind: doc.transcriptKind,
      bytes: doc.bytes,
      contentType: doc.contentType || "text/html",
      status: doc.status ?? 200,
      title: doc.title,
      text: doc.text,
    });
  }
  return snapshot(doc.url);
}

function usable(page: Snapshot | null): page is Snapshot {
  return Boolean(page && page.http_status < 400 && page.text.length >= 400);
}

export async function collectSources(person: SourcePerson) {
  // DISCOVER_SOURCES=sec_transcripts,podcast_transcripts limits a run to some sources (to measure them alone).
  const only = (process.env.DISCOVER_SOURCES ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const enabled = ADAPTERS.filter((adapter) => !only.length || only.includes(adapter.name));
  const ordered = orderSources(enabled.map((adapter) => adapter.name), await rates());
  const byName = new Map(ADAPTERS.map((adapter) => [adapter.name, adapter]));
  const runs: SourceRun[] = [];
  const pages: CollectedPage[] = [];
  const searchLog: { query: string; urls: string[]; error?: string }[] = [];
  let searchesUsed = 0;
  let clues: string[] = [];
  for (const name of ordered) {
    const adapter = byName.get(name);
    if (!adapter) continue;
    if (name === "web_search" && pages.length >= 6) {
      runs.push({ source: name, documents: 0, claims: 0, searches: 0, elapsed_ms: 0, detail: "前面的来源已经够用，不再联网搜索", urls: [] });
      continue;
    }
    const started = Date.now();
    const result = await adapter.find(person, { clues, searchesUsed });
    searchesUsed += result.searches;
    searchLog.push(...result.searchLog);
    const urls: string[] = [];
    for (const doc of result.docs) {
      if (pages.length >= 10) break;
      if (pages.some((item) => item.page.final_url === doc.url || item.page.url === doc.url)) continue;
      const page = await materialize(doc);
      if (!usable(page)) continue;
      pages.push({ source: name, page });
      urls.push(page.final_url);
      clues = [...new Set([...clues, ...cluesFrom(page.text)])].slice(0, 8);
    }
    runs.push({
      source: name,
      documents: urls.length,
      claims: 0,
      searches: result.searches,
      elapsed_ms: Date.now() - started,
      detail: result.detail,
      urls,
    });
  }
  return { pages, runs, searchLog };
}

export async function recordYield(personId: string, runs: SourceRun[], claimUrls: string[]) {
  for (const run of runs) {
    const claims = claimUrls.filter((url) => run.urls.includes(url)).length;
    run.claims = claims;
    await sql`
      INSERT INTO source_yield (person_id, source, documents, claims, elapsed_ms, searches, detail)
      VALUES (${personId}, ${run.source}, ${run.documents}, ${claims}, ${run.elapsed_ms}, ${run.searches}, ${run.detail})
    `;
  }
}
