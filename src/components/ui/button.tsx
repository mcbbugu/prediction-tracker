"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-[0.98] disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white",
        secondary: "border border-line bg-white text-ink",
        ghost: "bg-transparent px-0 text-ink underline-offset-4 hover-fine:underline",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({
  className,
  variant,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive className={cn(buttonVariants({ variant }), className)} {...props} />;
}
