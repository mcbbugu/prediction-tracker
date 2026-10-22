import { describe, expect, test } from "bun:test";
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
