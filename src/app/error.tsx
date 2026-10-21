"use client";

import { Icon } from "@/components/icon";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const apiDown = /fetch failed|ECONNREFUSED|接口/.test(error.message);
  return (
    <div className="mx-auto max-w-[560px] pt-16">
      <p className="inline-flex items-center gap-1.5 text-sm text-mute">
        <Icon name="alert-circle" />
        {apiDown ? "接口没有响应" : "页面出错"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {apiDown ? "后端接口没有启动" : "这一页没能加载"}
      </h1>
      {apiDown ? (
        <>
          <p className="mt-4 text-mute">网站的数据来自 3011 端口的接口。在项目目录另开一个终端运行：</p>
          <pre className="mt-3 overflow-auto rounded-xl bg-sunken p-4 text-sm">pnpm api:dev</pre>
          <p className="mt-3 text-sm text-mute">如果数据库也没开，先运行 pnpm api:docker。或者用 pnpm dev:all 一次全部启动。</p>
        </>
      ) : (
        <p className="mt-4 text-mute">{error.message}</p>
      )}
      <button
        onClick={reset}
        className="mt-6 inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
      >
        <Icon name="arrow-undo" />
        重试
      </button>
    </div>
  );
}
