import Link from "next/link";
import { CalibrationDesk } from "@/components/calibration-desk";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

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
      <p className="mt-3 max-w-[60ch] text-mute">
        机器判定能不能不经人审直接公开，由这里的盲标决定：你看不到模型的结论，只看原话、期限和资料，自己给出结论，系统统计你和模型的一致程度。口令同审核台。
      </p>
      <div className="mt-8">
        <CalibrationDesk />
      </div>
    </div>
  );
}
