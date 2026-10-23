import { describe, expect, test } from "bun:test";
import { activeOn, classifyByRule, readKind, type OrgTie } from "../src/claims/kind";

const tesla: OrgTie = { name: "Tesla", nameZh: "特斯拉", orgKey: "tesla", started: "2008-01-01", ended: null, endKind: "ongoing" };
const left: OrgTie = { name: "OpenAI", nameZh: "OpenAI", orgKey: "openai", started: "2015-01-01", ended: "2018-02-01", endKind: "ended" };

describe("承诺和预测", () => {
  test("主体是本人，算承诺", () => {
    const result = classifyByRule({ subject: "Elon Musk", personName: "埃隆·马斯克", personNameEn: "Elon Musk", orgs: [], saidOn: "2024-01-01" });
    expect(result?.kind).toBe("promise");
  });

  test("说话当天还在任职的机构，算承诺", () => {
    const result = classifyByRule({ subject: "Tesla", personName: "埃隆·马斯克", personNameEn: "Elon Musk", orgs: [tesla], saidOn: "2024-01-01" });
    expect(result?.kind).toBe("promise");
    expect(activeOn(tesla, "2024-01-01")).toBe(true);
  });

  test("已经离职的机构，算预测", () => {
    const result = classifyByRule({ subject: "OpenAI", personName: "埃隆·马斯克", personNameEn: "Elon Musk", orgs: [left, tesla], saidOn: "2024-01-01" });
    expect(result?.kind).toBe("forecast");
    expect(activeOn(left, "2024-01-01")).toBe(false);
  });

  test("主体句子里点到仍在任职的机构，算承诺；外部事件仍算预测", () => {
    const named = classifyByRule({
      subject: "Tesla will have complete autonomy",
      personName: "埃隆·马斯克",
      personNameEn: "Elon Musk",
      orgs: [tesla],
      saidOn: "2024-01-01",
    });
    expect(named?.kind).toBe("promise");
    const outside = classifyByRule({ subject: "美国通胀", personName: "埃隆·马斯克", personNameEn: "Elon Musk", orgs: [tesla], saidOn: "2024-01-01" });
    expect(outside?.kind).toBe("forecast");
    const fromQuote = classifyByRule({
      subject: "完成一次跨城自动驾驶演示",
      quote: "我们的目标是让特斯拉从洛杉矶开到纽约。",
      personName: "埃隆·马斯克",
      personNameEn: "Elon Musk",
      orgs: [tesla],
      saidOn: "2024-01-01",
    });
    expect(fromQuote?.kind).toBe("promise");
    expect(classifyByRule({ subject: "", personName: "埃隆·马斯克", personNameEn: "Elon Musk", orgs: [tesla], saidOn: "2024-01-01" })).toBeNull();
  });

  test("模型答非所问就记成拿不准", () => {
    expect(readKind({ kind: "maybe", reason: "" }).kind).toBe("uncertain");
    expect(readKind({ kind: "forecast", reason: "不在他控制之内。" })).toEqual({ kind: "forecast", reason: "不在他控制之内。" });
  });
});
