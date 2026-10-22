import { describe, expect, test } from "bun:test";
import { canonicalName, orgKey, parseScale } from "../src/interests/orgs";

describe("orgKey", () => {
  test("去掉公司后缀再按别名归一：Tesla, Inc. → tesla，Twitter → x，Advanced Micro Devices → amd", () => {
    expect(orgKey("Tesla, Inc.")).toBe("tesla");
    expect(orgKey("Twitter")).toBe("x");
    expect(orgKey("TWITTER")).toBe("x");
    expect(orgKey("Advanced Micro Devices")).toBe("amd");
    expect(orgKey("Advanced Micro Devices, Inc.")).toBe("amd");
  });
});

describe("canonicalName", () => {
  test("只去掉末尾的公司后缀，大小写和中间的词留着", () => {
    expect(canonicalName("Tesla, Inc.")).toBe("Tesla");
    expect(canonicalName("NVIDIA Corporation")).toBe("NVIDIA");
    expect(canonicalName("Acme Ltd.")).toBe("Acme");
    expect(canonicalName("Foo LLC")).toBe("Foo");
    expect(canonicalName("Bar PLC")).toBe("Bar");
    expect(canonicalName("Baz Corp.")).toBe("Baz");
    expect(canonicalName("Incubator Labs")).toBe("Incubator Labs");
  });
});

describe("parseScale", () => {
  const quote = "In the filing, revenue was $6.5 million, up 20.3% and far from 150%.";

  test("数字必须原样出现在原句里", () => {
    expect(parseScale("$6.5 million", quote, "usd")).toBe(6.5e6);
    expect(parseScale("$6.50 million", quote, "usd")).toBeNull();
    expect(parseScale("$9 million", quote, "usd")).toBeNull();
    expect(parseScale(undefined, quote, "usd")).toBeNull();
  });

  test("$6.5 million 解析为 6.5e6，文本里没有货币单位则不算", () => {
    expect(parseScale("$6.5 million", quote, "usd")).toBe(6.5e6);
    expect(parseScale("6.5 million", quote, "usd")).toBeNull();
    expect(parseScale("1亿美元", "去年营收1亿美元", "usd")).toBe(1e8);
  });

  test("百分比不超过 100", () => {
    expect(parseScale("20.3%", quote, "pct")).toBe(20.3);
    expect(parseScale("150%", quote, "pct")).toBeNull();
    expect(parseScale("100%", "utilization hit 100% last quarter", "pct")).toBe(100);
    expect(parseScale("20.3", quote, "pct")).toBeNull();
  });
});
