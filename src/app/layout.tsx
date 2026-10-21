import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, Inter, Noto_Sans_SC } from "next/font/google";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { BrandCorner, Logo } from "@/components/logo";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-display",
  display: "swap",
});

const sans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "先验 · 给 AI 用的人物仓库",
  description: "把科技人物的公开预测核对成领域先验。另一个模型在采信一句话之前，先到这里取权重。",
};


export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${sans.variable} ${display.variable}`}>
      <body>
        <div className="relative mx-auto max-w-[1180px] px-5">
          <Link
            href="/"
            aria-label="先验首页"
            className="absolute top-0 left-4 z-50 hidden h-[50px] items-center rounded-2xl no-underline transition-transform duration-300 hover-fine:-translate-y-0.5 lg:flex"
          >
            <BrandCorner />
          </Link>
          <header className="sticky top-4 z-40 mx-auto mt-6 flex w-full max-w-[640px] items-center rounded-full border border-black/[0.06] bg-white/85 py-1.5 pr-2 pl-3 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.25)] backdrop-blur-xl transition-shadow focus-within:ring-2 focus-within:ring-blue/30">
            <Link href="/" aria-label="先验首页" className="shrink-0 rounded-full py-1 pr-3 no-underline lg:hidden">
              <Logo />
            </Link>
            <form action="/search" className="flex min-w-0 flex-1 items-center gap-2 pl-1">
              <Icon name="search" className="shrink-0 text-mute" />
              <input
                name="q"
                aria-label="搜人名，或贴一句待采信的话"
                placeholder="搜人名，或贴一句待采信的话"
                className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-mute"
              />
            </form>
          </header>
          <main className="lift pt-6 pb-20">{children}</main>
          <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 py-8 text-xs text-mute">
            <span>先验：公众人物带期限的公开预测，到期后的核对记录</span>
            <Link href="/method" className="no-underline hover-fine:text-ink">方法</Link>
            <Link href="/claims" className="no-underline hover-fine:text-ink">全部主张</Link>
            <Link href="/review" className="inline-flex items-center gap-1 no-underline hover-fine:text-ink">
              <Icon name="shield-checkmark" size={12} />
              审核台
            </Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
