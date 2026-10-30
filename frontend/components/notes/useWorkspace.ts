"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API, api, toast } from "@/lib/api";

// ---------- shared workspace sync ----------
export function useWorkspace<T>(kind: "pages" | "stickies" | "todos" | "pins") {
  const [items, setItems] = useState<T[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const load = () => api.get<{ items: T[] }>(`/api/workspace/${kind}`).then((r) => setItems(r.items)).catch(() => setItems([]));
    load();
    const onSync = (e: Event) => {
      const k = (e as CustomEvent<{ key: string }>).detail?.key;
      if (k === "notesView" || k === "notesActive") load();
    };
    window.addEventListener("slayy:persist", onSync);
    return () => window.removeEventListener("slayy:persist", onSync);
  }, [kind]);
  const update = useCallback((fn: (xs: T[]) => T[]) => {
    setItems((xs) => {
      const next = fn(xs ?? []);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fetch(`${API}/api/workspace/${kind}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: next }) })
          .catch(() => toast({ title: "Couldn't save", body: "Check the backend connection.", tone: "crit" }));
      }, 500);
      return next;
    });
  }, [kind]);
  return [items, update] as const;
}

