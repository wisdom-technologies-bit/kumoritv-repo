"use client";
// One chip, three meanings: the airing state, "On KumoriTV", or "Coming".
import styles from "../schedule.module.css";
import { statusOf, type AiringStatus } from "@/app/lib/schedule/local";

export function StatusChip({
  airingAt,
  now,
  available,
}: {
  airingAt: number;
  now: number;
  available?: boolean;
}) {
  const status: AiringStatus = statusOf(airingAt, now);

  if (available) {
    return (
      <span className={styles.status} data-state="available">
        On KumoriTV
      </span>
    );
  }

  return (
    <span className={styles.status} data-state={status.state} data-testid={`status-${status.state}`}>
      {status.label}
    </span>
  );
}

export default StatusChip;
