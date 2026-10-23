import { describe, expect, test } from "bun:test";
import { sql } from "../src/core/db";
import { recentlyNotified } from "../src/core/notify";
import { verdictsAgree } from "../src/claims/verdict";

describe("双模型交叉判定", () => {
  test("两次结论相同算一致，不同算有分歧", () => {
    expect(verdictsAgree("已兑现", "已兑现")).toBe(true);
    expect(verdictsAgree("已兑现", "未兑现")).toBe(false);
  });

  test("不一致写入分歧，裁定后字段消失，公开状态不变", async () => {
    try {
      await sql.begin(async (tx) => {
        const [person] = await tx<{ id: string }[]>`SELECT id FROM people WHERE id = 'musk'`;
        const id = `cross-test-${crypto.randomUUID().slice(0, 8)}`;
        await tx`
          INSERT INTO claims (
            id, person_id, category, quote_en, quote_zh, source_url, published_date, deadline,
            status, publication, disagreement
          ) VALUES (
            ${id}, ${person.id}, '其他科技', 'quote', '原话', 'https://example.com/cross',
            '2020-01-01', '2021-01-01', '已兑现', 'published',
            ${tx.json({ first: { status: "已兑现", rationale: "做到了" }, second: { status: "未兑现", rationale: "没做到" } })}
          )
        `;
        const [open] = await tx<{ publication: string; disagreement: unknown }[]>`
          SELECT publication, disagreement FROM claims WHERE id = ${id}
        `;
        expect(open.publication).toBe("published");
        expect(open.disagreement).not.toBeNull();
        await tx`UPDATE claims SET status = '未兑现', disagreement = NULL WHERE id = ${id}`;
        const [closed] = await tx<{ status: string; disagreement: unknown }[]>`
          SELECT status, disagreement FROM claims WHERE id = ${id}
        `;
        expect(closed.status).toBe("未兑现");
        expect(closed.disagreement).toBeNull();
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    }
  });

  test("同一通知条件一小时内只发一次", async () => {
    try {
      await sql.begin(async (tx) => {
        expect(await recentlyNotified(tx, "test-condition")).toBe(false);
        await tx`INSERT INTO notifications (condition, message) VALUES ('test-condition', 'hello')`;
        expect(await recentlyNotified(tx, "test-condition")).toBe(true);
        expect(await recentlyNotified(tx, "other-condition")).toBe(false);
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    }
  });
});
