# 025 会增长的数据：概览 + 子页 + 服务端分页

负责人：Claude
优先级：P1

## 目标

SPEC「页面结构：会增长的数据」。人物页只放摘要，长列表进子页；接口改为分页，不再一次下发全量。

## 背景

- 人物页 `src/app/p/[id]/page.tsx`：「变化原因」现在直接列最多 30 条（约第 548 行起），「全部主张」整份列在页面里（约第 611 行起），以后会越来越长。
- 已有子页：`/p/[id]/interests`（利益关系）、`/p/[id]/[claimId]`（单条主张）。
- 全站主张页 `src/app/claims/page.tsx` 用 `/v1/home` 拿全部主张再在前端筛（001 完成记录里列为遗留）。

## 做法

1. **接口**（`api/src/index.ts` + `api/src/queries/`）：
   - `GET /v1/people/:id/score-changes?domain=&cursor=&limit=`：分数变化原因，新的在上，游标分页。
   - `GET /v1/people/:id/claims?status=&domain=&kind=&month=&sort=&cursor=&limit=`：这个人的主张，带各筛选项的计数。
   - `GET /v1/claims?...`：全站主张，同样的筛选和分页，替代前端拿全量。
   - 默认 limit 20，最大 100。
2. **子页**：
   - `/p/[id]/history`：分数变化图（全部领域）+ 完整的变化原因列表，可按领域筛，滚到底加载更多（或「加载更多」按钮）。每条变化原因展开显示全部引起变化的主张，不再截成 4 条。
   - `/p/[id]/claims`：全部主张，沿用人物页现有的筛选（状态、领域、月份格子图），筛选写进 URL。
3. **人物页改成概览**：
   - 「变化原因」只显示最近 5 条，标题右侧「查看全部 N 条 →」到 `/p/[id]/history`。
   - 「全部主张」改名「最近主张」，显示 5 条加格子图，「查看全部 N 条 →」到 `/p/[id]/claims`；点格子图跳到子页并带上月份筛选。
   - 利益版图已有子页，确认入口文字统一为「查看全部 N 条 →」。
   - 旧链接 `/p/[id]?month=…#claims` 重定向到 `/p/[id]/claims?month=…`，外部已有的链接不失效。
4. **全站主张页** `/claims` 改用 `/v1/claims` 分页接口；`/v1/home` 不再返回全量主张（首页需要的统计改为接口直接给数）。
5. 加一个共用的分页组件和「查看全部」链接组件，以后的新模块（内部人交易、市场反应等）直接复用。

## 硬性要求

整体审美、配色、字体、间距不变；子页标题区与现有利益关系子页同一写法；移动端可用。

## 范围

- `api/src/index.ts`、`api/src/queries/*.ts`
- `src/app/p/[id]/page.tsx`、新建 `src/app/p/[id]/history/`、`src/app/p/[id]/claims/`、`src/app/claims/page.tsx`、`src/app/page.tsx`（如用到全量主张）、`src/lib/api.ts`、新建共用组件
- 测试文件

## 验收标准

- [x] 马斯克人物页首屏的数据请求体积比改前明显变小（完成记录写前后字节数）
- [x] 旧的 `?month=` 链接能跳到新子页
- [x] 分页接口的测试：游标连续翻页不重不漏
- [x] 通用检查全部通过

## 完成记录

- **接口**：`GET /v1/claims`、`GET /v1/people/:id/claims`（筛选 status/domain/person/kind/month/year，排序 record/said/deadline/deadline_desc，带各维分面计数和人名），`GET /v1/people/:id/score-changes`（变化原因从前端搬到后端算，`api/src/queries/score-changes.ts`）。游标是排序键（含 id）的 base64url，下一页取严格排在后面的，默认 20、最多 100。逻辑在 `api/src/queries/claim-list.ts`，测试 `api/tests/claim-list.test.ts`：四种排序 × 每页 1/7/20/100 条连续翻页不重不漏、带筛选翻页、分面计数。
- `/v1/people/:id` 不再带 `claims`，改为 `claim_summary`（各项计数、按领域汇总、按月计数、id→状态、最近 5 条、即将到期 3 条）；`/v1/people/:id/history?compact=1` 只给画图用的快照；`/v1/home` 不再带全量主张，改给 `stats`。
- **首屏体积（马斯克，42 条主张）**：改前 `/v1/people/musk` 99,176 字节 + `/history` 85,858 = 185,034；改后 31,792 + 7,586（compact）+ 1,972（最近 5 次变化）= 41,350，约为原来的 22%。首页 `/v1/home` 514,081 → 46,815。
- **页面**：新增 `/p/[id]/history`（全部领域走势 + 完整变化原因，可按领域筛，「加载更多」）和 `/p/[id]/claims`（状态、领域、月份格子图筛选写进 URL，「加载更多」）。人物页改成概览：变化原因 5 条、最近主张 5 条 + 格子图，各配「查看全部 N 条 →」；利益版图、可信度入口统一成同一个 `SeeAll` 组件。人物页上所有数字链接都改指向 `/p/[id]/claims?…`。
- 旧链接 `/p/[id]?domain|show|year|month=…` 在 `next.config.ts` 里 307 到 `/p/[id]/claims`，查询参数保留。
- `/claims` 改用 `/v1/claims` 分页；首页的滚动核对结果和凭证改从 `/v1/claims` 取；利益子页需要全部主张，用 `getAllClaims` 按游标翻完。
- 共用组件：`ClaimRow`、`ClaimFeed`、`ChangeRow`、`ChangeFeed`、`usePaged`、`MoreButton`、`SeeAll`、`PersonSubhead`。`src/lib/score-changes.ts` 删除（搬到后端）。
- 浏览器核对：人物页、两个子页（含移动端）、`/claims`、首页都正常；`/p/musk/claims` 点「加载更多」后 40 条无重复。

