import { describe, expect, test } from "bun:test";
import { regressed, sameQuote } from "../src/tools/eval";

describe("评测台", () => {
  test("原话对得上就算发现到了，改一个词不算", () => {
    expect(sameQuote("我们应该能在三年内实现 90% 的行驶里程自动驾驶", "我们应该能在三年内实现 90% 的行驶里程自动驾驶。")).toBe(true);
    expect(sameQuote("我们应该能在三年内实现 90% 的行驶里程自动驾驶", "明年再说")).toBe(false);
  });

  test("核心指标下降超过 2 个百分点算退步", () => {
    const next = { discovery_recall: 0.5, extraction_precision: 0.4, verdict_agreement: 0.9 };
    expect(regressed({ discovery_recall: 0.53, extraction_precision: 0.4, verdict_agreement: 0.9 }, next as never)).toEqual(["discovery_recall"]);
    expect(regressed({ discovery_recall: 0.51, extraction_precision: 0.4, verdict_agreement: 0.9 }, next as never)).toEqual([]);
    expect(regressed(null, next as never)).toEqual([]);
  });
});
