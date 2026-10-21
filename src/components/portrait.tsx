import Image from "next/image";
import Link from "next/link";
import type { Person } from "@/lib/api";

export function Portrait({
  person,
  href,
  className = "w-[88px]",
  riso = false,
}: {
  person: Person;
  href?: string;
  className?: string;
  riso?: boolean;
}) {
  const cjk = /[\u4e00-\u9fff]/.test(person.name) ? person.name.replace(/[·・\s]/g, "").slice(0, 1) : "";
  const initials = cjk || person.name_en
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
  const frame = person.portrait_path ? (
    <div className={`relative aspect-[4/5] overflow-hidden rounded-2xl bg-card-2 ${riso ? "riso" : ""} ${className}`}>
      <Image src={person.portrait_path} alt="" fill sizes="240px" className="object-cover object-top" />
    </div>
  ) : (
    <div
      className={`grid aspect-[4/5] place-items-center rounded-2xl text-3xl font-bold ${riso ? "bg-blue-tint text-blue" : "bg-sunken text-ink"} ${className}`}
    >
      {initials}
    </div>
  );
  return href ? (
    <Link href={href} className="block no-underline">
      {frame}
    </Link>
  ) : (
    frame
  );
}
