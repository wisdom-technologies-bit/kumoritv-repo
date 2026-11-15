"use client";
// The Download button on the watch page.
//
// Nothing renders when the feature flag is off, when the episode has no links or
// when the request failed: the page is exactly as it was before this feature.
// The links are external HTML landing pages, so every quality is a real <a>
// with target=_blank (a window.open from a click handler is what popup blockers
// eat); the sponsor page opens from the same click, at most once per interval.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./component.module.css";
import { openSponsoredPage } from "@/app/lib/downloads/ad";
import DownloadIcon from "@/public/assets/download.svg";
import { DownloadSheet } from "./sheet";

type Payload = import("./sheet").DownloadPayload;

const AUDIO_LABEL: Record<"sub" | "dub", string> = { sub: "Sub", dub: "Dub" };

export default function DownloadEpisode({
  anilistId,
  episode,
}: {
  anilistId: number;
  episode: number;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [audio, setAudio] = useState<"sub" | "dub">("sub");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/downloads?anilistId=${anilistId}&episode=${episode}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: Payload | null) => {
        if (alive && body) setPayload(body);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [anilistId, episode]);

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back to the button that opened the sheet.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  if (!payload || payload.disabled || !payload.available || !payload.groups.length) return null;

  const hasDubbing = payload.groups.some((group) => group.audio === "dub");
  const initialAudio: "sub" | "dub" = hasDubbing && !payload.groups.some((g) => g.audio === "sub") ? "dub" : audio;

  const handleSelect = () => {
    openSponsoredPage(payload.ad ?? null, {
      now: Date.now(),
      storage: typeof window !== "undefined" ? window.localStorage : null,
      open: typeof window !== "undefined" ? window.open.bind(window) : null,
    });
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={styles.button}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-download-button="true"
      >
        <DownloadIcon aria-hidden="true" />
        Download
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <DownloadSheet
              title={`Download Episode ${episode}`}
              payload={payload}
              audio={initialAudio}
              onAudio={setAudio}
              onSelect={handleSelect}
              onClose={close}
              panelRef={panelRef}
            />,
            document.body,
          )
        : null}
    </>
  );
}
