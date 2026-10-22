import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReviewDesk } from "@/components/review-desk";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <div className="pt-8">
      <h1 className="flex items-center gap-3 text-4xl font-semibold tracking-tight">
        <Icon name="shield-checkmark" size={28} className="text-mute" />
        审核
      </h1>
      <p className="mt-3 max-w-[52ch] text-mute">模型和种子数据都只是提案。点开出处和证据核对，必要时改判定，再发布。已判定的主张没有证据链接不能发布。口令在 api/.env 的 REVIEW_TOKEN。</p>
      <p className="mt-2 text-sm">
        <Link href="/review/calibration" className="text-blue">
          校准：盲标机器判定，决定能否自动公开 →
        </Link>
      </p>
      <div className="mt-8">
        <ReviewDesk />
      </div>
    </div>
  );
}
