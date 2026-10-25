"use client";

import { useState } from "react";
import { PUBLIC_API_URL } from "@/lib/api";

// Shared by the paged feeds: keep the server-rendered first page, append the next ones by cursor.
export function usePaged<T, P extends { next_cursor: string | null }>(path: string, initial: T[], nextCursor: string | null, pick: (page: P) => T[]) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function more() {
    if (!cursor) return;
    setState("loading");
    try {
      const response = await fetch(`${PUBLIC_API_URL}${path}${path.includes("?") ? "&" : "?"}cursor=${cursor}`);
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as P;
      setItems((list) => [...list, ...pick(page)]);
      setCursor(page.next_cursor);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return { items, hasMore: Boolean(cursor), state, more };
}
