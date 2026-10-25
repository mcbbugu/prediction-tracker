import { describe, expect, test } from "bun:test";
import { mentions, timedChunks } from "../src/claims/sources/chunk";
import { guestText, isGuest, lexTurns, substackTurns } from "../src/claims/sources/podcast-transcripts";
import { findRss } from "../src/claims/sources/rss";
import { pickExhibit, pickFilings } from "../src/claims/sources/sec-transcripts";
import { parseVtt } from "../src/claims/sources/youtube-captions";

const huang = { id: "huang", name_zh: "黄仁勋", name_en: "Jensen Huang" };

describe("字幕（028）", () => {
  test("去掉时间轴、标签，自动字幕的重复行只留一次", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "Language: en",
      "",
      "00:00:01.000 --> 00:00:03.000 align:start position:0%",
      "we<00:00:01.500><c> will</c> ship",
      "",
      "00:00:03.000 --> 00:00:05.000",
      "we will ship",
      "by 2027 &amp; beyond",
    ].join("\n");
    expect(parseVtt(vtt)).toBe("we will ship by 2027 & beyond");
  });
});

describe("播客文字稿（028）", () => {
  test("按标题认嘉宾：只认全名，不认同姓的人，也认括号里带头衔的", () => {
    expect(isGuest(huang, "#494 – Jensen Huang: NVIDIA – The $4 Trillion Company")).toBe(true);
    expect(isGuest({ ...huang, name_en: "Elon Musk" }, "#417 – Kimbal Musk: The Art of Cooking")).toBe(false);
    expect(isGuest({ ...huang, name_en: "Dario Amodei" }, "Dario Amodei (Anthropic CEO) — The hidden pattern")).toBe(true);
    expect(isGuest({ ...huang, name_en: "Satya Nadella" }, "Satya Nadella — Microsoft’s AGI plan")).toBe(true);
    expect(isGuest(huang, "#400 – Elon Musk: War, AI, Aliens")).toBe(false);
  });

  test("Lex 文字稿只留嘉宾的发言，带说话人和时间", () => {
    const html = [
      '<div class="ts-segment"><span class="ts-name">Lex Fridman</span> <span class="ts-timestamp"><a href="#">(00:00:05)</a> </span><span class="ts-text">Will you ship it?</span></div>',
      '<div class="ts-segment"><span class="ts-name">Jensen Huang</span> <span class="ts-timestamp"><a href="#">(00:00:09)</a> </span><span class="ts-text">We&#8217;ll ship Rubin by 2026.</span></div>',
    ].join("");
    expect(guestText(huang, lexTurns(html))).toBe("Jensen Huang (00:00:09) We’ll ship Rubin by 2026.");
  });

  test("Substack 文字稿：加粗的人名段落开启一段发言，连续段落合并", () => {
    const html = "<p><strong>Dwarkesh Patel</strong></p><p>When?</p><p><strong>Jensen Huang</strong></p><p>Next year.</p><p>Maybe <em>sooner</em>.</p>";
    expect(guestText(huang, substackTurns(html))).toBe("Jensen Huang Next year. Maybe sooner .");
  });
});

describe("8-K（028）", () => {
  const recent = {
    form: ["8-K", "10-Q", "8-K", "8-K", "8-K"],
    accessionNumber: ["a1", "a2", "a3", "a4", "a5"],
    filingDate: ["2026-08-27", "2026-08-27", "2026-06-01", "2015-02-01", "2026-05-20"],
    items: ["2.02,9.01", "", "5.07", "2.02,9.01", "7.01,9.01"],
  };

  test("只取新闻稿类条目、在任职期内的 8-K", () => {
    const picked = pickFilings(recent, [{ started: "2020-01", ended: null }]);
    expect(picked.map((row) => row.accession)).toEqual(["a1", "a5"]);
    expect(pickFilings(recent, [{ started: "2010", ended: "2016" }]).map((row) => row.accession)).toEqual(["a4"]);
  });

  test("附件：EX-99 优先，其次 press，再次非封面的 htm", () => {
    expect(pickExhibit(["d1d8k.htm", "d1dex991.htm"])).toBe("d1dex991.htm");
    expect(pickExhibit(["goog8k.htm", "googexhibit991q22026.htm"])).toBe("googexhibit991q22026.htm");
    expect(pickExhibit(["nvda-20260827.htm".replace("nvda", "nvda8k"), "q2fy27pr.htm", "R1.htm"])).toBe("q2fy27pr.htm");
    expect(pickExhibit(["x8-k.htm", "R1.htm", "0001-index.html"])).toBeNull();
  });
});

describe("长文档挑块", () => {
  test("预算有限时优先留像预测的块，按原文顺序返回", () => {
    const filler = "Revenue for the quarter was strong across segments. ".repeat(30);
    const strong = "We will ship the next platform by 2027 and expect volume production next year. ";
    const text = `${filler} Founded in 1993. ${filler} ${strong.repeat(3)} ${filler}`;
    const chunks = timedChunks(text, 400, 400);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("by 2027");
  });

  test("人名判断：中文名、全名或较长的姓", () => {
    expect(mentions(huang, "said NVIDIA founder Jensen Huang")).toBe(true);
    expect(mentions(huang, "黄仁勋表示")).toBe(true);
    expect(mentions(huang, "the company said")).toBe(false);
  });
});

describe("RSS 只留提到本人的文章（028）", () => {
  test("公司博客里别人写的文章跳过", async () => {
    const body = (who: string) => `<html><body><p>${`${who} says we will launch it by 2027. `.repeat(20)}</p></body></html>`;
    const feed = `<rss><channel>
      <item><title>Plan for 2027</title><link>https://example.com/a</link><description>by 2027</description></item>
      <item><title>Roadmap 2027</title><link>https://example.com/b</link><description>by 2027</description></item>
    </channel></rss>`;
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/a")) return new Response(body("Paul Graham"), { status: 200 });
      if (url.endsWith("/b")) return new Response(body("A product manager"), { status: 200 });
      return new Response(feed, { status: 200 });
    }) as typeof fetch;
    const result = await findRss({ id: "paul-graham", name_zh: "保罗·格雷厄姆", name_en: "Paul Graham" }, fetcher);
    expect(result.docs.map((doc) => doc.url)).toEqual(["https://example.com/a"]);
    expect(result.detail).toContain("1 篇没有提到本人");
  });
});
