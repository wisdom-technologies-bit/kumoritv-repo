"use client";

// Prompt 35: the card shown when a clip's range ends.
//
// It is rendered inside the player's stage (so it also shows in fullscreen) and
// gives the three ways out: replay the range, continue in the same player, or
// open the full episode page.

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
  return (
    <div className={styles.overlay} data-testid="clip-end-card">
      <div className={styles.card}>
        <p className={styles.kicker}>Clip ended</p>
        <p className={styles.range} data-testid="clip-end-range">
          {formatTime(start)}-{formatTime(end)}
        </p>

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onReplay} data-testid="clip-replay">
            Replay clip
          </button>

          <button type="button" className={styles.secondary} onClick={onContinue} data-testid="clip-continue">
            {mode === "clip" ? "Watch from here" : "Keep watching"}
          </button>

          {mode === "clip" && fullEpisodeHref ? (
            <Link className={styles.secondary} href={fullEpisodeHref} data-testid="clip-full-episode">
              Watch the full episode
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
