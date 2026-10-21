"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Icon } from "@/components/icon";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-6 text-ink shadow-[0_8px_32px_rgba(0,0,0,0.16)] outline-none">
        <div className="mb-3 flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close aria-label="关闭" className="cursor-pointer text-mute">
            <Icon name="cancel" />
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="text-sm leading-7 text-mute">{children}</DialogPrimitive.Description>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}
