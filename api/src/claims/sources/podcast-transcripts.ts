import { mentions } from "./chunk";
import type { AdapterResult, RawDoc, SourcePerson } from "./types";

// Podcasts that publish their own speaker-labelled transcripts (028). We match the guest by name in the episode
// title, then keep only the guest's turns, so every sentence in the archived text is attributable to them.
// The raw page is archived whole; the text is the guest's turns copied verbatim, each with its speaker label.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) prediction-tracker/0.2";
const LEX_FEED = "https://lexfridman.com/feed/podcast/";
const DWARKESH_ARCHIVE = "https://www.dwarkesh.com/api/v1/archive?sort=new";

export function decodeEntities(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

const plain = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Guest names billed in an episode title: "#471 – Sundar Pichai: CEO of Google", "Dario Amodei (Anthropic CEO) — …",
// "Jeff Dean & Noam Shazeer — …". Lower-cased; parenthesised titles dropped.
export function titleGuests(title: string) {
  const head = title.replace(/^#\d+\s*[–-]\s*/, "").split(/[:–—]/)[0].replace(/\([^)]*\)/g, "").toLowerCase();
  return head.split(/\s*(?:,|&|\band\b)\s*/).map((guest) => guest.trim()).filter(Boolean);
}

// The ways a person may be billed: full English name, and first + last (middle names dropped:
// "Satya Narayana Nadella" is billed as "Satya Nadella").
export function billedNames(nameEn: string) {
  const parts = nameEn.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return parts.length ? [parts.join(" "), `${parts[0]} ${parts[parts.length - 1]}`] : [];
}

export function isGuest(person: SourcePerson, title: string) {
  const names = new Set(billedNames(person.name_en));
  return titleGuests(title).some((guest) => names.has(guest));
}

type Turn = { speaker: string; stamp: string; text: string };

// lexfridman.com/<slug>-transcript: <div class="ts-segment"> with ts-name, ts-timestamp, ts-text.
export function lexTurns(html: string): Turn[] {
  return [...html.matchAll(/<div class="ts-segment">([\s\S]*?)<\/div>/g)].map(([, block]) => ({
    speaker: plain(block.match(/<span class="ts-name">([\s\S]*?)<\/span>/)?.[1] ?? ""),
    stamp: plain(block.match(/<span class="ts-timestamp">([\s\S]*?)<\/span>\s*<span class="ts-text">/)?.[1] ?? ""),
    text: plain(block.match(/<span class="ts-text">([\s\S]*?)<\/span>/)?.[1] ?? ""),
  }));
}

// Substack transcripts: a paragraph that is only <strong>Name</strong> starts that speaker's turn.
export function substackTurns(html: string): Turn[] {
  const turns: Turn[] = [];
  let speaker = "";
  for (const [, inner] of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const label = inner.match(/^\s*<strong>([^<]{2,60})<\/strong>\s*$/);
    if (label) {
      speaker = plain(label[1]);
      continue;
    }
    const text = plain(inner);
    if (!speaker || !text) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.text += ` ${text}`;
    else turns.push({ speaker, stamp: "", text });
  }
  return turns;
}

export function guestText(person: SourcePerson, turns: Turn[]) {
  // A speaker label may carry only part of the name (e.g. "Jensen Huang" vs "Jensen"), so match like mentions().
  const mine = turns.filter((turn) => turn.text && mentions(person, turn.speaker));
  return mine.map((turn) => `${turn.speaker}${turn.stamp ? ` ${turn.stamp}` : ""} ${turn.text}`).join("\n");
}

async function get(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response;
}

type Episode = { title: string; link: string; date: string };
let lexEpisodes: Promise<Episode[]> | null = null;
let dwarkeshEpisodes: Promise<Episode[]> | null = null;

// YYYY-MM-DD from an RSS pubDate or an ISO timestamp; empty when unreadable.
export function isoDay(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";
}

function loadLex(fetcher: typeof fetch) {
  lexEpisodes ??= get(LEX_FEED, fetcher)
    .then((response) => response.text())
    .then((xml) =>
      xml
        .split(/<item>/)
        .slice(1)
        .map((item) => ({
          title: plain(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
          link: decodeEntities(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").split("?")[0],
          date: isoDay(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ""),
        })),
    )
    .catch((error) => {
      lexEpisodes = null;
      throw error;
    });
  return lexEpisodes;
}

function loadDwarkesh(fetcher: typeof fetch) {
  dwarkeshEpisodes ??= (async () => {
    const all: Episode[] = [];
    for (let offset = 0; offset < 300; offset += 50) {
      const page = (await (await get(`${DWARKESH_ARCHIVE}&offset=${offset}&limit=50`, fetcher)).json()) as { title?: string; canonical_url?: string; post_date?: string }[];
      all.push(...page.flatMap((post) => (post.title && post.canonical_url ? [{ title: post.title, link: post.canonical_url, date: isoDay(post.post_date ?? "") }] : [])));
      if (page.length === 0) break;
    }
    return all;
  })().catch((error) => {
    dwarkeshEpisodes = null;
    throw error;
  });
  return dwarkeshEpisodes;
}

// Everyone billed as a guest on the shows we read, for the daily expansion to put first (they have transcripts).
export async function podcastGuests(fetcher: typeof fetch = fetch) {
  const guests = new Set<string>();
  for (const list of [loadLex(fetcher), loadDwarkesh(fetcher)]) {
    const episodes = await list.catch(() => [] as Episode[]);
    for (const episode of episodes) for (const guest of titleGuests(episode.title)) guests.add(guest);
  }
  return guests;
}

export async function findPodcastTranscripts(person: SourcePerson, fetcher: typeof fetch = fetch): Promise<AdapterResult> {
  const docs: RawDoc[] = [];
  const notes: string[] = [];
  const shows = [
    { name: "Lex Fridman", list: () => loadLex(fetcher), transcript: (link: string) => `${link.replace(/\/$/, "")}-transcript/`, turns: lexTurns },
    { name: "Dwarkesh", list: () => loadDwarkesh(fetcher), transcript: (link: string) => link, turns: substackTurns },
  ];
  for (const show of shows) {
    try {
      const episodes = (await show.list()).filter((episode) => isGuest(person, episode.title)).slice(0, 2);
      for (const episode of episodes) {
        if (docs.length >= 3) break;
        const url = show.transcript(episode.link);
        // One episode without a transcript page must not stop the others.
        const response = await get(url, fetcher).catch((error: Error) => {
          notes.push(`${show.name}「${episode.title.slice(0, 30)}」${error.message.replace(url, "").trim()}`);
          return null;
        });
        if (!response) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const turns = guestText(person, show.turns(new TextDecoder().decode(bytes)));
        if (turns.length < 400) {
          notes.push(`${show.name}「${episode.title.slice(0, 30)}」没有解析出本人的发言`);
          continue;
        }
        // The turns carry no date; the episode's title and air date go on top so a quote can be dated (said_on).
        const text = `${episode.title}\n${episode.date ? `${episode.date}\n` : ""}\n${turns}`;
        docs.push({ url, finalUrl: response.url || url, status: response.status, title: episode.title, text, bytes, contentType: "text/html", transcriptKind: "manual" });
      }
    } catch (error) {
      notes.push(`${show.name}：${error instanceof Error ? error.message.slice(0, 100) : error}`);
    }
  }
  if (!docs.length && !notes.length) notes.push("没有以本人为嘉宾的节目");
  return { docs, searches: 0, detail: notes.join("；"), searchLog: [] };
}
