import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export function SearchField({
  name = "q",
  label,
  placeholder,
  defaultValue,
  className,
  inputClassName,
}: {
  name?: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-mute">
        <Icon name="search" />
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        aria-label={label}
        placeholder={placeholder}
        className={cn(
          "h-full w-full rounded-full border border-line bg-sunken pr-4 pl-11 text-sm text-ink outline-none placeholder:text-mute focus:border-ink",
          inputClassName,
        )}
      />
    </div>
  );
}
