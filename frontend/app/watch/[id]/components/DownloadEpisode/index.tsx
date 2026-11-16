"use client";
// Prompt 41 (B): Download as a pill in the toolbar row, with a dropdown.
//
// Nothing renders when downloads are off, when the episode has no links or when
// the request failed: the page is exactly as it was before this feature. The
// pill never navigates by itself - it only toggles the menu. Every quality is a
// real <a target="_blank" rel="noopener noreferrer nofollow">, so popup blockers
// do not interfere; the sponsor page still opens from that same click through
// openSponsoredPage(), exactly as Prompt 39 left it.
//
// The links are prefetched 2s after the toolbar mounts (idle delay): the pill is
// only rendered once we know the episode really has downloads, and opening the
// menu is instant when the viewer taps it. Fetching on first open instead would
// mean a pill that may lead nowhere plus a spinner on every tap.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import toolbarStyles from "../PlayerToolbar/component.module.css";
import styles from "./component.module.css";
import { openSponsoredPage } from "@/app/lib/downloads/ad";
import DownloadIcon from "@/public/assets/download.svg";
import { DownloadMenu, type DownloadPayload } from "./menu";
import { placeMenu, type MenuPlacement } from "./position";

type FetchState = "idle" | "loading" | "ready" | "error";

export default function DownloadEpisode({
  anilistId,
  episode,
}: {
  anilistId: number;
  episode: number;
}) {
  const [payload, setPayload] = useState<DownloadPayload | null>(null);
  const [state, setState] = useState<FetchState>("idle");
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [mounted, setMounted] = useState(false);

  const pillRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  const pathname = usePathname();

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? current : "loading"));
    try {
      const response = await fetch(`/api/downloads?anilistId=${anilistId}&episode=${episode}`);
      const body = (response.ok ? await response.json() : null) as DownloadPayload | null;
      if (!aliveRef.current) return;
      if (!body) {
        setState("error");
        return;
      }
      setPayload(body);
      setState("ready");
    } catch {
      if (aliveRef.current) setState("error");
    }
  }, [anilistId, episode]);

  useEffect(() => {
    aliveRef.current = true;
    setMounted(true);
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Two seconds of idle after the toolbar appears, then one request.
  useEffect(() => {
    if (state !== "idle") return undefined;
    const id = window.setTimeout(() => void load(), 2000);
    return () => window.clearTimeout(id);
  }, [state, load]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => pillRef.current?.focus(), 0);
  }, []);

  // Route change (next episode) and fullscreen both end the menu.
  useEffect(() => {
    if (!open) return;
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onFullscreen = () => setOpen(false);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, [open]);

  const position = useCallback(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const rect = pill.getBoundingClientRect();
    const menu = menuRef.current;
    setPlacement(
      placeMenu(
        { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        { width: menu?.offsetWidth || 300, height: menu?.offsetHeight || 260 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    position();
  }, [open, position, state]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || pillRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[index <= 0 ? items.length - 1 : index - 1]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [open, close, position]);

  // Focus the first quality once the menu is on screen.
  useEffect(() => {
    if (!open || state !== "ready") return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, state]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    if (state === "idle" || state === "error") void load();
    setOpen(true);
  };

  const handleSelect = () => {
    openSponsoredPage(payload?.ad ?? null, {
      now: Date.now(),
      storage: typeof window !== "undefined" ? window.localStorage : null,
      open: typeof window !== "undefined" ? window.open.bind(window) : null,
    });
    close();
  };

  // The pill exists only when there is something to download... or when the
  // request failed, so the menu can say so and offer a retry.
  const showPill = state === "error" || (state === "ready" && Boolean(payload?.available) && Boolean(payload?.groups?.length));

  if (!mounted || !showPill) return null;

  return (
    <>
      <button
        type="button"
        ref={pillRef}
        className={toolbarStyles.tool}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download this episode"
        onClick={toggle}
        data-download-button="true"
      >
        <DownloadIcon aria-hidden="true" />
        <span className={styles.label}>Download</span>
      </button>

      {open && placement
        ? createPortal(
            <div
              className={styles.menu_layer}
              data-download-menu="true"
              style={{
                left: `${placement.left}px`,
                top: `${placement.top}px`,
                width: `${placement.width}px`,
                maxHeight: `${placement.maxHeight}px`,
              }}
            >
              {state === "error" ? (
                <p className={styles.menu_status}>
                  Downloads aren&apos;t available right now.
                  <button type="button" className={styles.retry} onClick={() => void load()}>
                    Try again
                  </button>
                </p>
              ) : !payload ? (
                <p className={styles.menu_status}>Loading downloads…</p>
              ) : (
                <DownloadMenu
                  episode={episode}
                  payload={payload}
                  onSelect={handleSelect}
                  menuRef={menuRef}
                />
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
