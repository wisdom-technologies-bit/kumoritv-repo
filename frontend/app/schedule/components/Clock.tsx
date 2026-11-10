"use client";
// The live "Now" clock. Purely decorative for assistive tech: the page-level
// time is already in the heading block and the countdowns are text, so this is
// aria-hidden and never announced on every tick.
import styles from "../schedule.module.css";

export default function Clock({ now, timeZone, mounted }: { now: number; timeZone: string; mounted: boolean }) {
  let label = "--:--";
  if (mounted) {
    try {
      label = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(now * 1000));
    } catch {
      label = "--:--";
    }
  }

  return (
    <span className={styles.clock} aria-hidden="true" data-testid="schedule-clock">
      Now {label}
    </span>
  );
}
