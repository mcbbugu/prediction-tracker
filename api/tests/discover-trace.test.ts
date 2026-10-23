import { describe, expect, test } from "bun:test";
import { archiveFailure, identityTrace, inScope } from "../src/claims/discover";
import { verdictTrace, type KeptEvidence } from "../src/claims/verdict";

describe("按需分析的步骤记录", () => {
  test("收录范围只收非政治公众人物", () => {
    expect(inScope({ found: true, name_zh: "陆奇", is_public_figure: true, is_politician: false })).toBe(true);
    expect(inScope({ found: true, name_zh: "某人", is_public_figure: true, is_politician: true })).toBe(false);
    expect(inScope({ found: false, name_zh: "", is_public_figure: false, is_politician: false })).toBe(false);
  });

  test("识别人物保留原字段，并带上候选、理由和是否收录", () => {
    const trace = identityTrace(
      {
        found: true,
        name_zh: "陆奇",
        name_en: "Lu Qi",
        title_zh: "投资人",
        is_public_figure: true,
        is_politician: false,
        reason: "公开身份是投资人",
        candidates: [
          { name_zh: "陆奇", name_en: "Lu Qi", title_zh: "投资人", why: "奇绩创坛创始人" },
          { name_zh: "陆奇", name_en: "Qi Lu", why: "同名，微软时期的英文名" },
        ],
      },
      ["https://example.com/lu"],
    );
    expect(trace.name_zh).toBe("陆奇");
    expect(trace.name_en).toBe("Lu Qi");
    expect(trace.title).toBe("投资人");
    expect(trace.in_scope).toBe(true);
    expect(trace.reason).toBe("公开身份是投资人");
    expect(trace.candidates).toHaveLength(2);
    expect(trace.search_urls).toEqual(["https://example.com/lu"]);
  });

  test("存档失败原因按打不开、HTTP 状态和正文长度区分", () => {
    expect(archiveFailure(null)).toBe("打不开");
    expect(archiveFailure({ http_status: 404, text: "missing" })).toBe("HTTP 404");
    expect(archiveFailure({ http_status: 200, text: "短" })).toBe("正文太短");
    expect(archiveFailure({ http_status: 200, text: "x".repeat(400) })).toBeNull();
  });

  test("到期核对保留原来的 evidence，并补上采信的证据 id 和丢弃理由", () => {
    const kept: KeptEvidence[] = [{ url: "https://a.example/ok", quote: "做到了", source_id: 9, fetched_at: "", sha256: "abc" }];
    const trace = verdictTrace("已兑现", kept, [{ url: "https://a.example/no", quote: "编的", reason: "原文里找不到这句话" }]);
    expect(trace.status).toBe("已兑现");
    expect(trace.evidence).toEqual([{ url: "https://a.example/ok", quote: "做到了" }]);
    expect(trace.accepted).toEqual([{ source_id: 9, url: "https://a.example/ok" }]);
    expect(trace.rejected).toEqual([{ url: "https://a.example/no", quote: "编的", reason: "原文里找不到这句话" }]);
  });
});
