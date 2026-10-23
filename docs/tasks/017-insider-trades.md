# 017 言行一致：SEC Form 4 内部人交易

负责人：Cursor
优先级：P1

## 目标

数据架构第 6 层第 2 点：看多自家公司的话，对照本人前后的真实买卖。

## 做法

1. 导入 Form 4：对库里在美股上市公司任职的人物，按 SEC 的 reporting owner CIK 拉取申报（EDGAR 接口，遵守 SEC 的 User-Agent 和每秒 10 次限制，复用 `api/src/interests/sec.ts` 的请求函数）。原始 XML 照存档标准存。
2. 新表 `insider_trades`：人物、发行人、交易日、申报日、代码（P 买入 / S 卖出 / M 行权 / A 授予 / G 赠与等）、股数、价格、交易后持股、是否在 10b5-1 计划内（脚注里有 10b5-1 字样即为是）、来源文件哈希。
3. 对每条涉及此人自家上市公司的主张，计算说话日前后 90 天、30 天内的**主动**净买卖（只计 P 和不在计划内的 S，行权和授予不计），存进 `claim_trade_context`。
4. 前端：主张详情页的「说这句话时的利益」下加一行，例如「说完 30 天内主动卖出 120 万股，约 $2.4 亿」，链接到 SEC 原文件。没有交易就写「前后 90 天无主动交易」。
5. `pnpm api:form4` 脚本，可续跑；加到 sec-watch 的增量里。

## 范围

- 新建 `api/src/interests/form4.ts`、`api/src/core/migrate.ts`、`api/src/interests/sec-watch.ts`、`api/src/queries/*.ts`、`api/src/index.ts`、`api/package.json`
- 主张详情页 `src/app/p/[id]/[claim]/`、`src/lib/api.ts`
- 测试文件（用存档的 Form 4 样本 XML 离线测）

## 验收标准

- [ ] 马斯克、黄仁勋、苏姿丰至少三人导入成功，完成记录贴各自的统计
- [ ] 通用检查全部通过

## 完成记录

