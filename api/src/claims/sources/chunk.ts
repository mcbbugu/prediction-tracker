import type { SourcePerson } from "./types";

// Does the text name this person? Chinese name, full English name, or a 4+ letter part of it (surname).
export function mentions(person: SourcePerson, text: string) {
  const hay = text.toLowerCase();
  // A Chinese name counts from 2 characters; an English part needs 4 letters ("Huang", not "Li").
  const tokens = [...(person.name_zh.length >= 2 ? [person.name_zh] : []), ...[person.name_en, ...person.name_en.split(/\s+/)].filter((token) => token.length >= 4)];
  return tokens.some((token) => hay.includes(token.toLowerCase()));
}

// Long transcripts are cut into blocks. Only blocks that mention a time get sent to the model.
export const TIME_HINT = /20\d{2}|明年|后年|年内|三年|by\s+20\d{2}|next year|within\s+\d+|年底|年前|个月|years?\b/i;

// Forward-looking wording: a block with these is more likely to hold a dated prediction or promise.
const FORWARD = /\b(?:will|going to|expect|plan to|by 20\d{2}|next year|within \d+|in the next \d+|by the end of)\b|将|会|计划|预计|明年|年底前/gi;

// Long documents (8-K, transcripts) hold far more than the model reads. Keep the blocks that look most like
// dated predictions until the budget is spent, then return them in document order.
export function timedChunks(text: string, size = 1200, budget = 4000) {
  const candidates: { index: number; chunk: string; score: number }[] = [];
  for (let index = 0; index < text.length; index += size) {
    const chunk = text.slice(index, index + size + 160).trim();
    if (!chunk || !TIME_HINT.test(chunk)) continue;
    const years = (chunk.match(/\b20[2-9]\d\b/g) ?? []).length;
    candidates.push({ index, chunk, score: (chunk.match(FORWARD) ?? []).length + 2 * years });
  }
  const picked: typeof candidates = [];
  let used = 0;
  for (const item of [...candidates].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used >= budget) break;
    picked.push(item);
    used += item.chunk.length;
  }
  return picked.sort((a, b) => a.index - b.index).map((item) => item.chunk);
}

export function cluesFrom(text: string) {
  const years = text.match(/\b20[12]\d\b/g) ?? [];
  const products = text.match(/\b[A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]{2,})?/g) ?? [];
  return [...new Set([...years, ...products])].slice(0, 8);
}

export function orderSources(names: string[], rates: Record<string, number>) {
  const offline = names.filter((name) => name !== "web_search");
  offline.sort((a, b) => (rates[b] ?? 0) - (rates[a] ?? 0) || names.indexOf(a) - names.indexOf(b));
  return [...offline, ...names.filter((name) => name === "web_search")];
}

export const SEARCH_BUDGET = 6;

export function searchSlots(used: number, want: number, budget = SEARCH_BUDGET) {
  return Math.max(0, Math.min(want, budget - used));
}
