export const RESOLVERS = ["sec_xbrl", "price", "model"] as const;
export const COMPARATORS = [">=", "<=", "=", "exists_by"] as const;

export type ResolverName = (typeof RESOLVERS)[number];
export type Comparator = (typeof COMPARATORS)[number];

export type Resolution = {
  status: "已兑现" | "部分兑现" | "未兑现" | "待定" | "证据不足";
  evidence_ids: number[];
  computed_value: number | null;
  evidence_url: string | null;
  detail: string;
};

export function compareNumber(comparator: string, actual: number, threshold: number): "已兑现" | "未兑现" {
  if (comparator === ">=") return actual >= threshold ? "已兑现" : "未兑现";
  if (comparator === "<=") return actual <= threshold ? "已兑现" : "未兑现";
  if (comparator === "=") return actual === threshold ? "已兑现" : "未兑现";
  return "未兑现";
}

export function insufficient(detail: string): Resolution {
  return { status: "证据不足", evidence_ids: [], computed_value: null, evidence_url: null, detail };
}
