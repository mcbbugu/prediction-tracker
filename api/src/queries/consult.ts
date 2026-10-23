import { ArkStopped, arkConfigured, arkJson } from "../core/ark";
import { sql } from "../core/db";
import { latestScoresFor, personInterestAtlas, personInterests, publishedClaims, type AtlasOrg, type ClaimRow } from "./records";
import { indicators } from "../scoring/indicators";
import { COMPOSITE_WEIGHTS, FORMULA_VERSION, HALF_LIFE_DAYS, MIN_JUDGED, fulfillmentSplit, interestSplit, latestDelay, personProfile } from "../scoring/score";
import { scoreConsistency } from "../scoring/consistency";
import { DISCLOSURE, eventsForClaims, tallyTiers, verdictTier } from "./verdict-tier";

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

// Exposures tied to the chosen domain's claims, plus any whose name shows up in the query.
function pickExposures(atlas: Awaited<ReturnType<typeof personInterestAtlas>> | undefined, claimIds: string[], terms: string[]) {
  if (!atlas) return [];
  const wanted = new Set(claimIds);
  const located = new Map<number, { org: AtlasOrg; exposure: AtlasOrg["exposures"][number] }>();
  for (const org of atlas.orgs) for (const exposure of org.exposures) located.set(exposure.id, { org, exposure });
  const seen = new Set<number>();
  const out: {
    org_key: string;
    organisation: string;
    dimension: string;
    target: string;
    target_zh: string;
    country: string | null;
    metric: AtlasOrg["exposures"][number]["metric"];
    level: "direct" | "indirect";
    reason: string;
    source_url: string;
    basis: AtlasOrg["exposures"][number]["basis"];
  }[] = [];
  const push = (org: AtlasOrg, exposure: AtlasOrg["exposures"][number], level: "direct" | "indirect", reason: string) => {
    if (seen.has(exposure.id) || out.length >= 8) return;
    seen.add(exposure.id);
    out.push({
      org_key: org.org_key,
      organisation: org.name_zh || org.name,
      dimension: exposure.dimension,
      target: exposure.target,
      target_zh: exposure.target_zh,
      country: exposure.country,
      metric: exposure.metric,
      level,
      reason,
      source_url: exposure.source_url,
      basis: exposure.basis,
    });
  };
  for (const link of atlas.claim_links) {
    if (link.target_kind !== "exposure" || !wanted.has(link.claim_id)) continue;
    const hit = located.get(link.target_id);
    if (hit) push(hit.org, hit.exposure, link.level, link.reason);
  }
  if (terms.length) {
    for (const org of atlas.orgs) {
      for (const exposure of org.exposures) {
        const hay = `${org.name} ${org.name_zh} ${exposure.target} ${exposure.target_zh} ${exposure.country ?? ""}`;
        if (covers(hay, terms)) push(org, exposure, "indirect", "");
      }
    }
  }
  return out;
}

function halfLifeWeight(deadline: string, now = new Date()): number {
  const days = Math.max(0, (now.getTime() - new Date(deadline).getTime()) / 86_400_000);
  return Number(Math.pow(2, -days / HALF_LIFE_DAYS).toFixed(3));
}


// ---- consult 第二层（SPEC P8）：用模型把一句话解析成人物、领域、期限、说法，再找他以前说过的同类的话。
// 模型只能从库里已有的人物 id、领域、主张 id 里选；代码逐一核对，对不上就当没选。解析失败退回关键词匹配。
export type ParsedQuery = { person_id: string | null; domain: string | null; deadline: string | null; claim: string | null };
const SITE = (process.env.SITE_URL || "http://localhost:4321").replace(/\/$/, "");

async function parseQuery(
  query: string,
  people: { id: string; name: string; name_en: string; title: string }[],
  domains: string[],
): Promise<ParsedQuery | null> {
  if (!arkConfigured()) return null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const out = (await arkJson(
      [
        "把用户给的一句话解析成四项，只输出 JSON：",
        "- person_id：说这句话的人，只能从 people 里选一个 id；句子里看不出是谁、或不在名单里，就填 null。",
        "- domain：这句话属于哪个领域，只能从 domains 里选一个最贴切的；都不贴切就填 null。",
        `- deadline：句子里的期限，换算成 YYYY-MM-DD（今天是 ${today}；「明年」= 明年 12-31，「年底」= 今年 12-31，「三年内」= 今天加三年）；没有期限填 null。`,
        "- claim：去掉说话人之后，这句话预测或承诺的事，用一句中文。",
        '{"person_id":null,"domain":null,"deadline":null,"claim":null}',
      ].join("\n"),
      JSON.stringify({ query, people: people.map(({ id, name, name_en, title }) => ({ id, name, name_en, title })), domains }),
      500,
    )) as Partial<ParsedQuery>;
    const person_id = people.some((p) => p.id === out.person_id) ? String(out.person_id) : null;
    const domain = domains.includes(String(out.domain)) ? String(out.domain) : null;
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(out.deadline)) ? String(out.deadline) : null;
    const claim = typeof out.claim === "string" && out.claim.trim() ? out.claim.trim().slice(0, 300) : null;
    return { person_id, domain, deadline, claim };
  } catch (error) {
    if (error instanceof ArkStopped) return null;
    return null;
  }
}

// Earlier claims by the same person about the same commitment, with how they turned out.
async function findPrecedents(claim: string, personClaims: ClaimRow[]) {
  if (!arkConfigured() || personClaims.length === 0) return [];
  const pool = personClaims.slice(0, 120);
  try {
    const out = (await arkJson(
      [
        "下面是一个人过去公开说过的、带期限的话（claims），以及他的一句新说法（new_claim）。",
        "找出过去说的、和新说法是同一件事（同一个目标、同一个产品或同一个结果）的那几条，最多 5 条；只是话题相近不算。没有就返回空数组。",
        'why 用一句中文说明为什么是同一件事。输出 JSON：{"matches":[{"claim_id":"","why":""}]}',
      ].join("\n"),
      JSON.stringify({ new_claim: claim, claims: pool.map((c) => ({ claim_id: c.id, said_on: c.published_date, deadline: c.deadline, quote: c.quote_zh || c.quote_en })) }),
      800,
    )) as { matches?: { claim_id?: string; why?: string }[] };
    const byId = new Map(pool.map((c) => [c.id, c]));
    const seen = new Set<string>();
    return (out.matches ?? [])
      .filter((m) => m.claim_id && byId.has(m.claim_id) && !seen.has(m.claim_id) && seen.add(m.claim_id))
      .slice(0, 5)
      .map((m) => {
        const c = byId.get(m.claim_id!)!;
        return {
          claim_id: c.id,
          said_on: c.published_date,
          deadline: c.deadline,
          status: c.status,
          quote_zh: c.quote_zh,
          source_url: c.source_url,
          url: `${SITE}/p/${c.person_id}/${c.id}`,
          why: (m.why ?? "").slice(0, 200),
        };
      })
      .sort((a, b) => a.said_on.localeCompare(b.said_on));
  } catch {
    return [];
  }
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

  const categories = [...new Set(allClaims.map((claim) => claim.category))];
  const terms = rawQuery ? searchTerms(rawQuery) : [];
  const parsed = rawQuery && !input.person_id ? await parseQuery(rawQuery, people, categories) : null;
  let matchedPeopleIds: string[] = [];
  if (input.person_id && people.some((person) => person.id === input.person_id)) {
    matchedPeopleIds = [input.person_id];
  } else if (parsed?.person_id) {
    matchedPeopleIds = [parsed.person_id];
  } else if (parsed) {
    // The model read the sentence and found no speaker in our catalogue: don't let keyword overlap
    // ("AI", "app") pin it on someone else.
    matchedPeopleIds = [];
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

  const scoreMap = await latestScoresFor(matchedPeopleIds);

  const matchedDomains = new Set<string>();
  if (input.domain && input.domain !== "all") matchedDomains.add(input.domain);
  // The parsed domain counts only if the person actually has claims there; otherwise their best domain is used.
  if (parsed?.domain && (!parsed.person_id || allClaims.some((c) => c.person_id === parsed.person_id && c.category === parsed.domain))) {
    matchedDomains.add(parsed.domain);
  }
  for (const category of categories) {
    if (qLower.includes(category.toLowerCase())) matchedDomains.add(category);
  }

  // SPEC 利益关系: not part of the score; returned so downstream AIs can weigh it themselves.
  const interestMap = new Map(await Promise.all(matchedPeopleIds.map(async (pid) => [pid, await personInterests(pid)] as const)));
  const atlasMap = new Map(await Promise.all(matchedPeopleIds.map(async (pid) => [pid, await personInterestAtlas(pid)] as const)));
  const delayMap = new Map(await Promise.all(matchedPeopleIds.map(async (pid) => [pid, await latestDelay(pid)] as const)));
  const consistencyAll = matchedPeopleIds.length
    ? await sql<{ person_id: string; domain: string; proposed_label: string; label: string | null; date: string | null }[]>`
        SELECT person_id, domain, proposed_label, label, b->>'date' AS date
        FROM consistency_pairs
        WHERE person_id IN ${sql(matchedPeopleIds)} AND publication = 'published'
      `
    : [];

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
      "该领域还没有任何已判定的主张。禁止将空缺当作高或低信誉，建议下游 AI 采用中性先验 (0.500) 并要求独立一手证据。";
    // Small samples still get a score; say so plainly so the downstream model leans on the interval.
    const fewNote =
      domainScore && domainScore.n < 8 ? `只有 ${domainScore.n} 条已判定，区间很宽，分数已被拉向 50，请按区间而不是单一分数使用。` : "";

    if (scoreVal !== null && domainScore) {
      if (scoreVal >= 70) {
        stance = "HIGH_PRIOR";
        directive = `在「${domainScore.domain}」领域具备较高历史兑现率 (${scoreVal} / 100，已核对 ${domainScore.n} 条，${intervalText})。建议下游 AI 赋予 ${priorWeight} 先验权重，但需核查是否存在局部规格或首发供应折损。${fewNote}`;
      } else if (scoreVal >= 52) {
        stance = "MODERATE_PRIOR";
        directive = `在「${domainScore.domain}」领域具备中等偏上兑现记录 (${scoreVal} / 100，已核对 ${domainScore.n} 条，${intervalText})。建议下游 AI 赋予 ${priorWeight} 先验权重，功能交付通常可兑现，但对激进概念定义需审慎。${fewNote}`;
      } else {
        stance = "SKEPTICAL_PRIOR";
        directive = `在「${domainScore.domain}」领域存在显著的截止日乐观偏差 (${scoreVal} / 100，已核对 ${domainScore.n} 条，其中未兑现 ${counts.unfulfilled} 条，${intervalText})。建议下游 AI 赋予 ${priorWeight} 折算权重，对时间表声明施加延期修正。${fewNote}`;
      }
    }

    const split = fulfillmentSplit(
      domainClaims.map((claim) => ({
        category: claim.category,
        status: claim.status,
        deadline: claim.deadline,
        evidence_count: Array.isArray(claim.evidence) ? claim.evidence.length : 0,
        thread_id: claim.thread_id,
        kind: claim.kind,
      })),
    );
    const delayRows = delayMap.get(person.id) ?? [];
    const delayRow = delayRows.find((row) => row.domain === (domainScore?.domain ?? "")) ?? delayRows.find((row) => row.domain === "");
    return {
      person_id: person.id,
      person_name: person.name,
      person_name_en: person.name_en,
      person_title: person.title,
      portrait_path: person.portrait_path,
      domain: domainScore?.domain ?? "未分类",
      score: scoreVal,
      promise: split.promise,
      forecast: split.forecast,
      delay: delayRow
        ? { n: delayRow.n, censored: delayRow.censored, median: delayRow.median, low: delayRow.low, high: delayRow.high, shrunk: delayRow.shrunk, sentence: delayRow.sentence }
        : null,
      prior_weight: priorWeight,
      verified_count: domainScore?.n ?? 0,
      // 证据不足 claims in this domain: void, not scored (formula v1.3); a high count means vague or unverifiable talk.
      voided_count: domainScore?.voided ?? 0,
      // 画像旁证 for this domain (not scored): how often this person's commitments here slipped, and how many could be judged.
      indicators: indicators(domainClaims).by_domain[domainScore?.domain ?? ""] ?? null,
      interval_80: interval,
      // SPEC 人物画像与综合分: composite within this domain, with every part listed so it can be taken apart.
      profile:
        personProfile(
          domainClaims.map((c) => ({
            category: c.category,
            status: c.status,
            deadline: c.deadline,
            evidence_count: Array.isArray(c.evidence) ? c.evidence.length : 0,
            thread_id: c.thread_id,
            kind: c.kind,
            related: c.id in interests.claim_notes,
          })),
          interests.collected,
          (consistencyAll ?? []).filter((row) => row.person_id === pid).map((row) => ({
            domain: row.domain,
            consistent: (row.label ?? row.proposed_label) === "consistent",
            date: row.date || "1970-01-01",
          })),
        ).find((row) => row.domain === (domainScore?.domain ?? "")) ?? null,
      consistency: scoreConsistency(
        consistencyAll
          .filter((row) => row.person_id === pid && row.domain === (domainScore?.domain ?? ""))
          .map((row) => ({ domain: row.domain, consistent: (row.label ?? row.proposed_label) === "consistent", date: row.date || "1970-01-01" })),
      ),
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
            thread_id: c.thread_id,
                related: c.id in interests.claim_notes,
              })),
            ),
            claim_notes: interests.claim_notes,
          }
        : { status: "not_collected" as const },
      // 与这次查询的领域或话题对得上的对外敞口（地域、工厂、供应链、合作、投资）。
      exposures: pickExposures(atlasMap.get(person.id), domainClaims.map((claim) => claim.id), terms),
      composite_weights: COMPOSITE_WEIGHTS,
      min_required: MIN_JUDGED,
      confidence: domainScore?.confidence ?? "不足",
      formula_version: domainScore?.formula_version ?? FORMULA_VERSION,
      stance,
      counts,
      directive,
      all_domains: personScores,
    };
  });

  const matchedClaims = allClaims.filter((claim) => matchedPeopleIds.includes(claim.person_id));
  const eventMap = await eventsForClaims(matchedClaims.map((claim) => claim.id));
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
        verdict_tier: verdictTier({ status: claim.status, provenance: claim.provenance, events: eventMap.get(claim.id) }),
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
      detail: `${parsed ? `模型解析：${parsed.person_id ?? "未识别人物"} · ${parsed.domain ?? "未识别领域"}${parsed.deadline ? ` · 期限 ${parsed.deadline}` : ""}。` : "关键词匹配。"}识别人物：${evaluations.map((e) => e.person_name).join("、")}；锁定技术领域：${
        matchedDomains.size > 0 ? [...matchedDomains].join(" / ") : primary?.domain ?? "全领域扫描"
      }`,
    },
    {
      step: "02",
      title: `贝叶斯先验 / Formula ${FORMULA_VERSION}`,
      status: "completed",
      detail:
        primary && primary.score !== null
          ? `${primary.person_name}「${primary.domain}」已核对 n=${primary.verified_count}，兑现率 ${primary.score}（80% 区间 ${primary.interval_80?.low}–${primary.interval_80?.high}），先验权重 P=${primary.prior_weight}`
          : `${primary?.person_name ?? "目标人物"}在当前领域还没有已判定的主张，按中性先验处理`,
    },
    {
      step: "03",
      title: "历史原话与独立证据链召回 / Precedent Retrieval",
      status: "completed",
      detail: `从已人工复核的公开档案库中召回 ${scoredClaims.length} 条历史原话与到期核对结果（半衰期 ${Math.round(HALF_LIFE_DAYS / 365)} 年）`,
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
        "你只能转述给定的分数、80% 区间和样本量，不能新增数字；样本少（n < 8）时必须提到区间很宽；score 为空但有区间时只能说区间。为每位人物写一句中文校准说明。输出 JSON：{\"notes\":[{\"person_id\":\"\",\"domain\":\"\",\"directive\":\"\"}]}",
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

  const precedents =
    parsed?.claim && parsed.person_id ? await findPrecedents(parsed.claim, allClaims.filter((c) => c.person_id === parsed.person_id)) : [];

  return {
    query: rawQuery || "库内人物先验",
    // How the sentence was understood (model, checked against the catalogue); null = keyword matching was used.
    parsed,
    // What this person said before about the same thing, and how it turned out.
    precedents,
    timestamp: new Date().toISOString(),
    formula_version: FORMULA_VERSION,
    disclosure: DISCLOSURE,
    verdict_tiers: tallyTiers(matchedClaims.map((claim) => ({ ...claim, events: eventMap.get(claim.id) }))),
    min_judged_threshold: MIN_JUDGED,
    evaluations,
    evidence_chain: scoredClaims,
    trace,
  };
}
