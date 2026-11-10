"use client";
// Small client-only helpers the schedule shares. Kept in one file so the
// "is it safe to read localStorage / the clock yet?" answers are consistent.

import { useCallback, useEffect, useState } from "react";

/** False during SSR and the first render, true after mount. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** A ticking "now" (unix seconds) that updates once every `intervalMs`. */
export function useNow(initial: number, intervalMs = 30_000): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The browser's own zone, with a UTC fallback when Intl says nothing. */
export function useViewerTimeZone(): string {
  const [zone, setZone] = useState("UTC");
  useEffect(() => {
    try {
      const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (resolved) setZone(resolved);
    } catch {
      setZone("UTC");
    }
  }, []);
  return zone;
}

/** A localStorage-backed string state that never throws (private mode, etc). */
export function useStoredValue<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && (!allowed || (allowed as readonly string[]).includes(stored))) {
        setValue(stored as T);
      }
    } catch {
      /* storage is optional */
    }
    setReady(true);
  }, [key, allowed]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* ignore a full or blocked store */
      }
    },
    [key],
  );

  // `ready` is exposed through the getter below for callers that must not write
  // a default over a stored value on the first paint.
  void ready;
  return [value, update];
}

/** A localStorage-backed boolean with the same never-throw contract. */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "1") setValue(true);
      else if (stored === "0") setValue(false);
    } catch {
      /* ignore */
    }
  }, [key]);
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, update];
}

/** Subscribes to prefers-reduced-motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduced(query.matches);
      const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
      query.addEventListener("change", handler);
      return () => query.removeEventListener("change", handler);
    } catch {
      return undefined;
    }
  }, []);
  return reduced;
}
