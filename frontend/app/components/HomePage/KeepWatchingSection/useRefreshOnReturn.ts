"use client";

import { useEffect } from "react";
import { subscribe } from "@/app/lib/local-store/progress";

/** Coalesces the burst of focus/pageshow/progress events into one reload. */
export const RETURN_REFRESH_DEBOUNCE_MS = 300;

/**
 * Calls `refresh` when the page may have missed something: the tab regains
 * focus, the page is restored (including from the bfcache), it becomes visible
 * again, or the local progress store changes (the player saved).
 */
export function useRefreshOnReturn(
  refresh: () => void,
  debounceMs: number = RETURN_REFRESH_DEBOUNCE_MS,
) {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      if (cancelled) return;
      refresh();
    };

    const schedule = () => {
      if (typeof window === "undefined") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, debounceMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
    };

    window.addEventListener("focus", schedule);
    window.addEventListener("pageshow", schedule);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = subscribe(schedule);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [refresh, debounceMs]);
}
