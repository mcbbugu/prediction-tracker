// Long transcripts are cut into blocks. Only blocks that mention a time get sent to the model.
export const TIME_HINT = /20\d{2}|明年|后年|年内|三年|by\s+20\d{2}|next year|within\s+\d+|年底|年前|个月|years?\b/i;

export function timedChunks(text: string, size = 1200, budget = 4000) {
  const chunks: string[] = [];
  let used = 0;
  for (let index = 0; index < text.length && used < budget; index += size) {
    const chunk = text.slice(index, index + size + 160).trim();
    if (!chunk || !TIME_HINT.test(chunk)) continue;
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks;
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
