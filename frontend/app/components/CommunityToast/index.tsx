"use client";

// Community Phase 4, part A3: the new-post bar.
//
// ONE provider, mounted ONCE in app/layout.tsx inside <AuthProvider>. It owns
// the only poll of /api/community/latest in the app; the toast and the
// "N new posts" pill on /community both read that one state, so there is never a
// second interval and never two counters that disagree.
//
// Cost when idle:
//   * flag off  -> this component returns its children and renders nothing; no
//                  effect runs, no timer exists, no request is made;
//   * tab hidden-> the timer is cleared and the in-flight request aborted;
//   * quiet     -> one setTimeout per poll (a chain, not an interval), and a
//                  re-render only when something is actually shown.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import {
  TOAST_FADE_MS,
  TOAST_VISIBLE_MS,
  TOAST_MIN_GAP_MS,
  POLL_SECONDS_DEFAULT,
  type LatestItem,
  type ToastState,
  initialToastState,
  nextFlushAt,
  nextToast,
} from "@/app/lib/community/latest";
import { useCommunityToastSetting } from "@/app/lib/community/use-toast-setting";
import { backoffDelay } from "@/app/lib/community/latest";
import { isToastBlocked, subscribeToastOwner } from "@/app/lib/toast/coordinator";
import CommunityToastView from "./view";
import ToastDebugChip, { type ToastDiagnostics } from "./ToastDebugChip";
import { readToastDebug, type ToastDecisionReason } from "./debug";
import styles from "./component.module.css";

export type CommunityLatestConfig = {
  pollMs: number;
  visibleMs: number;
  minGapMs: number;
};

export const DEFAULT_LATEST_CONFIG: CommunityLatestConfig = {
  pollMs: POLL_SECONDS_DEFAULT * 1000,
  visibleMs: TOAST_VISIBLE_MS,
  minGapMs: TOAST_MIN_GAP_MS,
};

type CommunityLatestValue = {
  enabled: boolean;
  /** Items that arrived while the toast was suppressed (only used on /community). */
  newCount: number;
  resetNewCount: () => void;
};

const CommunityLatestContext = createContext<CommunityLatestValue>({
  enabled: false,
  newCount: 0,
  resetNewCount: () => {},
});

export function useCommunityLatest(): CommunityLatestValue {
  return useContext(CommunityLatestContext);
}

/** True on /community and /community/*, where the toast is replaced by the pill. */
export function isCommunityPath(pathname: string | null): boolean {
  const path = pathname ?? "";
  return path === "/community" || path.startsWith("/community/");
}

function isTypingTarget(): boolean {
  if (typeof document === "undefined") return false;
  const element = document.activeElement as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable === true;
}

type VisibleToast = { items: LatestItem[]; leaving: boolean };

const EMPTY_DIAGNOSTICS: ToastDiagnostics = {
  lastPollAt: null,
  lastStatus: "none",
  cursor: null,
  itemsSeen: 0,
  reason: "none new",
  suppressedPath: false,
  viewer: null,
};

export default function CommunityLatestProvider({
  enabled,
  config = DEFAULT_LATEST_CONFIG,
  children,
}: {
  enabled: boolean;
  config?: CommunityLatestConfig;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user } = useUser();
  const { value: settingOn } = useCommunityToastSetting();

  const [newCount, setNewCount] = useState(0);
  const [toast, setToast] = useState<VisibleToast | null>(null);
  const [diagnostics, setDiagnostics] = useState<ToastDiagnostics>(EMPTY_DIAGNOSTICS);
  const [debugVisible, setDebugVisible] = useState(false);

  const stateRef = useRef<ToastState>(initialToastState());
  const etagRef = useRef<string | null>(null);
  const failuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pathRef = useRef<string | null>(pathname);
  const viewerRef = useRef<string | null>(user?.id ?? null);

  // The author's own items must never toast. AuthProvider resolves the user
  // through getUser(), a NETWORK call: until it answers (or if it fails) the
  // viewer looks like a guest, and the first poll can toast the viewer's own
  // post. getSession() reads the SAME session locally from the cookie, so the
  // id is known before the first poll ever fires.
  useEffect(() => {
    if (viewerRef.current) return;
    const client = createBrowserSupabaseClient();
    if (!client) return;
    let active = true;
    void client.auth
      .getSession()
      .then(({ data }) => {
        const id = data.session?.user?.id ?? null;
        if (active && id) viewerRef.current = id;
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);
  const settingRef = useRef<boolean>(settingOn);
  const configRef = useRef<CommunityLatestConfig>(config);
  const toastRef = useRef<VisibleToast | null>(toast);

  pathRef.current = pathname;
  viewerRef.current = user?.id ?? null;
  settingRef.current = settingOn;
  configRef.current = config;
  toastRef.current = toast;

  const remainingRef = useRef(config.visibleMs);
  const startedAtRef = useRef(0);
  const pausedRef = useRef(false);

  function clearTimer(ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
    if (ref.current) clearTimeout(ref.current);
    ref.current = null;
  }

  /* ------------------------------ show / hide ------------------------------ */

  function beginFade(): void {
    clearTimer(hideTimer);
    setToast((current) => (current ? { ...current, leaving: true } : current));
    clearTimer(fadeTimer);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setToast(null);
      stateRef.current = { ...stateRef.current, visibleUntil: null };
      scheduleFlushRef.current(0);
    }, TOAST_FADE_MS);
  }

  function present(items: LatestItem[]): void {
    if (!items.length) return;
    const visibleMs = configRef.current.visibleMs;
    setToast({ items, leaving: false });
    remainingRef.current = visibleMs;
    pausedRef.current = false;
    startedAtRef.current = Date.now();
    stateRef.current = { ...stateRef.current, visibleUntil: Date.now() + visibleMs };
    clearTimer(hideTimer);
    hideTimer.current = setTimeout(() => beginFade(), visibleMs);
  }

  /** Flush whatever the throttle or the on-screen toast held back. */
  function flushPending(): void {
    clearTimer(flushTimer);
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (typeof document !== "undefined" && document.querySelector('[data-preroll="pending"]')) return;
    if (document.fullscreenElement) return;
    if (isCommunityPath(pathRef.current) || isTypingTarget()) return;
    if (!settingRef.current) return;
    if (isToastBlocked("community")) {
      scheduleFlushRef.current(1500);
      return;
    }
    const decision = nextToast(stateRef.current, Date.now(), [], {
      visibleMs: configRef.current.visibleMs,
      minGapMs: configRef.current.minGapMs,
    });
    stateRef.current = decision.state;
    if (decision.show) present(decision.show);
    else {
      const at = nextFlushAt(stateRef.current, { minGapMs: configRef.current.minGapMs });
      if (at !== null) scheduleFlushRef.current(Math.max(50, at - Date.now()));
    }
  }

  function scheduleFlush(delayMs: number): void {
    clearTimer(flushTimer);
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      flushPending();
    }, Math.max(0, delayMs));
  }

  const scheduleFlushRef = useRef(scheduleFlush);
  scheduleFlushRef.current = scheduleFlush;

  /* -------------------------------- polling -------------------------------- */

  /** Which suppressor is active right now, if any (also feeds ?toastdebug=1). */
  function blockReason(): "path" | "fullscreen" | "preroll" | "typing" | null {
    if (isCommunityPath(pathRef.current)) return "path";
    if (typeof document === "undefined") return null;
    if (document.fullscreenElement) return "fullscreen";
    // A pre-roll owns the player: never cover it with a status bar.
    if (document.querySelector('[data-preroll="pending"]')) return "preroll";
    // Never appear over a field the viewer is typing in (phone keyboards).
    if (isTypingTarget()) return "typing";
    return null;
  }

  /** The suppressors that must be true at the moment of showing. */
  function suppressedNow(): boolean {
    return blockReason() !== null;
  }

  function handleItems(items: LatestItem[], serverCursor: string | null): void {
    const before = stateRef.current.cursor;
    const block = blockReason();
    const suppressed = block !== null;
    const defer = isToastBlocked("community");
    // A4: read at poll time, so flipping the switch applies on the next poll.
    const toastOff = !settingRef.current;
    const now = Date.now();

    const decision = nextToast(stateRef.current, now, items, {
      viewerId: viewerRef.current,
      suppressed: suppressed || toastOff,
      defer,
      // The seed comes from the SERVER, never from the newest item in a page
      // that may legitimately be empty.
      serverCursor,
      visibleMs: configRef.current.visibleMs,
      minGapMs: configRef.current.minGapMs,
    });
    stateRef.current = decision.state;

    // The pill's count: only where the toast is suppressed, and never the
    // viewer's own items. The first response is a seed, never a backlog.
    if (suppressed && before !== null && isCommunityPath(pathRef.current)) {
      if (decision.fresh.length > 0) setNewCount((count) => count + decision.fresh.length);
    }

    if (decision.show) present(decision.show);
    else if (defer) scheduleFlush(1500);

    // ?toastdebug=1 only: the one line that answers "why is nothing appearing".
    let reason: ToastDecisionReason;
    if (before === null) reason = "seeded";
    else if (decision.show) reason = "shown";
    else if (toastOff) reason = "setting";
    else if (block) reason = block;
    else if (defer) reason = "deferred";
    else if (decision.ownSkipped > 0 && !decision.fresh.length) {
      // The only new rows were the viewer's own. That IS the answer to "why is
      // nothing appearing" for the owner testing with one account.
      reason = "own item";
    } else if (!decision.fresh.length) {
      reason = "none new";
    } else if (stateRef.current.visibleUntil !== null && now < stateRef.current.visibleUntil) {
      reason = "visible";
    } else if (
      stateRef.current.lastShownAt !== null &&
      now < stateRef.current.lastShownAt + configRef.current.minGapMs
    ) {
      reason = "throttled";
    } else {
      reason = "none new";
    }

    setDiagnostics((current) => ({
      lastPollAt: now,
      lastStatus: current.lastStatus,
      cursor: stateRef.current.cursor,
      itemsSeen: items.length,
      reason,
      suppressedPath: block === "path",
      viewer: viewerRef.current,
    }));
  }

  async function pollOnce(): Promise<void> {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const cursor = stateRef.current.cursor;
    const url = `/api/community/latest?limit=5${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
    const headers: Record<string, string> = {};
    if (etagRef.current) headers["if-none-match"] = etagRef.current;

    const schedule = (delay: number) => {
      clearTimer(pollTimer);
      pollTimer.current = setTimeout(() => {
        pollTimer.current = null;
        void pollOnce();
      }, delay);
    };

    try {
      const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;

      // Nothing new: the steady state. No body, no re-render, next poll on time.
      if (response.status === 304) {
        failuresRef.current = 0;
        setDiagnostics((current) => ({ ...current, lastPollAt: Date.now(), lastStatus: "304" }));
        schedule(configRef.current.pollMs);
        return;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        setDiagnostics((current) => ({ ...current, lastPollAt: Date.now(), lastStatus: "429" }));
        failuresRef.current += 1;
        const fromHeader = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
        schedule(backoffDelay(failuresRef.current, configRef.current.pollMs, fromHeader));
        return;
      }
      if (!response.ok) throw new Error(`latest ${response.status}`);

      etagRef.current = response.headers.get("etag");
      const payload = (await response.json()) as { items?: LatestItem[]; cursor?: string | null };
      if (controller.signal.aborted) return;
      failuresRef.current = 0;
      setDiagnostics((current) => ({ ...current, lastPollAt: Date.now(), lastStatus: "200" }));
      handleItems(
        Array.isArray(payload.items) ? payload.items : [],
        typeof payload.cursor === "string" ? payload.cursor : null,
      );
      schedule(configRef.current.pollMs);
    } catch {
      if (controller.signal.aborted) return;
      failuresRef.current += 1;
      setDiagnostics((current) => ({ ...current, lastPollAt: Date.now(), lastStatus: "error" }));
      schedule(backoffDelay(failuresRef.current, configRef.current.pollMs));
    }
  }

  // Mount, route change and unmount: one place that starts and stops everything.
  // A route change tears the timers down first (the leaked-interval guard) and
  // the new mount polls once immediately.
  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearTimer(pollTimer);
        abortRef.current?.abort();
        return;
      }
      // Back in the tab: one immediate poll, then the normal cadence.
      void pollOnce();
    };
    const unsubscribe = subscribeToastOwner(() => {
      if (!isToastBlocked("community")) scheduleFlushRef.current(0);
    });

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onVisibility);
    void pollOnce();

    return () => {
      clearTimer(pollTimer);
      clearTimer(hideTimer);
      clearTimer(fadeTimer);
      clearTimer(flushTimer);
      abortRef.current?.abort();
      abortRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onVisibility);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pathname]);

  // The pill is a /community surface; walking away clears its count.
  useEffect(() => {
    if (!isCommunityPath(pathname)) setNewCount(0);
  }, [pathname]);

  // Turning the setting off hides a toast that is already on screen and drops
  // anything the throttle was holding; turning it on does not replay the past.
  useEffect(() => {
    if (settingOn) return;
    clearTimer(hideTimer);
    clearTimer(fadeTimer);
    setToast(null);
    stateRef.current = { ...stateRef.current, pending: [], visibleUntil: null };
  }, [settingOn]);

  const resetNewCount = useCallback(() => setNewCount(0), []);

  // ?toastdebug=1 on ANY page: a tiny chip that says why the bar is silent, and
  // one button that renders a fake item through the REAL toast component. The
  // parameter is read from the URL only, never stored, never rendered without it.
  useEffect(() => {
    setDebugVisible(readToastDebug());
  }, [pathname]);

  function showSampleToast(): void {
    present([
      {
        id: "toast-debug-sample",
        kind: "announcement",
        authorId: null,
        authorName: "KumoriTV",
        authorAvatar: null,
        text: "This is a sample toast. Real new posts appear here.",
        hasClip: false,
        clipThumb: null,
        adult: false,
        href: "/community",
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  /* ------------------------------- pause / dismiss ------------------------- */

  function pause(): void {
    if (!toastRef.current || pausedRef.current) return;
    pausedRef.current = true;
    clearTimer(hideTimer);
    const remaining = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    remainingRef.current = remaining;
    stateRef.current = { ...stateRef.current, visibleUntil: Number.POSITIVE_INFINITY };
  }

  function resume(): void {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    startedAtRef.current = Date.now();
    stateRef.current = { ...stateRef.current, visibleUntil: Date.now() + remainingRef.current };
    clearTimer(hideTimer);
    hideTimer.current = setTimeout(() => beginFade(), remainingRef.current);
  }

  function dismiss(): void {
    clearTimer(hideTimer);
    clearTimer(fadeTimer);
    setToast((current) => (current ? { ...current, leaving: true } : current));
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setToast(null);
      stateRef.current = { ...stateRef.current, visibleUntil: null };
      scheduleFlushRef.current(0);
    }, TOAST_FADE_MS);
  }

  const contextValue = useMemo<CommunityLatestValue>(
    () => ({ enabled, newCount, resetNewCount }),
    [enabled, newCount, resetNewCount],
  );

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <CommunityLatestContext.Provider value={contextValue}>
      {children}

      {debugVisible ? (
        <ToastDebugChip
          enabled={enabled}
          settingOn={settingOn}
          pathname={pathname}
          diagnostics={diagnostics}
          onSample={showSampleToast}
        />
      ) : null}

      <div
        className={styles.host}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="community-toast-host"
      >
        {toast ? (
          <CommunityToastView
            items={toast.items}
            leaving={toast.leaving}
            onDismiss={dismiss}
            onPause={pause}
            onResume={resume}
          />
        ) : null}
      </div>
    </CommunityLatestContext.Provider>
  );
}
