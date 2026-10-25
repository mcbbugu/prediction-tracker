import Link from "next/link";

// The one way an overview links to its full list: 「查看全部 N 条 →」.
export function SeeAll({ href, n, className = "" }: { href: string; n: number; className?: string }) {
  return (
    <Link href={href} className={`text-xs font-normal whitespace-nowrap text-blue no-underline ${className}`}>
      查看全部 {n} 条 →
    </Link>
  );
}
