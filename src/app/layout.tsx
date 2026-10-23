import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import type { ReactNode } from "react";
import { Archivo, Inter, Noto_Sans_SC } from "next/font/google";
import Link from "next/link";
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
        <div className="relative z-10 mx-auto max-w-[1180px] px-5">
          <SiteHeader />
          <main className="pb-20">{children}</main>
          <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 py-8 text-xs text-mute">
            <span>先验：公众人物带期限的公开预测，到期后的核对记录</span>
            <Link href="/method" className="no-underline hover-fine:text-ink">方法</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
