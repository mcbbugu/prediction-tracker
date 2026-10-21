import { Icon } from "@/components/icon";

const ICON: Record<string, string> = {
  已兑现: "checkmark",
  部分兑现: "checkbox-indeterminate",
  未兑现: "cancel",
  待定: "clock",
  证据不足: "alert-circle",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-sunken px-2 py-0.5 text-[12px] font-medium text-ink">
      <Icon name={ICON[status] ?? "clock"} size={12} />
      {status}
    </span>
  );
}
