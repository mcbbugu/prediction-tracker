import { compareNumber, insufficient, type Resolution } from "./compare";

export type Filing = {
  period_end: string;
  revenue_usd: number;
  source_id: number | null;
  source_url: string;
  fiscal_year: number;
};

export type SecProposition = {
  comparator: string | null;
  threshold: number | null;
  deadline: string | null;
  field: string;
};

// Annual revenue already stored from SEC XBRL. Same filings in, same status out.
export function resolveSecFiling(proposition: SecProposition, filings: Filing[]): Resolution {
  if (proposition.field !== "revenue_usd") return insufficient(`申报表里没有「${proposition.field || "该指标"}」，只有营收`);
  const deadline = proposition.deadline ?? "";
  const eligible = filings
    .filter((row) => row.period_end <= deadline)
    .sort((a, b) => b.period_end.localeCompare(a.period_end) || b.fiscal_year - a.fiscal_year);
  const row = eligible[0];
  if (!row) return insufficient(deadline ? `截止日 ${deadline} 前没有已导入的年报营收` : "命题没有截止日");
  if (proposition.comparator === "exists_by") {
    return {
      status: "已兑现",
      evidence_ids: row.source_id == null ? [] : [row.source_id],
      computed_value: row.revenue_usd,
      evidence_url: row.source_url,
      detail: `FY${row.fiscal_year} 营收 ${row.revenue_usd} USD，期间止于 ${row.period_end}`,
    };
  }
  if (proposition.threshold == null || !proposition.comparator) return insufficient("命题没有阈值或比较符");
  const status = compareNumber(proposition.comparator, row.revenue_usd, proposition.threshold);
  return {
    status,
    evidence_ids: row.source_id == null ? [] : [row.source_id],
    computed_value: row.revenue_usd,
    evidence_url: row.source_url,
    detail: `FY${row.fiscal_year} 营收 ${row.revenue_usd} USD，阈值 ${proposition.comparator} ${proposition.threshold}，期间止于 ${row.period_end}`,
  };
}
