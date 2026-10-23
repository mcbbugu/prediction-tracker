import Link from "next/link";
import { CalibrationDesk } from "@/components/calibration-desk";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false } };

export default function CalibrationPage() {
  return (
    <div className="pt-8">
      <p className="flex items-center gap-1 text-xs text-mute">
        <Link href="/review" className="no-underline hover-fine:text-ink">
          审核
        </Link>
        <Icon name="chevron-right" size={11} />
        <span>校准</span>
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">校准</h1>
      <p className="mt-3 max-w-[62ch] text-mute">
        读原话和期限，点开证据看实际发生了什么，自己选一个判定。看不到模型的结论是故意的，不要去别处查它怎么判。拿不准就选「证据不足」。先标到 100 条，上面的进度会告诉你是否达标。
      </p>
      <div className="mt-8">
        <CalibrationDesk />
      </div>
    </div>
  );
}
