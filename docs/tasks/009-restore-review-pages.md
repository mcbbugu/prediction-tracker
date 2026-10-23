# 009 恢复审核和校准入口

负责人：Cursor
优先级：P0（H01 盲标被它卡住）

## 目标

`/review` 和 `/review/calibration` 重新可用。

## 背景

提交 1bd2361（beUI 第一批）把这两个页面误改成了 `redirect("/")`。组件 `src/components/review-desk.tsx`、`src/components/calibration-desk.tsx` 和后端接口都还在。改之前的页面内容可以用 `git show 1bd2361^:src/app/review/page.tsx` 查看。

## 做法

1. 按 1bd2361 之前的版本恢复两个页面，样式和现在全站的风格对齐（参考其他页面的标题区写法）。
2. 加 `export const metadata = { robots: { index: false } }`，导航里不出现。
3. 口令输入一次后存在 localStorage 或 cookie 里，不用每次都输（看组件现在怎么做的，沿用）。
4. `/review` 顶部加「待办」区：每类一行，写名称、数量、一句话说明，点击跳到对应位置。类别包括校准盲标（显示进度，如 49/100 及是否达标）、待处理反证、模型分歧（010 之前显示 0）、待发布主张。全部为 0 时显示「没有待办」。
5. 每个处理区块上方用一两句话写「怎么处理」，内容照 `docs/站长手册.md` 精简。

## 范围

- `src/app/review/page.tsx`、`src/app/review/calibration/page.tsx`
- 两个 desk 组件只在必要时小改

## 验收标准

- [ ] 两个页面能打开，输入口令后能看到待审条目和盲标进度
- [ ] 通用检查全部通过

## 完成记录

