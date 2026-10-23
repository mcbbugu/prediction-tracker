import { Icon } from "@/components/icon";
import { ReviewDesk } from "@/components/review-desk";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false } };

export default function ReviewPage() {
  return (
    <div className="pt-8">
      <p className="inline-flex items-center gap-1.5 text-sm text-mute">
        <Icon name="shield-checkmark" />
        站长
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">审核</h1>
      <p className="mt-3 max-w-[62ch] text-mute">
        模型和种子数据都只是提案。口令在 api/.env 的 REVIEW_TOKEN，在这个标签页里输一次就会记住。
      </p>
      <div className="mt-8">
        <ReviewDesk />
      </div>
    </div>
  );
}
