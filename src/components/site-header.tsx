"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MorphingSearch, type MorphingSearchItem } from "@/components/beui/motion/morphing-search";
import { Logo } from "@/components/logo";
import { PUBLIC_API_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "人物" },
  { href: "/method", label: "方法" },
];

type Suggestion = { id: string; name: string; title: string };

export function SiteHeader() {
  const path = usePathname();
  const router = useRouter();
  const [people, setPeople] = useState<Suggestion[]>([]);
  const [query, setQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [path]);

  useEffect(() => {
    let stop = false;
    fetch(`${PUBLIC_API_URL}/v1/people?limit=80&sort=judged`)
      .then((response) => (response.ok ? response.json() : { people: [] }))
      .then((body) => {
        if (!stop) setPeople(body.people ?? []);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  const needle = query.trim();
  const items: MorphingSearchItem[] = [
    ...(needle
      ? [
          {
            id: "query",
            title: `查询「${needle}」`,
            description: "按这句话找人物、主张和先验",
            keywords: [needle],
            onSelect: () => router.push(`/search?q=${encodeURIComponent(needle)}`),
          },
        ]
      : []),
    ...people.map((person) => ({
      id: person.id,
      title: person.name,
      description: person.title,
      onSelect: () => router.push(`/p/${person.id}`),
    })),
  ];

  return (
    <header className={cn("sticky top-0 z-40 -mx-5 flex items-center gap-4 px-5 py-3 transition-colors sm:gap-6", scrolled && "bg-paper")}>
      <Link href="/" aria-label="先验首页" className="shrink-0 no-underline">
        <Logo />
      </Link>
      <nav aria-label="站点" className="flex min-w-0 items-center gap-0.5 text-sm">
        {NAV.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1.5 no-underline",
                active ? "font-medium text-ink" : "text-mute hover-fine:text-ink",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto">
        <MorphingSearch
          iconOnly
          shortcut=""
          items={items}
          placeholder="搜人名，或贴一句待采信的话"
          emptyMessage="没有匹配的人物"
          onQueryChange={setQuery}
        />
      </div>
    </header>
  );
}
