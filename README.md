# 先验 · 给 AI 用的人物仓库

记录科技人物公开说过、带明确截止时间的预测，到期后对照公开资料核对，按领域算出可信度分。别的 AI 在采信这个人的新说法之前，可以通过 `/v1/consult` 取先验。

**产品方向、原则、开发顺序和验收标准都在 [SPEC.md](./SPEC.md)。开发前先读它。**

## 本地运行

需要 Docker、Bun 和 Node。

```bash
pnpm install
pnpm api:docker   # Postgres，端口 5434
pnpm api:seed     # 迁移数据库，导入人物，把 data/people/*.json 的主张放进审核队列
pnpm api:dev      # 接口 http://127.0.0.1:3011
pnpm dev          # 网站 http://localhost:4321
```

种子主张导入后是「待发布」，要到 `/review` 逐条核对后发布，分数才会出现。审核口令是 `api/.env` 的 `REVIEW_TOKEN`。

模型密钥写在 `api/.env`：`ARK_API_KEY`、`ARK_BASE_URL`、`ARK_MODEL`。`pnpm api:agent -- --person=musk` 会去找新原话，结果同样进审核队列。

## 目录

```
src/                 Next.js 网站和审核台
api/src/             接口（Elysia）、评分、agent、迁移
api/sql/init.sql     新数据库的表结构；旧库由 api/src/migrate.ts 补齐
data/people/         人工整理的种子主张（真实出处，判定由人写，需审核后发布）
public/portraits/    授权人物照片
```

## 规则

- 每条必须有真实可访问的出处；已判定的必须附证据链接；查不到结果标「待定」。
- 同一领域满 8 条已判定记录才显示分数。
- 不收录政府及政治人物。

## 许可
MIT
