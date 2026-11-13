"use client";

// Prompt 35: the card shown when a clip's range ends.
//
// It is rendered inside the player's stage (so it also shows in fullscreen) and
// gives the three ways out: replay the range, continue in the same player, or
// open the full episode page.
//
// Prompt 36: presentation only. On the /clip/[code] page (`mode: "clip"`) it is
// a compact panel that always fits inside the player: one line of label + range,
// then the three actions in a single wrapping row, sized with the player's own
// container query units. The `mode: "watch"` range card on /watch keeps exactly
// the layout it had.

import Link from "next/link";
import styles from "./component.module.css";
import { formatTime } from "@/app/lib/clips/time";

export default function ClipEndCard({
  start,
  end,
  mode,
  fullEpisodeHref,
  onReplay,
  onContinue,
}: {
  start: number;
  end: number;
  mode: "clip" | "watch";
  fullEpisodeHref?: string;
  onReplay: () => void;
  onContinue: () => void;
}) {
  // The clip page's player is the container the panel measures itself against.
  const compact = mode === "clip";

  return (
    <div
      className={compact ? `${styles.overlay} ${styles.overlay_compact}` : styles.overlay}
      data-testid="clip-end-card"
      data-compact={compact ? "true" : undefined}
    >
      <div className={compact ? `${styles.card} ${styles.card_compact}` : styles.card}>
        {compact ? (
          <p className={styles.heading}>
            <span className={styles.kicker}>Clip ended</span>
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span className={styles.range} data-testid="clip-end-range">
              {formatTime(start)}-{formatTime(end)}
            </span>
          </p>
        ) : (
          <>
            <p className={styles.kicker}>Clip ended</p>
            <p className={styles.range} data-testid="clip-end-range">
              {formatTime(start)}-{formatTime(end)}
            </p>
          </>
        )}

        <div className={compact ? `${styles.actions} ${styles.actions_compact}` : styles.actions}>
          <button type="button" className={styles.primary} onClick={onReplay} data-testid="clip-replay">
            Replay clip
          </button>

          <button type="button" className={styles.secondary} onClick={onContinue} data-testid="clip-continue">
            {mode === "clip" ? "Watch from here" : "Keep watching"}
          </button>

          {mode === "clip" && fullEpisodeHref ? (
            <Link
              className={compact ? styles.link : styles.secondary}
              href={fullEpisodeHref}
              data-testid="clip-full-episode"
            >
              Watch the full episode
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
