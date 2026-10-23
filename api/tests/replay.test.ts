import { describe, expect, test } from "bun:test";
import { cachedModelCall, contentAddress, ReplayMiss, sha256Text } from "../src/core/ark";
import { sql } from "../src/core/db";
import { migrate } from "../src/core/migrate";
import { alternateSpec, replayJob } from "../src/tools/replay";

const rollback = (error: unknown) => {
  if (error instanceof Error && error.message === "rollback") return;
  throw error;
};

describe("模型调用可重放", () => {
  test("同输入两次只打一次模型，重放结果逐字节一致", async () => {
    await migrate();
    let calls = 0;
    const spec = {
      model: "replay-test",
      prompt: "把这句话翻译一下",
      promptVersion: "PING_V1",
      params: { max_tokens: 8, response_format: { type: "json_object" } },
      input: "byte-identity",
      kind: "chat" as const,
    };
    await sql
      .begin(async (tx) => {
        const first = await cachedModelCall(spec, async () => {
          calls += 1;
          return { zh: ["甲"] };
        }, tx);
        const second = await cachedModelCall(spec, async () => {
          calls += 1;
          return { zh: ["乙"] };
        }, tx);
        expect(calls).toBe(1);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        expect(JSON.stringify(second)).toBe(JSON.stringify({ zh: ["甲"] }));
        throw new Error("rollback");
      })
      .catch(rollback);
  });

  test("ARK_REPLAY=1 时缓存缺失就报错，ARK_CACHE=off 时每次都打模型", async () => {
    await migrate();
    const previousReplay = process.env.ARK_REPLAY;
    process.env.ARK_REPLAY = "1";
    try {
      await expect(
        cachedModelCall(
          { model: "replay-test", prompt: "missing", promptVersion: "MISS_V1", params: {}, input: "no-such-call", kind: "chat" },
          async () => ({ ok: true }),
        ),
      ).rejects.toBeInstanceOf(ReplayMiss);
    } finally {
      if (previousReplay === undefined) delete process.env.ARK_REPLAY;
      else process.env.ARK_REPLAY = previousReplay;
    }

    const previousCache = process.env.ARK_CACHE;
    process.env.ARK_CACHE = "off";
    let calls = 0;
    try {
      await sql
        .begin(async (tx) => {
          await cachedModelCall(
            { model: "replay-test", prompt: "off", promptVersion: "OFF_V1", params: {}, input: "cache-off", kind: "chat" },
            async () => {
              calls += 1;
              return { n: calls };
            },
            tx,
          );
          await cachedModelCall(
            { model: "replay-test", prompt: "off", promptVersion: "OFF_V1", params: {}, input: "cache-off", kind: "chat" },
            async () => {
              calls += 1;
              return { n: calls };
            },
            tx,
          );
          expect(calls).toBe(2);
          throw new Error("rollback");
        })
        .catch(rollback);
    } finally {
      if (previousCache === undefined) delete process.env.ARK_CACHE;
      else process.env.ARK_CACHE = previousCache;
    }
  });

  test("缓存重放和库里一致，换提示词版本只出差异报告", async () => {
    await migrate();
    const jobId = "00000000-0000-4000-8000-000000000011";
    const quote = "Alpha will ship by 2030.";
    const extract = {
      model: "replay-fixture-model",
      prompt: "抽取预测",
      promptVersion: "EXTRACT_V1",
      params: { max_tokens: 30 },
      input: { person: "重放样本" },
      kind: "chat" as const,
    };
    const judge = {
      model: "replay-fixture-model",
      prompt: "判定",
      promptVersion: "JUDGE_V1",
      params: { max_tokens: 30 },
      input: { claim: { quote_en: quote } },
      kind: "chat" as const,
    };
    await sql
      .begin(async (tx) => {
        await cachedModelCall(extract, async () => ({ claims: [{ quote }] }), tx);
        await cachedModelCall(judge, async () => ({ status: "已兑现", actual_result: "做到了", rationale: "原文写了", evidence: [] }), tx);
        const extractId = contentAddress(extract);
        const judgeId = contentAddress(judge);
        const [extractRow] = await tx<{ model: string; prompt: string; prompt_version: string; params: unknown; input: unknown }[]>`
          SELECT model, prompt, prompt_version, params, input FROM model_calls WHERE id = ${extractId}
        `;
        const [judgeRow] = await tx<{ model: string; prompt: string; prompt_version: string; params: unknown; input: unknown }[]>`
          SELECT model, prompt, prompt_version, params, input FROM model_calls WHERE id = ${judgeId}
        `;
        const extractAlt = alternateSpec(extractRow, { prompt: "EXTRACT_V2" });
        const judgeAlt = alternateSpec(judgeRow, { prompt: "JUDGE_V2" });
        const extractAltText = JSON.stringify({ claims: [{ quote: "Beta will ship by 2031." }] });
        const judgeAltText = JSON.stringify({ status: "未兑现", actual_result: "没做到", rationale: "原文写了没做到", evidence: [] });
        await tx`
          INSERT INTO model_calls (id, model, prompt_version, prompt, params, input, output, output_text, output_hash, elapsed_ms, kind)
          VALUES (
            ${contentAddress(extractAlt)}, ${extractAlt.model}, ${extractAlt.promptVersion}, ${extractAlt.prompt},
            ${sql.json(extractAlt.params as never)}, ${sql.json(extractAlt.input as never)}, ${sql.json(JSON.parse(extractAltText))},
            ${extractAltText}, ${sha256Text(extractAltText)}, 0, 'chat'
          )
        `;
        await tx`
          INSERT INTO model_calls (id, model, prompt_version, prompt, params, input, output, output_text, output_hash, elapsed_ms, kind)
          VALUES (
            ${contentAddress(judgeAlt)}, ${judgeAlt.model}, ${judgeAlt.promptVersion}, ${judgeAlt.prompt},
            ${sql.json(judgeAlt.params as never)}, ${sql.json(judgeAlt.input as never)}, ${sql.json(JSON.parse(judgeAltText))},
            ${judgeAltText}, ${sha256Text(judgeAltText)}, 0, 'chat'
          )
        `;
        await tx`
          INSERT INTO people (id, name, name_en, title) VALUES ('replay-fixture', '重放样本', 'Replay Fixture', '测试')
        `;
        await tx`
          INSERT INTO jobs (id, kind, query, person_id, state) VALUES (${jobId}, 'analyze_person', '重放样本', 'replay-fixture', 'done')
        `;
        await tx`
          INSERT INTO claims (
            id, person_id, category, quote_en, quote_zh, quote_original, source_url, published_date, deadline,
            status, publication, model_call_id
          ) VALUES (
            'replay-fixture-1', 'replay-fixture', '其他科技', ${quote}, '二〇三〇年前交付', ${quote},
            'https://example.com/replay', '2020-01-01', '2030-12-31', '待定', 'published', ${extractId}
          )
        `;
        await tx`
          INSERT INTO verdict_proposals (claim_id, person_id, status, model_call_id)
          VALUES ('replay-fixture-1', 'replay-fixture', '已兑现', ${judgeId})
        `;

        expect(await replayJob(jobId, { db: tx })).toBe("一致");
        const extractDiff = await replayJob(jobId, { db: tx, prompt: "EXTRACT_V2" });
        expect(extractDiff).toContain("新增主张");
        expect(extractDiff).toContain("Beta will ship by 2031.");
        expect(extractDiff).toContain("消失主张");
        expect(extractDiff).toContain(quote);
        const judgeDiff = await replayJob(jobId, { db: tx, prompt: "JUDGE_V2" });
        expect(judgeDiff).toContain("改判");
        expect(judgeDiff).toContain("已兑现 → 未兑现");
        throw new Error("rollback");
      })
      .catch(rollback);
  });
});
