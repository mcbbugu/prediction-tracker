# 014 透明日志与每日根哈希

负责人：Cursor
优先级：P1
依赖：011

## 目标

数据架构第 4 层：任何人都能证明某条主张在某天就被收录、之后没被改过。

## 做法

1. 新表 `ledger`：`seq`（自增）、`kind`（claim_added / verdict_set / voided / corrected / interest_added …）、`ref_id`、`payload`（规范化 JSON：键排序、无空格）、`payload_hash`、`prev_hash`、`entry_hash = sha256(seq + kind + payload_hash + prev_hash)`、`created_at`。只追加：数据库层加触发器，禁止 UPDATE 和 DELETE。
2. 所有写主张、判定、作废、更正、利益关系的地方，在同一个事务里追加一条日志。抽一个 `appendLedger(tx, kind, ref, payload)` 函数，不要散落各处。
3. 现有数据按时间顺序回填一次（`kind` 用 `backfill`），回填记录标明是事后补录。
4. 每日根哈希：`api/src/tools/ledger-anchor.ts` 计算当天最后一条的 `entry_hash`，写进 `data/ledger/anchors.jsonl`（日期、seq、hash），并提交 Wayback 存档一个包含该哈希的公开 URL（本机阶段先只写文件）。
5. 公开接口：`GET /v1/ledger?from_seq=&limit=` 和 `GET /v1/ledger/verify?seq=`（返回到该条为止的链是否完整）。
6. 校验脚本 `api/src/tools/ledger-verify.ts`：从头重算整条链。写成测试。
7. 主张详情页显示「收录于 第 N 条日志 · 哈希前 12 位」，可点到接口。

## 范围

- `api/src/core/migrate.ts`、新建 `api/src/core/ledger.ts`、所有写入主张/判定/利益关系的文件（只加 appendLedger 调用）、新建两个 tools 脚本、`api/src/index.ts`、`src/app/p/[id]/[claim]/`、`api/package.json`、测试文件

## 验收标准

- [ ] 改一条日志的 payload 后 verify 报错（测试）
- [ ] UPDATE/DELETE 被触发器拒绝（测试）
- [ ] 通用检查全部通过

## 完成记录

