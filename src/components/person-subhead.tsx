import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { Portrait } from "@/components/portrait";
import type { Person } from "@/lib/api";

// Title block of a person's subpage (利益关系, 分数变化, 全部主张): breadcrumb back to the person, portrait, title.
export function PersonSubhead({ person, crumb, title, lede, children }: { person: Person; crumb: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <p className="flex items-center gap-1 text-xs text-mute">
        <Link href={`/p/${person.id}`} className="no-underline hover-fine:text-ink">
          {person.name}
        </Link>
        <Icon name="chevron-right" size={11} />
        <span>{crumb}</span>
      </p>
      <section className="mt-3 rounded-[18px] bg-card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <Portrait person={person} riso className="w-[64px] shrink-0 !rounded-[12px]" />
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-[900] tracking-tight">{title}</h1>
            {lede ? <p className="mt-0.5 text-sm text-mute">{lede}</p> : null}
          </div>
        </div>
        {children}
      </section>
    </>
  );
}
