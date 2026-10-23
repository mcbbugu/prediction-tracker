// One vocabulary for the whole site (docs/tasks/033). 「先验」 is only the site name; explanatory copy says what it means.

export const SITE = {
  name: "先验",
  tagline: "公众人物说过的话，后来兑现了多少",
  description: "把公众人物带期限的公开预测和承诺逐句对回原文，到期核对结果，按领域算出兑现率；利益关系并排标出。",
} as const;

export const TERMS = {
  promise: "承诺",
  forecast: "预测",
  claim: "主张",
  reliability: "靠谱度",
  judgment: "判断力",
  pooled: "合并兑现率",
  aiJudged: "AI 判定",
  humanReviewed: "人工复核",
  aiDisclosure: "判定由 AI 完成，尚未经人工校准",
} as const;

export function pageTitle(...parts: string[]) {
  return [...parts.filter(Boolean), SITE.name].join(" · ");
}

// One space between CJK and Latin letters or digits, none between CJK characters.
// Model-written titles mix both ("SpaceX创始人", "特斯拉 董事"), so names, titles and org names pass through here.
const CJK = "\\u3400-\\u9fff\\uf900-\\ufaff";
export function spaceCjk(text: string | null | undefined) {
  if (!text) return "";
  return text
    .replace(new RegExp(`([${CJK}])\\s+([${CJK}])`, "g"), "$1$2")
    .replace(new RegExp(`([${CJK}])([A-Za-z0-9])`, "g"), "$1 $2")
    .replace(new RegExp(`([A-Za-z0-9%])([${CJK}])`, "g"), "$1 $2");
}

// Card titles stay short; the full title goes into a tooltip.
export function shortTitle(text: string | null | undefined, max = 24) {
  const clean = spaceCjk(text);
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// Verdict notes written by the model sometimes open with 「原文称」「原文显示」; the reader only needs the fact.
export function plainResult(text: string | null | undefined) {
  if (!text) return "";
  return text.replace(/^(据?原文(称|显示|提到|表示|指出)[，,：:]?\s*)/, "");
}
