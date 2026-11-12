"use client";

// Prompt 35: provider for the clip bridge, the panel and the toast.
//
// The panel is rendered here (not inside the player) and positioned with
// `position: fixed`, so opening it never changes the page layout. The toast is
// the repo's z-toast layer; there was no shared toast component to reuse, so
// this is the one small status surface for clips.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClipPanel from "../ClipPanel";
import { ClipBridgeContext, type PlayerApi } from "./context";

const TOAST_MS = 3200;

export default function ClipBridge({
  anilistId,
  episode,
  audio,
  animeTitle,
  children,
}: {
  anilistId: number;
  episode: number;
  audio: "sub" | "dub";
  animeTitle: string;
  children: React.ReactNode;
}) {
  const [api, setApi] = useState<PlayerApi | null>(null);
  const listeners = useRef(new Set<(time: number) => void>());
  const [open, setOpen] = useState(false);
  const [capturedStart, setCapturedStart] = useState(0);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((next: PlayerApi | null) => {
    setApi(next);
    // A new source means the old player is gone: a panel left open would point
    // at a video that no longer exists.
    if (!next) setOpen(false);
  }, []);

  const subscribe = useCallback((listener: (time: number) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const emitTime = useCallback((time: number) => {
    for (const listener of listeners.current) listener(time);
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const openClipPanel = useCallback(() => {
    // Fullscreen hides nothing but covers the page: the panel would be invisible
    // behind the fullscreen element, so ask the viewer to leave it first.
    if (typeof document !== "undefined" && document.fullscreenElement) {
      showToast("Exit fullscreen to clip");
      return;
    }
    if (!api) {
      showToast("The player is still loading");
      return;
    }
    if (api.isEmbed) {
      showToast("Clipping is available on the HD player, switch server");
      return;
    }
    setCapturedStart(Math.max(0, api.getTime()));
    setOpen(true);
  }, [api, showToast]);

  const closeClipPanel = useCallback(() => setOpen(false), []);

  // Entering fullscreen while the panel is open closes it with the same message.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => {
      if (!document.fullscreenElement) return;
      setOpen((wasOpen) => {
        if (wasOpen) showToast("Exit fullscreen to clip");
        return false;
      });
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [showToast]);

  const value = useMemo(
    () => ({
      api,
      register,
      subscribe,
      emitTime,
      open,
      capturedStart,
      openClipPanel,
      closeClipPanel,
      toast: showToast,
    }),
    [api, register, subscribe, emitTime, open, capturedStart, openClipPanel, closeClipPanel, showToast],
  );

  return (
    <ClipBridgeContext.Provider value={value}>
      {children}
      {open ? (
        <ClipPanel
          anilistId={anilistId}
          episode={episode}
          audio={audio}
          animeTitle={animeTitle}
        />
      ) : null}
      <div className="sr-only" aria-live="polite" data-testid="clip-announcer">
        {toast?.message ?? ""}
      </div>
      {toast ? (
        <div key={toast.id} role="status" data-testid="clip-toast" className="clip-toast">
          {toast.message}
        </div>
      ) : null}
    </ClipBridgeContext.Provider>
  );
}
