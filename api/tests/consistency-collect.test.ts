import { describe, expect, test } from "bun:test";
import { biasNote, inScopeTopic, pageExcerpt, proposedLabel } from "../src/consistency/collect";

describe("可信度采集", () => {
  test("一次采集全是不一致时标出提醒", () => {
    expect(biasNote(["inconsistent", "inconsistent"])).toContain("会翻车");
    expect(biasNote(["inconsistent", "consistent"])).toBeNull();
    expect(biasNote([])).toBeNull();
  });

  test("重申记为一致，改口和行动相反记为不一致", () => {
    expect(proposedLabel("reaffirm", false)).toBe("consistent");
    expect(proposedLabel("walk", false)).toBe("inconsistent");
    expect(proposedLabel("reversal", false)).toBe("inconsistent");
    expect(proposedLabel("reversal", true)).toBe("consistent");
    expect(proposedLabel("no_counterpart", false)).toBeNull();
  });

  test("页面摘录只留下像原话的引文", () => {
    const page = `He later said "I console myself with the normal excuse: if I hadn't done it, somebody else would have." The nav says "Copy the Hinton office-hour prompt Add Heropedia to Claude once now".`;
    const quotes = pageExcerpt(page).quoted.map((item) => item.quote);
    expect(quotes).toContain("I console myself with the normal excuse: if I hadn't done it, somebody else would have.");
    expect(quotes.some((quote) => quote.includes("Heropedia"))).toBe(false);
    const chinese = pageExcerpt("采访里他说：“因为我不是搞物理的，所以有点尴尬。”").quoted.map((item) => item.quote);
    expect(chinese).toContain("因为我不是搞物理的，所以有点尴尬。");
  });

  test("选举和带期限的预测不列入话题", () => {
    expect(inScopeTopic({ topic: "开源模型会成为主流", domain: "AI 模型与 AGI", why: "反复讲过" })).toBe(true);
    expect(inScopeTopic({ topic: "会赢得大选", domain: "其他科技", why: "竞选立场" })).toBe(false);
    expect(inScopeTopic({ topic: "明年实现完全自动驾驶", domain: "自动驾驶", why: "带期限" })).toBe(false);
    expect(inScopeTopic({ topic: "芯片会继续领先", domain: "不存在的领域", why: "领域不在列表" })).toBe(false);
  });
});
