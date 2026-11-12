"use client";

// Prompt 35: the clip panel.
//
// Quick mode captures the moment "Clip" was pressed and defaults the end to
// +15 s; "Enter time" takes typed times. Either way the result is a LINK to a
// range: nothing is cut, downloaded or re-uploaded.
//
// It is a dialog: focus is trapped, Esc closes it, focus returns to the button
// that opened it. On phones it is a bottom sheet, on desktop a side popover, and
// both are `position: fixed` so opening it never shifts the page.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./component.module.css";
import {
  CLIP_MAX_SECONDS_GUEST,
  CLIP_MAX_SECONDS_USER,
  CLIP_MIN_SECONDS,
  CLIP_TITLE_MAX_LENGTH,
} from "@/app/lib/clips/constants";
import { formatTime, parseTimeInput } from "@/app/lib/clips/time";
import { moveHandle, quickRange, validateClipRange } from "@/app/lib/clips/range";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { useClipBridge } from "../ClipBridge/context";

type Tab = "quick" | "manual";

const NUDGES = [-5, -1, 1, 5] as const;

export default function ClipPanel({
  anilistId,
  episode,
  audio,
  animeTitle,
}: {
  anilistId: number;
  episode: number;
  audio: "sub" | "dub";
  animeTitle: string;
}) {
  const bridge = useClipBridge();
  const { user } = useUser();
  const signedIn = Boolean(user);
  const maxSeconds = signedIn ? CLIP_MAX_SECONDS_USER : CLIP_MAX_SECONDS_GUEST;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<"start" | "end" | null>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);

  const [duration, setDuration] = useState(() => bridge?.api?.getDuration() ?? 0);
  const [range, setRange] = useState(() =>
    quickRange(bridge?.capturedStart ?? 0, bridge?.api?.getDuration() ?? 0, maxSeconds),
  );
  const [tab, setTab] = useState<Tab>("quick");
  const [fromText, setFromText] = useState(() => formatTime(range.start));
  const [toText, setToText] = useState(() => formatTime(range.end));
  const [manualError, setManualError] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "created" | "error">("idle");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ url: string; start: number; end: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<"idle" | "playing" | "ended">("idle");

  const titleId = useId();
  const fromId = useId();
  const toId = useId();
  const hintId = useId();

  const close = useCallback(() => {
    // Closing during a preview must not pause the episode: the subscription that
    // would pause it is removed with the panel.
    setPreview("idle");
    bridge?.closeClipPanel();
  }, [bridge]);

  // Duration arrives after the panel opens: pick it up and keep the range inside
  // the episode.
  useEffect(() => {
    if (!bridge?.api) return;
    const read = () => {
      const value = bridge.api?.getDuration() ?? 0;
      if (value > 0) setDuration((current) => (current === value ? current : value));
    };
    read();
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, [bridge?.api]);

  useEffect(() => {
    if (!(duration > 0)) return;
    setRange((current) =>
      current.end > duration + 0.05
        ? { start: Math.max(0, Math.min(current.start, duration - CLIP_MIN_SECONDS)), end: duration }
        : current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // Focus trap + Esc + focus restore.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null || element.tabIndex >= 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || !panel?.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const firstField = focusable()[0];
    firstField?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = useMemo(
    () =>
      validateClipRange({
        start: range.start,
        end: range.end,
        duration: duration > 0 ? duration : null,
        maxSeconds,
      }),
    [range.start, range.end, duration, maxSeconds],
  );

  const scale = useMemo(() => {
    if (duration > 0) return duration;
    return Math.max(range.end, CLIP_MIN_SECONDS);
  }, [duration, range.end]);

  const percent = (seconds: number) =>
    `${Math.min(100, Math.max(0, (seconds / (scale || 1)) * 100))}%`;

  const nudge = (handle: "start" | "end", delta: number) =>
    setRange((current) => moveHandle(current, handle, delta, { duration: duration || null, maxSeconds }));

  const timeAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * (scale || 1);
  };

  const onHandleMove = (handle: "start" | "end") => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragging.current !== handle) return;
    const target = timeAt(event.clientX);
    setRange((current) => moveHandle(current, handle, target - current[handle], { duration: duration || null, maxSeconds }));
  };

  const onHandleKey = (handle: "start" | "end") => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge(handle, -step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      nudge(handle, step);
    } else if (event.key === "Home") {
      event.preventDefault();
      nudge(handle, -3600);
    } else if (event.key === "End") {
      event.preventDefault();
      nudge(handle, 3600);
    }
  };

  const applyManual = (which: "from" | "to", text: string) => {
    const nextFrom = which === "from" ? text : fromText;
    const nextTo = which === "to" ? text : toText;
    if (which === "from") setFromText(text);
    else setToText(text);

    if (!nextFrom.trim() || !nextTo.trim()) {
      setManualError("");
      return;
    }
    const from = parseTimeInput(nextFrom);
    const to = parseTimeInput(nextTo);
    if (from === null || to === null) {
      setManualError("Enter a time like 1:05 or 65.");
      return;
    }
    const result = validateClipRange({ start: from, end: to, duration: duration > 0 ? duration : null, maxSeconds });
    if (!result.ok) {
      setManualError(result.message);
      return;
    }
    setManualError("");
    setRange({ start: result.start, end: result.end });
  };

  const useCurrent = (which: "from" | "to") => {
    const time = Math.max(0, bridge?.api?.getTime() ?? 0);
    const text = formatTime(time);
    if (which === "from") {
      setFromText(text);
      applyManual("from", text);
    } else {
      setToText(text);
      applyManual("to", text);
    }
  };

  // Preview: seek to the start, play, and pause exactly at the end.
  const previewEndRef = useRef(range.end);
  previewEndRef.current = range.end;

  const startPreview = () => {
    const api = bridge?.api;
    if (!api) return;
    previewEndRef.current = range.end;
    api.seek(range.start);
    api.play();
    setPreview("playing");
  };

  useEffect(() => {
    if (preview !== "playing" || !bridge) return;
    return bridge.subscribe((time) => {
      if (time >= previewEndRef.current - 0.05) {
        bridge.api?.pause();
        setPreview("ended");
      }
    });
  }, [preview, bridge]);

  useEffect(() => {
    if (preview === "playing") {
      setPreview("idle");
    }
    // Dragging handles or switching tabs cancels a running preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end]);

  const createClip = async () => {
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setStatus("saving");
    setError("");
    // Never pause the episode once a clip exists.
    setPreview("idle");
    try {
      const response = await fetch("/api/clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          anilistId,
          episode,
          start: range.start,
          end: range.end,
          title: title.trim() ? title.trim() : null,
          audio,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus("error");
        setError(
          typeof body?.message === "string" && body.message
            ? body.message
            : "Could not create the clip. Try again.",
        );
        return;
      }
      setCreated({
        url: new URL(String(body?.url || ""), window.location.origin).toString(),
        start: range.start,
        end: range.end,
      });
      setStatus("created");
      bridge?.toast("Clip link ready");
    } catch {
      setStatus("error");
      setError("Could not create the clip. Check your connection.");
    }
  };

  const copyLink = async () => {
    const url = created?.url ?? "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      bridge?.toast("Link copied");
      return;
    } catch {
      /* fall through to the selection fallback */
    }
    const input = linkRef.current;
    if (!input) return;
    input.focus();
    input.select();
    try {
      const ok = typeof document.execCommand === "function" && document.execCommand("copy");
      setCopied(ok);
      bridge?.toast(ok ? "Link copied" : "Copy the link above");
    } catch {
      bridge?.toast("Copy the link above");
    }
  };

  const shareLink = async () => {
    const url = created?.url ?? "";
    if (!url || typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title: `${animeTitle} clip`, url });
    } catch {
      /* the viewer cancelled: nothing to report */
    }
  };

  const startPercent = percent(range.start);
  const endPercent = percent(range.end);

  return (
    <>
      <div className={styles.scrim} onClick={close} aria-hidden="true" />
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Create a clip"
        data-testid="clip-panel"
        ref={panelRef}
      >
        <div className={styles.head}>
          <div>
            <h2 className={styles.title}>Create a clip</h2>
            <p className={styles.subtitle} data-testid="clip-range-label">
              Ep {episode} · {formatTime(range.start)}-{formatTime(range.end)}
              <span className={styles.muted}> ({Math.round((range.end - range.start) * 10) / 10}s)</span>
            </p>
          </div>
          <button type="button" className={styles.close} onClick={close} aria-label="Close clip panel">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
            </svg>
          </button>
        </div>

        {status === "created" && created ? (
          <div className={styles.share} data-testid="clip-share">
            <p className={styles.share_title}>Your clip link is ready</p>
            <p className={styles.share_range}>
              {formatTime(created.start)}-{formatTime(created.end)}
            </p>
            <input
              ref={linkRef}
              className={styles.link_input}
              data-testid="clip-link"
              value={created.url}
              readOnly
              aria-label="Clip link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={copyLink} data-testid="clip-copy">
                {copied ? "Copied" : "Copy link"}
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
                <button type="button" className={styles.secondary} onClick={shareLink} data-testid="clip-share-native">
                  Share
                </button>
              ) : null}
              <a className={styles.secondary} href={created.url} target="_blank" rel="noreferrer" data-testid="clip-open">
                Open clip
              </a>
              <button type="button" className={styles.ghost} onClick={close}>
                Done
              </button>
            </div>
            <p className={styles.hint}>The episode keeps playing. A clip is a link to a time range, not a download.</p>
          </div>
        ) : (
          <>
            <div className={styles.tabs} role="tablist" aria-label="How to set the range">
              <button
                type="button"
                role="tab"
                id="clip-tab-quick"
                aria-selected={tab === "quick"}
                aria-controls="clip-tabpanel"
                className={styles.tab}
                data-testid="clip-tab-quick"
                onClick={() => setTab("quick")}
              >
                Quick
              </button>
              <button
                type="button"
                role="tab"
                id="clip-tab-manual"
                aria-selected={tab === "manual"}
                aria-controls="clip-tabpanel"
                className={styles.tab}
                data-testid="clip-tab-manual"
                onClick={() => {
                  setTab("manual");
                  setFromText(formatTime(range.start));
                  setToText(formatTime(range.end));
                  setManualError("");
                }}
              >
                Enter time
              </button>
            </div>

            <div role="tabpanel" id="clip-tabpanel" aria-labelledby={tab === "quick" ? "clip-tab-quick" : "clip-tab-manual"}>
              {tab === "quick" ? (
                <div className={styles.quick}>
                  <div className={styles.bar} ref={barRef}>
                    <div className={styles.track} aria-hidden="true" />
                    <div
                      className={styles.fill}
                      aria-hidden="true"
                      style={{ left: startPercent, width: `${Math.max(0, ((range.end - range.start) / (scale || 1)) * 100)}%` }}
                    />
                    <button
                      type="button"
                      className={styles.handle}
                      data-testid="clip-handle-start"
                      role="slider"
                      aria-label="Clip start"
                      aria-valuemin={0}
                      aria-valuemax={Math.max(0, Math.round(range.end - CLIP_MIN_SECONDS))}
                      aria-valuenow={Math.round(range.start)}
                      aria-valuetext={formatTime(range.start)}
                      style={{ left: startPercent }}
                      onPointerDown={(event) => {
                        dragging.current = "start";
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                      }}
                      onPointerMove={onHandleMove("start")}
                      onPointerUp={() => {
                        dragging.current = null;
                      }}
                      onPointerCancel={() => {
                        dragging.current = null;
                      }}
                      onKeyDown={onHandleKey("start")}
                    />
                    <button
                      type="button"
                      className={styles.handle}
                      data-testid="clip-handle-end"
                      role="slider"
                      aria-label="Clip end"
                      aria-valuemin={Math.min(Math.round(scale), Math.round(range.start + CLIP_MIN_SECONDS))}
                      aria-valuemax={Math.round(scale)}
                      aria-valuenow={Math.round(range.end)}
                      aria-valuetext={formatTime(range.end)}
                      style={{ left: endPercent }}
                      onPointerDown={(event) => {
                        dragging.current = "end";
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                      }}
                      onPointerMove={onHandleMove("end")}
                      onPointerUp={() => {
                        dragging.current = null;
                      }}
                      onPointerCancel={() => {
                        dragging.current = null;
                      }}
                      onKeyDown={onHandleKey("end")}
                    />
                  </div>

                  <div className={styles.nudges}>
                    {(["start", "end"] as const).map((handle) => (
                      <div key={handle} className={styles.nudge_row}>
                        <span className={styles.nudge_label}>
                          {handle === "start" ? "Start" : "End"}{" "}
                          <strong>{formatTime(handle === "start" ? range.start : range.end)}</strong>
                        </span>
                        <span className={styles.nudge_buttons}>
                          {NUDGES.map((delta) => (
                            <button
                              key={`${handle}-${delta}`}
                              type="button"
                              className={styles.nudge}
                              onClick={() => nudge(handle, delta)}
                              aria-label={`Move ${handle} ${delta > 0 ? "forward" : "back"} ${Math.abs(delta)} seconds`}
                            >
                              {delta > 0 ? `+${delta}` : delta}s
                            </button>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        if (preview === "playing") {
                          bridge?.api?.pause();
                          setPreview("idle");
                          return;
                        }
                        startPreview();
                      }}
                      data-testid="clip-preview"
                    >
                      {preview === "playing" ? "Stop" : preview === "ended" ? "Replay" : "Preview"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.manual}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={fromId}>
                      From
                    </label>
                    <div className={styles.input_row}>
                      <input
                        id={fromId}
                        className={styles.input}
                        data-testid="clip-from"
                        value={fromText}
                        inputMode="numeric"
                        autoComplete="off"
                        aria-invalid={Boolean(manualError)}
                        aria-describedby={hintId}
                        onChange={(event) => applyManual("from", event.target.value)}
                      />
                      <button type="button" className={styles.ghost} onClick={() => useCurrent("from")}>
                        Use current
                      </button>
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={toId}>
                      To
                    </label>
                    <div className={styles.input_row}>
                      <input
                        id={toId}
                        className={styles.input}
                        data-testid="clip-to"
                        value={toText}
                        inputMode="numeric"
                        autoComplete="off"
                        aria-invalid={Boolean(manualError)}
                        aria-describedby={hintId}
                        onChange={(event) => applyManual("to", event.target.value)}
                      />
                      <button type="button" className={styles.ghost} onClick={() => useCurrent("to")}>
                        Use current
                      </button>
                    </div>
                  </div>

                  <p id={hintId} className={styles.hint} role={manualError ? "alert" : undefined} data-testid="clip-hint">
                    {manualError ||
                      `m:ss, h:mm:ss or plain seconds. ${CLIP_MIN_SECONDS}-${maxSeconds} seconds.`}
                  </p>
                </div>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={titleId}>
                Title <span className={styles.muted}>(optional)</span>
              </label>
              <input
                id={titleId}
                className={styles.input}
                data-testid="clip-title"
                value={title}
                maxLength={CLIP_TITLE_MAX_LENGTH}
                placeholder="Best fight"
                autoComplete="off"
                onChange={(event) => setTitle(event.target.value)}
              />
              <span className={styles.counter}>
                {title.length}/{CLIP_TITLE_MAX_LENGTH}
              </span>
            </div>

            {!check.ok ? (
              <p className={styles.error} role="alert" data-testid="clip-range-error">
                {check.message}
              </p>
            ) : null}
            {error ? (
              <p className={styles.error} role="alert" data-testid="clip-error">
                {error}
              </p>
            ) : null}

            <div className={styles.footer}>
              <button
                type="button"
                className={styles.primary}
                onClick={createClip}
                disabled={status === "saving" || !check.ok}
                data-testid="clip-create"
              >
                {status === "saving" ? "Creating…" : "Create clip"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
