import { describe, expect, test } from "bun:test";
import type { ClaimLink, Exposure, Financials, Org, Relation } from "@/lib/interests";
import { assignClaims, buildMoneyFlow, mergeExposures } from "@/lib/money-flow";

// 手写机构、敞口和主张关联。不访问接口，也不读数据库。

function relation(over: Partial<Relation> = {}): Relation {
  return {
    id: 1,
    kind: "role",
    role: "CEO",
    stake_pct: null,
    amount_usd: null,
    started: "2020",
    ended: null,
    source_url: "https://example.test/relation",
    quote: "",
    reviewed: false,
    ...over,
  };
}

function exposure(over: Partial<Exposure> & Pick<Exposure, "id" | "target">): Exposure {
  return {
    dimension: "customer",
    target_zh: "",
    country: null,
    metric: null,
    started: null,
    ended: null,
    source_url: "https://example.test/exposure",
    quote: "",
    reviewed: false,
    ...over,
  };
}

function org(over: Partial<Org> & Pick<Org, "org_key">): Org {
  return {
    name: over.org_key,
    name_zh: "",
    relations: [relation()],
    exposures: [],
    financials: null,
    ...over,
  };
}

function financials(over: Partial<Financials> = {}): Financials {
  return {
    revenue_usd: 10_000_000_000,
    year: 2025,
    source_url: "https://example.test/10k",
    form: "10-K",
    period_start: "2025-01-01",
    period_end: "2025-12-31",
    ...over,
  };
}

function link(claimId: string, kind: "relation" | "exposure", targetId: number): ClaimLink {
  return { claim_id: claimId, target_kind: kind, target_id: targetId, level: "direct", reason: "测试" };
}

const ORG_ESTIMATE = {
  usd: 2_000_000_000,
  formula: "持股 20% × 特斯拉营收 $10B（2025）",
};
const SOURCE_ESTIMATE = {
  usd: 800_000_000,
  formula: "持股 20% × 营收 $10B × 占比 40.0%",
};

function teslaWithRevenue(fin: Financials, metricYear = fin.year ?? 2025): Org {
  return org({
    org_key: "tesla",
    name: "Tesla",
    name_zh: "特斯拉",
    relations: [relation({ id: 1, kind: "holding", role: "持股", stake_pct: 20 })],
    financials: fin,
    exposures: [
      exposure({
        id: 1,
        dimension: "region",
        target: "北美",
        basis: "sec_xbrl",
        metric: { kind: "revenue_share", value: 40, year: metricYear },
      }),
    ],
  });
}

function flowOf(company: Org) {
  return buildMoneyFlow([company], [], []);
}

describe("buildMoneyFlow", () => {
  test("约 12 个月的营收产生机构和来源的 estimate", () => {
    const periods = [
      financials(),
      financials({ period_end: "2025-11-30" }),
      financials({ period_start: undefined, period_end: undefined }),
    ];
    for (const fin of periods) {
      const flow = flowOf(teslaWithRevenue(fin));
      expect(flow.hasRevenue).toBe(true);
      expect(flow.orgs[0].estimate).toEqual(ORG_ESTIMATE);
      expect(flow.orgs[0].sources[0].metric).toBe("营收 40% 2025");
      expect(flow.orgs[0].sources[0].estimate).toEqual(SOURCE_ESTIMATE);
    }
  });

  test("半年和前三季度的营收不产生 estimate，披露数字仍保留", () => {
    const periods = [
      financials({ year: 2026, form: "10-Q", revenue_usd: 4_000_000_000, period_start: "2026-01-01", period_end: "2026-06-30" }),
      financials({ year: 2026, form: "10-Q", revenue_usd: 7_000_000_000, period_start: "2026-01-01", period_end: "2026-09-30" }),
    ];
    for (const fin of periods) {
      const flow = flowOf(teslaWithRevenue(fin));
      const company = flow.orgs[0];
      expect(flow.hasRevenue).toBe(false);
      expect(company.estimate).toBeNull();
      expect(company.sources[0].metric).toBe("营收 40% 2026");
      expect(company.sources[0].share).toBe(0.4);
      expect(company.sources[0].estimate).toBeNull();
    }
  });

  test("verified 只有全部来源都是 sec_xbrl 才为 true", () => {
    const flow = flowOf(
      org({
        org_key: "tesla",
        name_zh: "特斯拉",
        exposures: [
          exposure({ id: 1, dimension: "region", target: "北美", basis: "sec_xbrl" }),
          exposure({ id: 2, dimension: "region", target: "欧洲", basis: "crawl" }),
          exposure({ id: 3, dimension: "region", target: "亚洲", basis: "sec_xbrl", source_url: "https://example.test/asia-k" }),
          exposure({ id: 4, dimension: "region", target: "亚洲", basis: "crawl", source_url: "https://example.test/asia-web" }),
          exposure({ id: 5, dimension: "region", target: "日本" }),
        ],
      }),
    );
    const byLabel = new Map(flow.orgs[0].sources.map((source) => [source.label, source]));
    expect(byLabel.get("北美")?.verified).toBe(true);
    expect(byLabel.get("欧洲")?.verified).toBe(false);
    expect(byLabel.get("亚洲")?.verified).toBe(false);
    expect(byLabel.get("亚洲")?.details).toHaveLength(2);
    expect(byLabel.get("亚洲")?.details.some((line) => line.includes("SEC 年报"))).toBe(true);
    expect(byLabel.get("亚洲")?.details.some((line) => line.includes("未验证"))).toBe(true);
    expect(byLabel.get("日本")?.verified).toBe(false);
  });

  test("同一机构、同一组、规范化后同名的来源合并成一条", () => {
    const flow = flowOf(
      org({
        org_key: "tesla",
        name_zh: "特斯拉",
        exposures: [
          exposure({ id: 1, target: "艾克米, Inc.", basis: "sec_xbrl" }),
          exposure({ id: 2, target: "艾克米 Corp", basis: "sec_xbrl" }),
          exposure({ id: 3, dimension: "supplier", target: "艾克米", basis: "sec_xbrl" }),
        ],
      }),
    );
    const sources = flow.orgs[0].sources;
    const contract = sources.filter((source) => source.group === "contract");
    const depends = sources.filter((source) => source.group === "depends");
    expect(contract).toHaveLength(1);
    expect(contract[0].label).toBe("艾克米, Inc.");
    expect(contract[0].details).toHaveLength(2);
    expect(contract[0].verified).toBe(true);
    expect(depends).toHaveLength(1);
    expect(depends[0].label).toBe("艾克米");
  });

  test("自家机构之间的往来进 inter，不进 sources", () => {
    const tesla = org({
      org_key: "tesla",
      name: "Tesla",
      name_zh: "特斯拉",
      relations: [relation({ id: 1 })],
      exposures: [
        exposure({
          id: 1,
          dimension: "customer",
          target: "SpaceX",
          basis: "sec_xbrl",
          metric: { kind: "amount_usd", value: 5_000_000_000, year: 2025 },
        }),
        exposure({ id: 2, target: "NASA", basis: "sec_xbrl" }),
      ],
    });
    const spacex = org({
      org_key: "spacex",
      name: "SpaceX",
      name_zh: "太空探索技术公司",
      relations: [relation({ id: 2 })],
    });
    const flow = buildMoneyFlow([tesla, spacex], [], []);
    const teslaFlow = flow.orgs.find((item) => item.id === "o:tesla");
    expect(teslaFlow?.sources.map((source) => source.label)).toEqual(["NASA"]);
    expect(flow.orgs.map((item) => item.id)).toContain("o:spacex");
    expect(flow.inter).toEqual([{ from: "o:spacex", to: "o:tesla", label: "采购 $5.0B 2025", known: true }]);
  });

  test("主张按关联次数最多的机构分组，没有关联的进「与利益无关」", () => {
    const tesla = org({
      org_key: "tesla",
      name: "Tesla",
      name_zh: "特斯拉",
      relations: [relation({ id: 10, kind: "role", role: "CEO" })],
      exposures: [
        exposure({ id: 1, dimension: "region", target: "北美" }),
        exposure({ id: 2, dimension: "region", target: "欧洲" }),
      ],
    });
    const spacex = org({
      org_key: "spacex",
      name: "SpaceX",
      name_zh: "太空探索技术公司",
      relations: [relation({ id: 11 })],
      exposures: [exposure({ id: 3, target: "NASA" })],
    });
    const zip2 = org({
      org_key: "zip2",
      name: "Zip2",
      relations: [relation({ id: 12, started: "1995", ended: "1999" })],
      exposures: [exposure({ id: 4, target: "某客户" })],
    });
    const claims = [
      { id: "c1", status: "已兑现" },
      { id: "c1b", status: "部分兑现" },
      { id: "c4", status: "未兑现" },
      { id: "c3", status: "未兑现" },
      { id: "c2", status: "待定" },
    ];
    // c1：特斯拉 2 次、SpaceX 1 次，归特斯拉。c1b 只连特斯拉。c4 只连 SpaceX。c3 连已结束的 Zip2。c2 没有关联。
    const links = [
      link("c1", "exposure", 1),
      link("c1", "exposure", 2),
      link("c1", "exposure", 3),
      link("c1b", "relation", 10),
      link("c4", "exposure", 3),
      link("c3", "exposure", 4),
    ];
    const flow = buildMoneyFlow([tesla, spacex, zip2], claims, links);
    expect(flow.past).toEqual(["Zip2"]);
    expect(flow.claims).toEqual([
      { id: "c:tesla", orgId: "o:tesla", label: "关于特斯拉", count: 2, fulfilled: 2, failed: 0 },
      { id: "c:spacex", orgId: "o:spacex", label: "关于太空探索技术公司", count: 1, fulfilled: 0, failed: 1 },
      { id: "c:elsewhere", orgId: null, label: "关于其他机构", count: 1, fulfilled: 0, failed: 1 },
      { id: "c:unrelated", orgId: null, label: "与利益无关", count: 1, fulfilled: 0, failed: 0 },
    ]);
  });
});

describe("mergeExposures", () => {
  test("同组同名合并，verified 要求每一条都是 sec_xbrl", () => {
    const company = org({
      org_key: "tesla",
      exposures: [
        exposure({ id: 1, target: "艾克米, Inc.", basis: "sec_xbrl" }),
        exposure({ id: 2, target: "艾克米 Corp", basis: "sec_xbrl" }),
        exposure({ id: 3, dimension: "region", target: "亚洲", basis: "sec_xbrl" }),
        exposure({ id: 4, dimension: "region", target: "亚洲", basis: "crawl" }),
      ],
    });
    const { sources } = mergeExposures(company, [company]);
    const acme = sources.find((source) => source.group === "contract");
    const asia = sources.find((source) => source.label === "亚洲");
    expect(acme?.exposures).toHaveLength(2);
    expect(acme?.verified).toBe(true);
    expect(asia?.exposures).toHaveLength(2);
    expect(asia?.verified).toBe(false);
  });

  test("指向自家另一家机构时进 ties，不进 sources", () => {
    const spacex = org({ org_key: "spacex", name: "SpaceX", name_zh: "太空探索技术公司", relations: [relation({ id: 2 })] });
    const tesla = org({
      org_key: "tesla",
      name: "Tesla",
      relations: [relation({ id: 1 })],
      exposures: [
        exposure({
          id: 1,
          dimension: "customer",
          target: "SpaceX",
          metric: { kind: "amount_usd", value: 5_000_000_000, year: 2025 },
        }),
        exposure({ id: 2, dimension: "supplier", target: "发射场", target_zh: "太空探索技术公司" }),
        exposure({ id: 3, target: "NASA" }),
      ],
    });
    const { sources, ties } = mergeExposures(tesla, [tesla, spacex]);
    expect(sources.map((source) => source.label)).toEqual(["NASA"]);
    expect(ties).toEqual([
      expect.objectContaining({ from: "spacex", to: "tesla", label: "采购 $5.0B 2025", known: true }),
      expect.objectContaining({ from: "tesla", to: "spacex", label: "采购", known: false }),
    ]);

    const { sources: external, ties: none } = mergeExposures(tesla, [tesla]);
    expect(none).toHaveLength(0);
    expect(external.map((source) => source.label)).toEqual(["SpaceX", "太空探索技术公司", "NASA"]);
  });
});

describe("assignClaims", () => {
  const tesla = org({
    org_key: "tesla",
    relations: [relation({ id: 10 })],
    exposures: [
      exposure({ id: 1, target: "北美" }),
      exposure({ id: 2, target: "欧洲" }),
    ],
  });
  const spacex = org({
    org_key: "spacex",
    relations: [relation({ id: 11 })],
    exposures: [exposure({ id: 3, target: "NASA" })],
  });

  test("归到关联次数最多的机构", () => {
    const claims = [{ id: "c1" }, { id: "c4" }];
    const links = [
      link("c1", "exposure", 1),
      link("c1", "relation", 10),
      link("c1", "exposure", 3),
      link("c4", "exposure", 3),
    ];
    const grouped = assignClaims([tesla, spacex], claims, links);
    expect(grouped.get("tesla")?.map((claim) => claim.id)).toEqual(["c1"]);
    expect(grouped.get("spacex")?.map((claim) => claim.id)).toEqual(["c4"]);
  });

  test("没有关联，或关联对不上任何机构，归到 null", () => {
    const claims = [{ id: "c2" }, { id: "cx" }];
    const grouped = assignClaims([tesla, spacex], claims, [link("cx", "exposure", 999)]);
    expect(grouped.get(null)?.map((claim) => claim.id)).toEqual(["c2", "cx"]);
    expect(grouped.has("tesla")).toBe(false);
  });
});
