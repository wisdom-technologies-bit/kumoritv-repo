"use client";
// Prompt 38F: the composer's "Add clip" picker.
//
// Two ways to attach a clip, one dialog:
//   "My recent clips" - GET /api/clips/mine, the twenty newest clips of this
//                       account plus the ones this browser made as a guest.
//   "Paste clip URL"  - a link or a bare code, resolved with the public
//                       GET /api/clips/[code], whose `preview` field the server
//                       has already gated for adult clips.
//
// It is a DIALOG rendered through createPortal into document.body, on purpose:
// /community's page root is a stacking context (.page has z-index: 1), and a
// picker painted inside it goes under the site header, which then eats the
// clicks. That exact bug hid the composer sheet in Phase 1.
//
// Desktop: a popover anchored to the "Add clip" button. Mobile: a bottom sheet
// that respects the on-screen keyboard (`visualViewport` + `dvh`).
//
// THE ADULT RULE: a row for an adult clip when the viewer's setting is off is a
// neutral row - the "Adult content 18+" label and "Turn on adult content in
// settings to view", no thumbnail, no anime title, no range. The masked row
// carries nothing else, because /api/clips/mine sent nothing else.

import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "../page.module.css";
import {
  ADULT_HIDDEN_TEXT,
  ADULT_LABEL,
  clipDurationLabel,
  clipMetaLabel,
  clipRangeLabel,
  clipThumbPath,
  readAttachmentFromPreview,
  type AttachedClip,
} from "@/app/lib/community/clip-attachment";
import { clipUrlMessage, parseClipInput } from "@/app/lib/community/clip-url";

export type ClipPickerAnchor = { top: number; left: number; width: number; height: number };

type MineRow = AttachedClip & { views?: number };

type Props = {
  open: boolean;
  anchor: ClipPickerAnchor | null;
  onClose: () => void;
  onPick: (clip: AttachedClip) => void;
  /** True when the viewer's adult setting is on: only used for wording. */
  showAdult?: boolean;
};

type Tab = "mine" | "paste";

export default function ClipPicker({ open, anchor, onClose, onPick, showAdult = false }: Props) {
  const [tab, setTab] = useState<Tab>("mine");
  const [rows, setRows] = useState<MineRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteClip, setPasteClip] = useState<AttachedClip | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [canPortal, setCanPortal] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const mineTabRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resolveTicket = useRef(0);
  const baseId = useId();

  useEffect(() => setCanPortal(true), []);

  // ---------------------------------------------------------------- focus ----
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Focus the first thing that is actually useful: the first row when the
    // list has loaded, the tab strip otherwise.
    const first =
      (dialog.querySelector<HTMLElement>("[data-autofocus='true']") as HTMLElement | null) ??
      mineTabRef.current ??
      dialog;
    first.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      // A dialog keeps Tab inside itself.
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  // When the list lands, move focus to the first row - unless the person has
  // already moved on to the paste field.
  useEffect(() => {
    if (!open || tab !== "mine" || !rows || rows.length === 0) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement as HTMLElement | null;
    const isOurs = Boolean(active && dialog.contains(active));
    if (!isOurs || active === mineTabRef.current || active === dialog) {
      dialog.querySelector<HTMLElement>("[data-autofocus='true']")?.focus({ preventScroll: true });
    }
  }, [open, tab, rows]);

  // ------------------------------------------------------------- keyboard ----
  // The bottom sheet has to sit above the on-screen keyboard, not under it.
  useEffect(() => {
    if (!open) {
      setKeyboardOffset(0);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const offset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      setKeyboardOffset(offset > 80 ? offset : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);

  // ----------------------------------------------------------------- load ----
  const loadMine = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/clips/mine", { headers: { accept: "application/json" } });
      const payload = (await response.json().catch(() => ({}))) as {
        clips?: any[];
        message?: string;
        error?: string;
      };
      if (response.status === 401) {
        setRows([]);
        setLoadError("Sign in to see your clips.");
        return;
      }
      if (!response.ok || !Array.isArray(payload.clips)) {
        setRows([]);
        setLoadError(payload.message || "We could not load your clips.");
        return;
      }
      setRows(
        payload.clips.map((row) => ({
          ...readAttachmentFromPreview(row),
          views: typeof row?.views === "number" ? row.views : 0,
        })),
      );
    } catch {
      setRows([]);
      setLoadError("We could not load your clips. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || tab !== "mine") return;
    if (rows !== null) return;
    void loadMine();
  }, [open, tab, rows, loadMine]);

  // A fresh dialog each time it opens.
  useEffect(() => {
    if (open) return;
    setTab("mine");
    setPasteValue("");
    setPasteClip(null);
    setPasteError(null);
    setRows(null);
  }, [open]);

  // ---------------------------------------------------------------- paste ----
  const resolve = useCallback(async (value: string) => {
    const ticket = ++resolveTicket.current;
    setPasteError(null);
    setPasteClip(null);

    const trimmed = value.trim();
    if (!trimmed) {
      setIsResolving(false);
      return;
    }

    const parsed = parseClipInput(trimmed);
    if (parsed.kind !== "clip") {
      setPasteError(clipUrlMessage(parsed));
      setIsResolving(false);
      return;
    }

    setIsResolving(true);
    try {
      const response = await fetch(`/api/clips/${encodeURIComponent(parsed.code)}`, {
        headers: { accept: "application/json" },
      });
      if (ticket !== resolveTicket.current) return;

      if (response.status === 404) {
        setPasteError("That clip does not exist. It may have been deleted.");
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { preview?: unknown };
      if (!response.ok || !payload.preview) {
        setPasteError("We could not open that clip. Try again.");
        return;
      }
      if (ticket !== resolveTicket.current) return;
      setPasteClip(readAttachmentFromPreview({ ...(payload.preview as object), code: parsed.code }));
    } catch {
      if (ticket === resolveTicket.current) setPasteError("We could not open that clip. Check your connection.");
    } finally {
      if (ticket === resolveTicket.current) setIsResolving(false);
    }
  }, []);

  useEffect(() => {
    if (!open || tab !== "paste") return;
    if (!pasteValue.trim()) {
      setPasteClip(null);
      setPasteError(null);
      setIsResolving(false);
      return;
    }
    setIsResolving(true);
    const timer = window.setTimeout(() => void resolve(pasteValue), 320);
    return () => window.clearTimeout(timer);
  }, [pasteValue, open, tab, resolve]);

  // ------------------------------------------------------------ tab keys -----
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Tab = tab === "mine" ? "paste" : "mine";
    setTab(next);
    window.requestAnimationFrame(() => {
      const el = dialogRef.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`);
      el?.focus();
    });
  };

  if (!open) return null;

  const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 720px)").matches;
  const popoverStyle: React.CSSProperties =
    isDesktop && anchor
      ? {
          top: Math.min(Math.max(anchor.top + anchor.height + 8, 12), Math.max(12, window.innerHeight - 460)),
          left: Math.min(Math.max(anchor.left, 12), Math.max(12, window.innerWidth - 420)),
          width: Math.min(400, window.innerWidth - 24),
        }
      : {};

  const dialog = (
    <>
      <div className={styles.picker_scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a clip"
        tabIndex={-1}
        className={isDesktop ? styles.picker_popover : styles.picker_sheet}
        style={{ ...popoverStyle, ...(keyboardOffset ? { bottom: keyboardOffset } : {}) }}
        data-clip-picker="true"
      >
        <div className={styles.picker_head}>
          <span className={styles.picker_title}>Add a clip</span>
          <button type="button" className={styles.button_link} onClick={onClose}>
            Close
          </button>
        </div>

        <div
          className={styles.picker_tabs}
          role="tablist"
          aria-label="Where to find the clip"
          onKeyDown={onTabKeyDown}
        >
          <button
            ref={mineTabRef}
            type="button"
            role="tab"
            data-tab="mine"
            id={`${baseId}-tab-mine`}
            aria-selected={tab === "mine"}
            aria-controls={`${baseId}-panel-mine`}
            tabIndex={tab === "mine" ? 0 : -1}
            className={styles.picker_tab}
            data-active={tab === "mine"}
            onClick={() => setTab("mine")}
          >
            My recent clips
          </button>
          <button
            type="button"
            role="tab"
            data-tab="paste"
            id={`${baseId}-tab-paste`}
            aria-selected={tab === "paste"}
            aria-controls={`${baseId}-panel-paste`}
            tabIndex={tab === "paste" ? 0 : -1}
            className={styles.picker_tab}
            data-active={tab === "paste"}
            onClick={() => {
              setTab("paste");
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            Paste clip URL
          </button>
        </div>

        {tab === "mine" ? (
          <div
            className={styles.picker_panel}
            role="tabpanel"
            id={`${baseId}-panel-mine`}
            aria-labelledby={`${baseId}-tab-mine`}
            tabIndex={0}
          >
            {isLoading && (
              <ul className={styles.picker_list} aria-hidden="true">
                {[0, 1, 2].map((key) => (
                  <li key={key} className={styles.picker_row_skeleton}>
                    <span className={styles.picker_thumb_skeleton} />
                    <span className={styles.picker_lines}>
                      <span className={styles.picker_line} />
                      <span className={styles.picker_line_short} />
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {!isLoading && loadError && (
              <div className={styles.picker_empty} role="alert">
                <p className={styles.picker_empty_text}>{loadError}</p>
                <button type="button" className={styles.button_ghost} onClick={() => void loadMine()}>
                  Try again
                </button>
              </div>
            )}

            {!isLoading && !loadError && rows && rows.length === 0 && (
              <div className={styles.picker_empty}>
                <p className={styles.picker_empty_title}>No clips yet</p>
                <p className={styles.picker_empty_text}>
                  You have no clips yet. Make one from any episode with the Clip button.
                </p>
                <Link className={styles.button_ghost} href="/" onClick={onClose}>
                  Find something to watch
                </Link>
              </div>
            )}

            {!isLoading && !loadError && rows && rows.length > 0 && (
              <ul className={styles.picker_list} ref={listRef}>
                {rows.map((row, index) => (
                  <li key={`${row.code}-${index}`}>
                    <button
                      type="button"
                      className={styles.picker_row}
                      data-autofocus={index === 0 ? "true" : undefined}
                      onClick={() => {
                        onPick(row);
                        onClose();
                      }}
                    >
                      {row.hidden ? (
                        <span className={styles.picker_thumb_adult} aria-hidden="true">
                          18+
                        </span>
                      ) : (
                        <Thumb clip={row} />
                      )}
                      <span className={styles.picker_row_text}>
                        {row.hidden ? (
                          <>
                            <span className={styles.adult_label}>{ADULT_LABEL}</span>
                            <span className={styles.picker_row_meta}>{ADULT_HIDDEN_TEXT}</span>
                          </>
                        ) : (
                          <>
                            <span className={styles.picker_row_title}>
                              {clipMetaLabel(row.animeTitle, row.episode) || `Clip ${row.code}`}
                            </span>
                            <span className={styles.picker_row_meta}>
                              {[clipRangeLabel(row.start, row.end), clipDurationLabel(row.start, row.end)]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div
            className={styles.picker_panel}
            role="tabpanel"
            id={`${baseId}-panel-paste`}
            aria-labelledby={`${baseId}-tab-paste`}
          >
            <label className={styles.picker_label} htmlFor={`${baseId}-input`}>
              Clip link or code
            </label>
            <input
              id={`${baseId}-input`}
              ref={inputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              className={styles.picker_input}
              placeholder="kumoritv.top/clip/abc2345"
              value={pasteValue}
              onChange={(event) => setPasteValue(event.target.value)}
              aria-describedby={`${baseId}-paste-help`}
              aria-invalid={pasteError ? true : undefined}
            />
            <p className={styles.picker_help} id={`${baseId}-paste-help`}>
              A link from any KumoriTV clip, or just the 7-character code.
            </p>

            {isResolving && <p className={styles.picker_help}>Looking for that clip…</p>}
            {pasteError && (
              <p className={styles.errors} role="alert">
                {pasteError}
              </p>
            )}

            {pasteClip && !isResolving && (
              <div className={styles.picker_preview}>
                {pasteClip.hidden ? (
                  <div className={styles.adult_card}>
                    <span className={styles.adult_label}>{ADULT_LABEL}</span>
                    <p className={styles.adult_text}>{ADULT_HIDDEN_TEXT}</p>
                  </div>
                ) : (
                  <div className={styles.attach_card}>
                    <Thumb clip={pasteClip} className={styles.attach_thumb} />
                    <div className={styles.attach_text}>
                      <span className={styles.attach_title}>
                        {clipMetaLabel(pasteClip.animeTitle, pasteClip.episode) || `Clip ${pasteClip.code}`}
                      </span>
                      <span className={styles.attach_meta}>
                        {[clipRangeLabel(pasteClip.start, pasteClip.end), clipDurationLabel(pasteClip.start, pasteClip.end)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    onPick(pasteClip);
                    onClose();
                  }}
                >
                  Attach this clip
                </button>
              </div>
            )}

            {!pasteClip && !pasteError && !isResolving && (
              <p className={styles.picker_help}>
                {showAdult
                  ? "Adult content is on for your account, so adult clips show their preview."
                  : "Adult clips will attach with their preview hidden until you turn adult content on in settings."}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );

  return canPortal && typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}

/** The same-origin episode thumbnail, with a quiet placeholder. */
function Thumb({ clip, className }: { clip: AttachedClip; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = clipThumbPath(clip.anilistId, clip.episode);

  if (!src || broken) {
    return <span className={className ? `${styles.picker_thumb} ${className}` : styles.picker_thumb} aria-hidden="true" data-placeholder="true" />;
  }

  return (
    <span className={className ? `${styles.picker_thumb} ${className}` : styles.picker_thumb}>
      <Image
        src={src}
        alt=""
        width={96}
        height={54}
        sizes="96px"
        onError={() => setBroken(true)}
        unoptimized
      />
    </span>
  );
}
