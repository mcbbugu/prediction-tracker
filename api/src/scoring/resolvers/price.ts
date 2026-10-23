import { compareNumber, insufficient, type Resolution } from "./compare";

export type PriceBar = { date: string; close: number | null; market_cap: number | null };

export function parseStooqCsv(text: string): PriceBar[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const dateAt = header.indexOf("date");
  const closeAt = header.indexOf("close");
  const capAt = header.findIndex((cell) => cell === "marketcap" || cell === "market_cap");
  if (dateAt < 0 || closeAt < 0) return [];
  const bars: PriceBar[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const date = (cells[dateAt] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const close = Number(cells[closeAt]);
    const cap = capAt >= 0 ? Number(cells[capAt]) : NaN;
    bars.push({
      date,
      close: Number.isFinite(close) ? close : null,
      market_cap: Number.isFinite(cap) ? cap : null,
    });
  }
  return bars;
}

export function resolvePriceBars(
  proposition: { comparator: string | null; threshold: number | null; deadline: string | null; field: string },
  bars: PriceBar[],
): Resolution {
  const field = proposition.field === "market_cap" ? "market_cap" : "close";
  const deadline = proposition.deadline ?? "";
  const eligible = bars.filter((bar) => bar.date <= deadline && bar[field] != null).sort((a, b) => b.date.localeCompare(a.date));
  const row = eligible[0];
  if (!row || row[field] == null) {
    return insufficient(field === "market_cap" ? `截止日 ${deadline} 前的日线里没有市值` : `截止日 ${deadline} 前的日线里没有收盘价`);
  }
  const actual = row[field] as number;
  if (proposition.comparator === "exists_by") {
    return {
      status: "已兑现",
      evidence_ids: [],
      computed_value: actual,
      evidence_url: null,
      detail: `${row.date} ${field === "market_cap" ? "市值" : "收盘价"} ${actual}`,
    };
  }
  if (proposition.threshold == null || !proposition.comparator) return insufficient("命题没有阈值或比较符");
  const status = compareNumber(proposition.comparator, actual, proposition.threshold);
  return {
    status,
    evidence_ids: [],
    computed_value: actual,
    evidence_url: null,
    detail: `${row.date} ${field === "market_cap" ? "市值" : "收盘价"} ${actual}，阈值 ${proposition.comparator} ${proposition.threshold}`,
  };
}
