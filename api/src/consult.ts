import { arkConfigured, arkJson } from "./ark";
import { sql } from "./db";
import { latestScores, personInterests, publishedClaims } from "./records";
import { COMPOSITE_WEIGHTS, FORMULA_VERSION, MIN_INTERVAL, MIN_SCORED, interestSplit, personProfile } from "./score";

export type ConsultRequest = {
  query: string;
  person_id?: string;
  domain?: string;
};

const TOPIC_WORDS: Record<string, string[]> = {
  fsd: ["autopilot", "autonomous", "self-driving", "self driving", "自动驾驶"],
  autopilot: ["autopilot", "自动驾驶"],
  自动驾驶: ["autopilot", "autonomous", "自动驾驶"],
  马斯克: ["马斯克", "musk"],
  musk: ["musk", "马斯克"],
  奥特曼: ["奥特曼", "altman"],
  altman: ["altman", "奥特曼"],
  黄仁勋: ["黄仁勋", "huang"],
  huang: ["huang", "黄仁勋"],
};

function searchTerms(query: string) {
  const folded = query.toLowerCase().trim();
  const terms = new Set<string>();
  if (folded.length >= 2) terms.add(folded);
  for (const token of folded.split(/[\s,，。？！、]+/)) {
    if (token.length < 2) continue;
    terms.add(token);
    for (const extra of TOPIC_WORDS[token] ?? []) terms.add(extra.toLowerCase());
  }
  for (const [key, extras] of Object.entries(TOPIC_WORDS)) {
    if (folded.includes(key)) for (const extra of extras) terms.add(extra.toLowerCase());
  }
  return [...terms];
}

function covers(haystack: string, terms: string[]) {
  const hay = haystack.toLowerCase();
  return terms.some((term) => hay.includes(term));
}

function halfLifeWeight(deadline: string, now = new Date()): number {
  const days = Math.max(0, (now.getTime() - new Date(deadline).getTime()) / 86_400_000);
  return Number(Math.pow(2, -days / 180).toFixed(3));
}

export async function consultPrior(input: ConsultRequest) {
  const rawQuery = (input.query || "").trim();
  const qLower = rawQuery.toLowerCase();

  const [people, allClaims] = await Promise.all([
    sql<
      {
        id: string;
        name: string;
        name_en: string;
        title: string;
        portrait_path: string | null;
      }[]
    >`SELECT id, name, name_en, title, portrait_path FROM people WHERE visibility = 'public' ORDER BY id`,
    publishedClaims(),
  ]);

  const allScores = await Promise.all(
    people.map(async (p) => ({
      person_id: p.id,
      scores: await latestScores(p.id),
    })),
  );
  const scoreMap = new Map<string, Awaited<ReturnType<typeof latestScores>>>();
  for (const entry of allScores) {
    scoreMap.set(entry.person_id, entry.scores);
  }

  const categories = [...new Set(allClaims.map((claim) => claim.category))];
  const terms = rawQuery ? searchTerms(rawQuery) : [];
  let matchedPeopleIds: string[] = [];
  if (input.person_id && people.some((person) => person.id === input.person_id)) {
    matchedPeopleIds = [input.person_id];
  } else if (!rawQuery) {
    matchedPeopleIds = people.map((person) => person.id);
  } else {
    const byName = people
      .filter((person) => covers(`${person.name} ${person.name_en} ${person.id}`, terms))
      .map((person) => person.id);
    const byClaim = allClaims
      .filter((claim) =>
        covers(`${claim.person_name} ${claim.category} ${claim.quote_zh} ${claim.quote_en}`, terms),
      )
      .map((claim) => claim.person_id);
    matchedPeopleIds = [...new Set([...byName, ...byClaim])];
  }

  const matchedDomains = new Set<string>();
  if (input.domain && input.domain !== "all") matchedDomains.add(input.domain);
  for (const category of categories) {
    if (qLower.includes(category.toLowerCase())) matchedDomains.add(category);
  }

  // SPEC 利益关系: not part of the score; returned so downstream AIs can weigh it themselves.
  const interestMap = new Map(await Promise.all(matchedPeopleIds.map(async (pid) => [pid, await personInterests(pid)] as const)));

  // 3. Build per-person domain prior evaluations
  const evaluations = matchedPeopleIds.map((pid) => {
    const interests = interestMap.get(pid)!;
    const person = people.find((p) => p.id === pid)!;
    const personScores = scoreMap.get(pid) ?? [];
    const personClaims = allClaims.filter((c) => c.person_id === pid);

    // Pick best matching domain for this person
    const domainScore = matchedDomains.size
      ? (personScores.find((score) => matchedDomains.has(score.domain)) ?? null)
      : (personScores.find((score) => score.value !== null) ?? personScores[0] ?? null);

    const domainClaims = domainScore
      ? personClaims.filter((c) => c.category === domainScore.domain)
      : personClaims;

    const counts = {
      fulfilled: domainClaims.filter((c) => c.status === "已兑现").length,
      partial: domainClaims.filter((c) => c.status === "部分兑现").length,
      unfulfilled: domainClaims.filter((c) => c.status === "未兑现").length,
      pending: domainClaims.filter((c) => c.status === "待定").length,
    };

    const scoreVal = domainScore?.value ?? null;
    const interval =
      domainScore && domainScore.low != null && domainScore.high != null ? { low: domainScore.low, high: domainScore.high } : null;
    const intervalText = interval ? `80% 区间 ${interval.low}–${interval.high}` : "";
    const priorWeight = scoreVal !== null ? Number((scoreVal / 100).toFixed(3)) : null;

    let stance: "HIGH_PRIOR" | "MODERATE_PRIOR" | "SKEPTICAL_PRIOR" | "INSUFFICIENT_SAMPLE" =
      "INSUFFICIENT_SAMPLE";
    let directive =
      interval && domainScore
        ? `「${domainScore.domain}」领域已判定 ${domainScore.n} 条，未满 ${MIN_SCORED} 条，不给单一分数，只有${intervalText}。区间很宽，建议下游 AI 以中性先验 (0.500) 为主，把区间当作方向参考，并要求独立一手证据。`
        : `该领域已判定样本不足 ${MIN_INTERVAL} 条。禁止将空缺当作高或低信誉，建议下游 AI 采用中性先验 (0.500) 并要求独立一手证据。`;

    if (scoreVal !== null && domainScore) {
      if (scoreVal >= 70) {
        stance = "HIGH_PRIOR";
        directive = `在「${domainScore.domain}」领域具备较高历史兑现率 (${scoreVal} / 100，已核对 ${domainScore.n} 条，${intervalText})。建议下游 AI 赋予 ${priorWeight} 先验权重，但需核查是否存在局部规格或首发供应折损。`;
      } else if (scoreVal >= 52) {
        stance = "MODERATE_PRIOR";
        directive = `在「${domainScore.domain}」领域具备中等偏上兑现记录 (${scoreVal} / 100，已核对 ${domainScore.n} 条，${intervalText})。建议下游 AI 赋予 ${priorWeight} 先验权重，功能交付通常可兑现，但对激进概念定义需审慎。`;
      } else {
        stance = "SKEPTICAL_PRIOR";
        directive = `在「${domainScore.domain}」领域存在显著的截止日乐观偏差 (${scoreVal} / 100，已核对 ${domainScore.n} 条，其中未兑现 ${counts.unfulfilled} 条，${intervalText})。建议下游 AI 赋予 ${priorWeight} 折算权重，对时间表声明施加延期修正。`;
      }
    }

    return {
      person_id: person.id,
      person_name: person.name,
      person_name_en: person.name_en,
      person_title: person.title,
      portrait_path: person.portrait_path,
      domain: domainScore?.domain ?? "未分类",
      score: scoreVal,
      prior_weight: priorWeight,
      verified_count: domainScore?.n ?? 0,
      interval_80: interval,
      // SPEC 人物画像与综合分: composite within this domain, with every part listed so it can be taken apart.
      profile:
        personProfile(
          domainClaims.map((c) => ({
            category: c.category,
            status: c.status,
            deadline: c.deadline,
            evidence_count: Array.isArray(c.evidence) ? c.evidence.length : 0,
            related: c.id in interests.claim_notes,
          })),
          interests.collected,
        ).find((row) => row.domain === (domainScore?.domain ?? "")) ?? null,
      interests: interests.collected
        ? {
            status: "collected" as const,
            relations: interests.relations.map((item) => ({
              kind: item.kind,
              organisation: item.counterparty,
              organisation_zh: item.counterparty_zh,
              role: item.role,
              started: item.started,
              ended: item.ended,
              source_url: item.source_url,
            })),
            ...interestSplit(
              personClaims.map((c) => ({
                category: c.category,
                status: c.status,
                deadline: c.deadline,
                evidence_count: Array.isArray(c.evidence) ? c.evidence.length : 0,
                related: c.id in interests.claim_notes,
              })),
            ),
            claim_notes: interests.claim_notes,
          }
        : { status: "not_collected" as const },
      composite_weights: COMPOSITE_WEIGHTS,
      min_required: MIN_SCORED,
      confidence: domainScore?.confidence ?? "不足",
      formula_version: domainScore?.formula_version ?? FORMULA_VERSION,
      stance,
      counts,
      directive,
      all_domains: personScores,
    };
  });

  const scoredClaims = allClaims
    .filter((claim) => {
      if (!matchedPeopleIds.includes(claim.person_id)) return false;
      if (!rawQuery) return true;
      return covers(`${claim.person_name} ${claim.category} ${claim.quote_zh} ${claim.quote_en} ${claim.actual_result}`, terms);
    })
    .map((claim) => {
      let relevance = 0;
      if (matchedDomains.has(claim.category)) relevance += 5;
      const hay = `${claim.person_name} ${claim.category} ${claim.quote_zh} ${claim.quote_en} ${claim.actual_result}`.toLowerCase();
      for (const token of terms) {
        if (hay.includes(token)) relevance += 3;
      }
      const weight = halfLifeWeight(claim.deadline);
      return {
        ...claim,
        relevance,
        decay_weight: weight,
      };
    })
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return b.published_date.localeCompare(a.published_date);
    })
    .slice(0, 6);

  // 5. Trace steps for transparency
  const primary = evaluations[0];
  const trace = [
    {
      step: "01",
      title: "实体与领域对齐 / Entity & Domain Resolution",
      status: "completed",
      detail: `识别人物：${evaluations.map((e) => e.person_name).join("、")}；锁定技术领域：${
        matchedDomains.size > 0 ? [...matchedDomains].join(" / ") : primary?.domain ?? "全领域扫描"
      }`,
    },
    {
      step: "02",
      title: "样本门槛与贝叶斯先验检定 / Formula v1 Gate",
      status: "completed",
      detail:
        primary && primary.score !== null
          ? `${primary.person_name}「${primary.domain}」已核对 n=${primary.verified_count} (≥${MIN_SCORED})，后验信誉分 ${primary.score}（80% 区间 ${primary.interval_80?.low}–${primary.interval_80?.high}），先验权重 P=${primary.prior_weight}`
          : primary?.interval_80
            ? `${primary.person_name}「${primary.domain}」已核对 n=${primary.verified_count} (<${MIN_SCORED})，只给 80% 区间 ${primary.interval_80.low}–${primary.interval_80.high}，不出单一分数`
            : `${primary?.person_name ?? "目标人物"}在当前领域已核对样本 n=${primary?.verified_count ?? 0} (<${MIN_INTERVAL})，触发样本不足保护门限`,
    },
    {
      step: "03",
      title: "历史原话与独立证据链召回 / Precedent Retrieval",
      status: "completed",
      detail: `从已人工复核的公开档案库中召回 ${scoredClaims.length} 条历史原话与到期核对结果（半衰期 τ=180 天）`,
    },
    {
      step: "04",
      title: "生成 AI 决策先验载荷 / Agent Calibration Payload",
      status: "completed",
      detail: `已生成结构化先验指令 (${evaluations.map((e) => `${e.person_id}:${e.stance}`).join(", ")})，可直接注入下游 Agent 上下文`,
    },
  ];

  if (arkConfigured() && evaluations.length > 0) {
    try {
      const narrated = (await arkJson(
        "你只能转述给定的分数、80% 区间和样本量，不能新增数字，也不能把样本不足说成有分数；score 为空但有区间时只能说区间。为每位人物写一句中文校准说明。输出 JSON：{\"notes\":[{\"person_id\":\"\",\"domain\":\"\",\"directive\":\"\"}]}",
        JSON.stringify({
          query: rawQuery,
          evaluations: evaluations.map((item) => ({
            person_id: item.person_id,
            domain: item.domain,
            score: item.score,
            n: item.verified_count,
            interval_80: item.interval_80,
            stance: item.stance,
            counts: item.counts,
          })),
        }),
      )) as { notes?: { person_id?: string; domain?: string; directive?: string }[] };
      for (const note of narrated.notes ?? []) {
        const target = evaluations.find((item) => item.person_id === note.person_id && item.domain === note.domain);
        if (target && note.directive) target.directive = note.directive;
      }
      trace.push({
        step: "05",
        title: "方舟模型校准说明",
        status: "completed",
        detail: process.env.ARK_MODEL || "ark",
      });
    } catch (error) {
      trace.push({
        step: "05",
        title: "方舟模型校准说明",
        status: "failed",
        detail: error instanceof Error ? error.message : "调用失败，已保留公式说明",
      });
    }
  }

  return {
    query: rawQuery || "库内人物先验",
    timestamp: new Date().toISOString(),
    formula_version: FORMULA_VERSION,
    min_scored_threshold: MIN_SCORED,
    min_interval_threshold: MIN_INTERVAL,
    evaluations,
    evidence_chain: scoredClaims,
    trace,
  };
}
