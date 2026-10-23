import { describe, expect, test } from "bun:test";
import { concatRosters, rankGaps, rosterNames, samePerson } from "../src/tools/expand-plan";

describe("每日扩库计划", () => {
  test("还没出分、过期未判定更多的人排在前面", () => {
    const ranked = rankGaps([
      { id: "a", name: "甲", judged: 2, overdue: 3 },
      { id: "b", name: "乙", judged: 0, overdue: 1 },
      { id: "c", name: "丙", judged: 0, overdue: 4 },
      { id: "d", name: "丁", judged: 0, overdue: 0 },
    ]);
    expect(ranked.map((row) => row.name)).toEqual(["丙", "乙", "丁"]);
    expect(ranked[0].gap).toBe(1);
  });

  test("名单忽略注释，拼成分析用的名字", () => {
    const names = rosterNames("# 注释\n埃隆·马斯克 | Elon Musk\n\n陆奇\n");
    expect(names.map((row) => row.query)).toEqual(["埃隆·马斯克（Elon Musk）", "陆奇"]);
  });

  test("多份名单按文件顺序拼接，缩写和同姓不同人分开", () => {
    const rows = concatRosters([
      { text: "甲 | Jia Jia\n" },
      { text: "乙 | Yi Yi\n甲 | Jia Jia\n" },
    ]);
    expect(rows.map((row) => row.zh)).toEqual(["甲", "乙"]);
    expect(samePerson({ zh: "克莱姆·德朗格", en: "Clem Delangue" }, { name: "克莱芒·德朗格", name_en: "Clément Delangue" })).toBe(true);
    expect(samePerson({ zh: "黄仁勋", en: "Jensen Huang" }, { name: "黄峥", name_en: "Colin Huang" })).toBe(false);
  });
});
