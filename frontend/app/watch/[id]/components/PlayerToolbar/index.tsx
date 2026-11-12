"use client";

// Prompt 30: the slim row under the player.
//
// Toggles (Ani.pm style pills): Auto-next and Auto-skip are the SAME saved
// preferences the settings page and the player already read (`usePrefs`), so
// nothing is duplicated here. Theater and Lights off are view modes owned by
// WatchLayout (theater is remembered, lights off is not).
//
// On the right end: Prev / Next as icon+label buttons - the same links, the same
// hrefs and the same disabled rules the controls row used before this prompt.

import Link from "next/link";
import styles from "./component.module.css";
import { usePrefs } from "@/app/lib/user-data/prefs";
import { useWatchUI } from "../WatchLayout";
import { useClipBridge } from "../ClipBridge/context";
import { useWatchStateOptional } from "../WatchState";

/** One size for every toolbar glyph (16px), filled or stroked. */
function Icon({
  path,
  children,
}: {
  path?: string;
  children?: React.ReactNode;
}) {
  const stroked = Boolean(children);
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill={stroked ? "none" : "currentColor"}
      stroke={stroked ? "currentColor" : "none"}
      strokeWidth={stroked ? 1.3 : undefined}
      strokeLinecap={stroked ? "round" : undefined}
      strokeLinejoin={stroked ? "round" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {path ? <path d={path} /> : children}
    </svg>
  );
}

/** Theater: an outlined 16:9 screen with outward widen arrows - not a block. */
function TheaterIcon() {
  return (
    <Icon>
      <rect x="1.35" y="4.3" width="13.3" height="7.4" rx="1.4" />
      <path d="M5.4 8H3.6m1.05-1.15L3.2 8l1.45 1.15" />
      <path d="M10.6 8h1.8m-1.05-1.15L12.8 8l-1.45 1.15" />
    </Icon>
  );
}

const ICON = {
  autoNext:
    "M2 3.5a.5.5 0 0 1 .77-.42l7 4.5a.5.5 0 0 1 0 .84l-7 4.5A.5.5 0 0 1 2 12.5zm11 .5a.5.5 0 0 1 1 0v8a.5.5 0 0 1-1 0z",
  autoSkip: "M2 3.5a.5.5 0 0 1 .8-.4l6 4.5a.5.5 0 0 1 0 .8l-6 4.5a.5.5 0 0 1-.8-.4z",
  lights: "M6 .278a.8.8 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278",
  prev: "M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0",
  next: "M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708",
};

/** Scissors, same 16px box as every other toolbar glyph. */
function ClipIcon() {
  return (
    <Icon>
      <circle cx="3.4" cy="4" r="1.9" />
      <circle cx="3.4" cy="12" r="1.9" />
      <path d="M5 5.2 13.2 12M5 10.8 13.2 4" />
    </Icon>
  );
}

export default function PlayerToolbar({
  anilistId,
  episode,
  audio,
  episodeCount,
}: {
  anilistId: number;
  episode: number;
  audio: "sub" | "dub";
  episodeCount?: number | null;
}) {
  const { prefs, setPref } = usePrefs();
  const ui = useWatchUI();
  const theater = ui?.theater ?? false;
  const lightsOff = ui?.lightsOff ?? false;

  // Prompt 35: the player registers this when it has a real video element it
  // can read and seek. Null (no provider, or nothing registered yet) simply
  // means there is nothing to clip from here.
  const bridge = useClipBridge();
  const clipApi = bridge?.api ?? null;
  const isEmbed = clipApi?.isEmbed === true;
  // Server switching only matters for the embed notice, and it must never throw
  // when the toolbar renders outside WatchState.
  const watch = useWatchStateOptional();
  const nextServer =
    (watch?.servers ?? []).find((server) => server.id !== watch?.activeServerId) ?? null;

  const openClip = () => {
    if (!bridge) return;
    if (typeof document !== "undefined" && document.fullscreenElement) {
      bridge.toast("Exit fullscreen to clip");
      return;
    }
    bridge.openClipPanel();
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Player options">
      <button
        type="button"
        className={styles.tool}
        aria-pressed={prefs.autoNext}
        title="Play the next episode automatically"
        onClick={() => void setPref("autoNext", !prefs.autoNext)}
      >
        <Icon path={ICON.autoNext} />
        <span>Auto-next</span>
      </button>

      <button
        type="button"
        className={styles.tool}
        aria-pressed={prefs.autoSkip}
        title="Skip intros and outros automatically"
        onClick={() => void setPref("autoSkip", !prefs.autoSkip)}
      >
        <Icon path={ICON.autoSkip} />
        <span>Auto-skip</span>
      </button>

      <button
        type="button"
        className={`${styles.tool} ${styles.theater_tool}`}
        aria-pressed={theater}
        title="Widen the player to the full page"
        onClick={() => ui?.toggleTheater()}
      >
        <TheaterIcon />
        <span>Theater</span>
      </button>

      <button
        type="button"
        className={`${styles.tool} ${styles.lights_tool}`}
        aria-pressed={lightsOff}
        title="Dim everything except the player (Esc to exit)"
        onClick={() => ui?.toggleLights()}
      >
        <Icon path={ICON.lights} />
        <span>Lights off</span>
      </button>

      {clipApi && !isEmbed ? (
        <button
          type="button"
          className={`${styles.tool} ${styles.clip_tool}`}
          data-testid="clip-button"
          title="Clip a moment of this episode"
          onClick={openClip}
        >
          <ClipIcon />
          <span className={styles.clip_label}>Clip</span>
        </button>
      ) : null}

      <div className={styles.nav}>
        {episode > 1 ? (
          <Link
            className={styles.nav_button}
            href={`/watch/${anilistId}?ep=${episode - 1}&audio=${audio}`}
          >
            <Icon path={ICON.prev} />
            <span>‹ Prev</span>
          </Link>
        ) : (
          <button type="button" className={styles.nav_button} disabled>
            <Icon path={ICON.prev} />
            <span>‹ Prev</span>
          </button>
        )}

        {episodeCount && episode >= episodeCount ? (
          <button type="button" className={styles.nav_button} disabled>
            <span>Next ›</span>
            <Icon path={ICON.next} />
          </button>
        ) : (
          <Link
            className={styles.nav_button}
            href={`/watch/${anilistId}?ep=${episode + 1}&audio=${audio}`}
          >
            <span>Next ›</span>
            <Icon path={ICON.next} />
          </Link>
        )}
      </div>

      {isEmbed ? (
        <p className={styles.embed_notice} data-testid="clip-embed-notice">
          Clipping is available on the HD player, switch server
          {nextServer ? (
            <button
              type="button"
              className={styles.embed_switch}
              data-testid="clip-switch-server"
              onClick={() => watch?.selectServer(nextServer.id)}
            >
              Switch server
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
