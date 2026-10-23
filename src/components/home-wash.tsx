"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ShaderBackground } from "@/components/beui/motion/shader-background";

// Grain — Pastel, shifted onto paper and ultramarine. The original stops are
// pink, sky, cream and lilac; these keep that spread inside the brand ink.
const PASTEL = ["#c9d2f4", "#e4e8f8", "#f3f0e6", "#d8d2f0"];

const noop = () => () => {};
function onVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

export function HomeWash() {
  // Client-only (portal into body) and paused while the tab is hidden; both read without effects.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const hidden = useSyncExternalStore(onVisibility, () => document.hidden, () => false);
  if (!mounted) return null;

  // Half-resolution canvas, scaled up. A full-viewport shader at screen pixels
  // was eating frames and making clicks feel stuck.
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute top-0 left-0 h-1/2 w-1/2 origin-top-left scale-[2]">
        <ShaderBackground
          variant="grain-gradient"
          colors={PASTEL}
          colorBack="#f7f7f8"
          softness={0.85}
          intensity={0.42}
          noise={0.55}
          speed={hidden ? 0 : 0.3}
        />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,transparent_70%,#f7f7f8_100%)]" />
    </div>,
    document.body,
  );
}
