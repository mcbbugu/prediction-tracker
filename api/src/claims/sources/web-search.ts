import { ArkStopped, arkSearch } from "../../core/ark";
import { usableLinks } from "../../evidence/sources";
import { searchSlots } from "./chunk";
import type { AdapterResult, SourcePerson } from "./types";

export async function findWebSearch(person: SourcePerson, clues: string[], searchesUsed: number): Promise<AdapterResult> {
  const who = `${person.name_zh}（${person.name_en}）`;
  const queries = [
    `请联网搜索 ${who} 公开说过的、带明确时间的预测或承诺，例如“到某年会…”“明年…”“三年内…”。` +
      `列出原始出处网页链接（采访原文、演讲实录、官方博客、新闻报道），尽量 6 到 10 个，不要只给网站首页。`,
    `Search the web for public predictions or commitments with a specific timeframe made by ${person.name_en || person.name_zh} ` +
      `(e.g. "by 2025", "next year", "within three years"). List 6-10 source URLs: interviews, transcripts, official blogs, news articles. No homepages.`,
  ];
  if (clues.length) {
    queries.push(
      `Search for dated predictions by ${person.name_en || person.name_zh} mentioning ${clues.slice(0, 6).join(", ")}. Return source URLs only, no homepages.`,
    );
  }
  const allowed = searchSlots(searchesUsed, queries.length);
  const docs: AdapterResult["docs"] = [];
  const searchLog: AdapterResult["searchLog"] = [];
  let searches = 0;
  for (const query of queries.slice(0, allowed)) {
    try {
      const result = await arkSearch(query);
      searches += 1;
      const urls = usableLinks(result.urls);
      searchLog.push({ query, urls });
      for (const url of urls) docs.push({ url, title: url });
    } catch (error) {
      if (error instanceof ArkStopped) throw error;
      searchLog.push({ query, urls: [], error: error instanceof Error ? error.message.slice(0, 120) : String(error) });
    }
  }
  const detail = allowed < queries.length ? `搜索预算还剩 ${allowed} 次，跳过其余` : "";
  return { docs, searches, detail, searchLog };
}
