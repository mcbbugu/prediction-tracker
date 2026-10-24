import { describe, expect, test } from "bun:test";
import { cluesFrom, orderSources, searchSlots, timedChunks } from "../src/claims/sources/chunk";
import { fetchArticle, findRss, parseFeed } from "../src/claims/sources/rss";
import { youtubeSkipDetail } from "../src/claims/sources/youtube-captions";
import { isHomepage, normalize, quoteOnPage, textFromHtml, usableLinks } from "../src/evidence/sources";

const page = [
  `He said: "We will deliver the ride-hailing service on time."`,
  "Revenue then exceeded the internal forecast.",
  "abcdefghijklmn",
  "abcdefghijklmno",
  "公司表示自动驾驶出租车会在明年大规模运营。",
].join(" ");

describe("quoteOnPage", () => {
  test("逐字匹配可以通过", () => {
    expect(quoteOnPage("We will deliver the ride-hailing service on time", page)).toBe(true);
    expect(quoteOnPage("公司表示自动驾驶出租车会在明年大规模运营", page)).toBe(true);
  });

  test("标点和引号不同可以通过", () => {
    expect(quoteOnPage("We will deliver the ride hailing service on time.", page)).toBe(true);
    expect(quoteOnPage("「We will deliver the ride—hailing service on time」", page)).toBe(true);
  });

  test("改一个词不通过", () => {
    expect(quoteOnPage("We will deliver the bike-hailing service on time", page)).toBe(false);
    expect(quoteOnPage("公司表示自动驾驶出租车会在后年大规模运营", page)).toBe(false);
  });

  test("少于 15 个字符的片段不通过，哪怕页面上有这段话", () => {
    expect(quoteOnPage("on time", page)).toBe(false);
    expect(quoteOnPage("abcdefghijklmn", page)).toBe(false);
    expect(quoteOnPage("abcdefghijklmno", page)).toBe(true);
  });

  test("用省略号连接的多段要按顺序出现，每一段都至少 15 个字符", () => {
    expect(quoteOnPage("deliver the ride-hailing service … exceeded the internal forecast", page)).toBe(true);
    expect(quoteOnPage("deliver the ride-hailing service ... exceeded the internal forecast", page)).toBe(true);
    expect(quoteOnPage("exceeded the internal forecast … deliver the ride-hailing service", page)).toBe(false);
    expect(quoteOnPage("on time … exceeded the internal forecast", page)).toBe(false);
  });
});

describe("normalize", () => {
  test("大小写、兼容字符、引号、破折号和空白折成同一形式", () => {
    expect(normalize("\u201cHello\u201d\u2014World")).toBe('"hello"-world');
    expect(normalize("ＴＥＳＬＡ")).toBe("tesla");
    expect(normalize("Tes\u200bla")).toBe("tesla");
    expect(normalize("  A \n B  ")).toBe("a b");
    expect(normalize("“A”")).toBe(normalize('"A"'));
    expect(normalize("‘A’")).toBe(normalize("'A'"));
  });
});

describe("textFromHtml", () => {
  test("去掉 script 和 style，段落和换行留着", () => {
    const html = [
      "<html><head><title>  标题  </title></head><body>",
      "<style>.x{color:red}</style>",
      '<script>alert("secret")</script>',
      "<p>第一段正文。</p>",
      "<div>第二段正文。</div>",
      "<p>第三行<br/>第四行</p>",
      "</body></html>",
    ].join("");
    const { title, text } = textFromHtml(html);
    expect(title).toBe("标题");
    expect(text).toBe("第一段正文。\n第二段正文。\n第三行\n第四行");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color");
  });
});

describe("usableLinks / isHomepage", () => {
  test("主页不能当证据", () => {
    expect(isHomepage("https://www.bitauto.com/")).toBe(true);
    expect(isHomepage("https://www.bitauto.com")).toBe(true);
    expect(isHomepage("https://www.bitauto.com/news/123")).toBe(false);
    expect(usableLinks(["https://www.bitauto.com/", "https://www.bitauto.com", "https://www.bitauto.com/news/123"])).toEqual([
      "https://www.bitauto.com/news/123",
    ]);
  });

  test("archive.today 等排除域名不能当证据", () => {
    expect(
      usableLinks([
        "https://archive.today/abc",
        "https://www.archive.ph/abc",
        "https://archive.is/abc",
        "https://twitter.com/someone/status/1",
        "https://x.com/someone/status/1",
        "https://www.google.com/search?q=prior",
        "https://example.com/reports/2026",
      ]),
    ).toEqual(["https://example.com/reports/2026"]);
  });
});

describe("多源发现", () => {
  test("长文本只留下带时间的块", () => {
    const filler = "背景介绍。".repeat(80);
    const text = `${filler}到 2027 年会上市。${filler}没有时间的句子。${filler}next year we ship it.`;
    const chunks = timedChunks(text, 200, 2000);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => /2027|next year/.test(chunk))).toBe(true);
    expect(timedChunks("完全没有时间词的短文")).toEqual([]);
  });

  test("来源按历史产出率排序，联网搜索永远在最后", () => {
    const names = ["sec_transcripts", "youtube_captions", "rss", "web_search"];
    expect(orderSources(names, { rss: 0.4, sec_transcripts: 0.1 })).toEqual(["rss", "sec_transcripts", "youtube_captions", "web_search"]);
    expect(orderSources(names, {}).at(-1)).toBe("web_search");
  });

  test("每人搜索不超过 6 次", () => {
    expect(searchSlots(0, 3)).toBe(3);
    expect(searchSlots(5, 3)).toBe(1);
    expect(searchSlots(6, 2)).toBe(0);
  });

  test("RSS 能从条目里取出链接，没有 yt-dlp 就说明跳过", () => {
    const items = parseFeed(`<rss><channel><item><title>By 2027</title><link>https://example.com/a</link><description>next year</description></item></channel></rss>`);
    expect(items).toEqual([{ title: "By 2027", link: "https://example.com/a", description: "next year" }]);
    expect(cluesFrom("Tesla will ship by 2027")).toContain("2027");
    if (!Bun.which("yt-dlp")) expect(youtubeSkipDetail()).toBe("本机没有 yt-dlp，已跳过");
  });
});

describe("RSS 原文抓取失败（#7）", () => {
  const longSummary = "By 2027 we will ship the new model to every customer. ".repeat(20);
  const feedXml = `<rss><channel><item><title>Plan for 2027</title><link>https://example.com/post</link><description>${longSummary}</description></item></channel></rss>`;
  const person = { id: "paul-graham", name_zh: "", name_en: "" };

  for (const [label, article] of [
    ["403", () => new Response("forbidden", { status: 403 })],
    ["超时", () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }],
  ] as const) {
    test(`文章 ${label}、摘要很长时不拿摘要冒充原文`, async () => {
      const fetcher = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("example.com/post")) return article();
        return new Response(feedXml, { status: 200 });
      }) as typeof fetch;
      const result = await findRss(person, fetcher);
      expect(result.docs).toEqual([]);
      expect(result.detail).toContain("不用 feed 摘要代替");
    });
  }

  test("原文能打开时记下跳转后的真实网址", async () => {
    const body = `<html><head><title>Post</title></head><body><p>${longSummary}</p></body></html>`;
    const result = await fetchArticle({ title: "Plan", link: "https://example.com/post" }, (async () => {
      const response = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: "https://example.com/final" });
      return response;
    }) as unknown as typeof fetch);
    expect("doc" in result && result.doc.finalUrl).toBe("https://example.com/final");
  });
});
