# 012 可检验命题 + 确定性判定器

负责人：Cursor
优先级：P0
依赖：011（判定要记录来源调用）

## 目标

数据架构第 3 层：主张收录时就写好判定标准；能用结构化数据判的，不经过模型、可 100% 复现。

## 做法

1. 新表 `propositions`（一条主张一行）：`claim_id`、`subject`（主体，如公司 ticker 或产品名）、`metric`（指标）、`comparator`（`>=`、`<=`、`=`、`exists_by`）、`threshold`、`unit`、`deadline`、`resolver`（`sec_xbrl` | `price` | `model`）、`resolver_args`（jsonb）、`spec_version`、`created_at`。创建后不可修改，要改就新建一行并让旧的 `superseded_by` 指向它。
2. 抽取步骤之后加「结构化」步骤：模型把原话转成命题；转不了的 `resolver='model'`，只填 subject 和 deadline。
3. 确定性判定器 `api/src/scoring/resolvers/`：
   - `sec_xbrl`：营收、利润、用户数等指标，读已导入的 `org_financials`，没有就调 SEC 接口（复用现有导入代码）。
   - `price`：股价、市值，用免费的公开数据源（如 Stooq 的日线 CSV）。数据源返回的原始文件照存档标准存一份。
   - 每个判定器输入是命题，输出是 `{status, evidence_ids, computed_value}`，同一输入永远同一输出。
4. 到期核对时优先用确定性判定器，失败或不适用再走模型判定。判定记录里写 `resolved_by`。
5. 给已有主张跑一次回填：只生成命题，不改已有判定；如果确定性判定器的结果和已有判定冲突，列出来不改（写进完成记录）。
6. 方法页加一段：确定性判定和模型判定各占多少（从库里统计）。

## 范围

- `api/src/core/migrate.ts`、`api/src/claims/*.ts`、新建 `api/src/scoring/resolvers/*`、`api/src/queries/*.ts`、`api/src/index.ts`
- `src/app/method/page.tsx`、人物主张详情页 `src/app/p/[id]/[claim]/` 显示命题和判定方式
- 测试文件

## 验收标准

- [x] 回填后统计：命题总数、各 resolver 占比、和已有判定冲突的清单
- [x] 判定器有固定样本的单元测试（离线，用存档的原始数据）
- [x] 通用检查全部通过

## 完成记录

收录时把原话写成 `propositions`。营收读已导入的 `org_financials`（没有就跑现有的 SEC 导入），股价读 Stooq 日线并把 CSV 存档。同一份输入两次结果相同。转不成数字门槛的记 `resolver=model`。到期核对先走确定性判定器，判得出来才跳过模型，并在判定记录上写 `resolved_by`。已有判定没有被改写。

回填 193 条公开主张：模型 192（99.5%），SEC 申报 1（0.5%），股价 0。和已有判定冲突 0 条。唯一的确定性命题是 `huang-a-dd2b0c75`：NVIDIA 营收不低于 1,000,000,000,000 USD，截止 2027-12-31，现在还没到期。

方法页写了两类占比。主张详情页写出命题和判定方式。

验证：`bun run typecheck`、88 项测试、根目录 `pnpm lint` 和 `tsc` 通过。离线样本覆盖年报营收和日线收盘价。方法页和黄仁勋这条主张页已在浏览器里打开核对。

