// One key per organisation (SPEC 利益关系的三层数据: Tesla = Tesla, Inc.; X = Twitter).
// Relations (layer 1) and exposures (layer 2) meet on this key.

// Renames and well-known aliases. Add here when two names turn out to be the same organisation.
const ALIASES: Record<string, string> = {
  twitter: "x",
  "x corp": "x",
  "x holdings": "x",
  "tesla motors": "tesla",
  facebook: "meta",
  "meta platforms": "meta",
  "nvidia corporation": "nvidia",
  "space exploration technologies": "spacex",
  "x ai": "xai",
  "google deepmind": "deepmind",
  "deepmind technologies": "deepmind",
};

export function canonicalName(name: string) {
  return name.replace(/[,.]?\s+(inc|corp|corporation|ltd|llc|plc)\.?$/i, "").replace(/\s+/g, " ").trim();
}

export function orgKey(name: string) {
  const base = canonicalName(name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const aliased = ALIASES[base] ?? base;
  return aliased.replace(/[^a-z0-9㐀-鿿]+/g, "-").replace(/^-|-$/g, "") || base;
}

// A number copied from a sentence ("20.3%", "$6.5 million", "1亿美元") must literally appear in it; we only parse it.
export function parseScale(text: string | undefined, quote: string, kind: "pct" | "usd") {
  const raw = (text ?? "").trim();
  if (!raw || !quote.replace(/\s+/g, " ").includes(raw.replace(/\s+/g, " "))) return null;
  const number = Number((raw.match(/\d[\d,]*(\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(number) || number <= 0) return null;
  if (kind === "pct") return /%|percent|百分/.test(raw) && number <= 100 ? number : null;
  const scale = /trillion|万亿/i.test(raw)
    ? 1e12
    : /billion|bn\b|十亿/i.test(raw)
      ? 1e9
      : /亿/.test(raw)
        ? 1e8
        : /million|mn\b|\bm\b/i.test(raw)
          ? 1e6
          : /万/.test(raw)
            ? 1e4
            : /thousand|\bk\b/i.test(raw)
              ? 1e3
              : 1;
  if (!/\$|usd|dollar|美元/i.test(raw)) return null;
  return number * scale;
}
