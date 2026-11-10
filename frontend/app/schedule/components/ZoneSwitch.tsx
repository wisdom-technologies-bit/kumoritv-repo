"use client";
// Times are shown in the viewer's own zone by default; UTC and Japan (JST) are
// one tap away for people who plan with release charts. The choice is
// remembered in localStorage, guarded because it can throw in private mode.
import styles from "../schedule.module.css";
import type { ScheduleZone } from "@/app/lib/schedule/types";

const OPTIONS: Array<{ value: ScheduleZone; label: string }> = [
  { value: "local", label: "Local" },
  { value: "utc", label: "UTC" },
  { value: "jst", label: "Japan" },
];

export default function ZoneSwitch({
  value,
  onChange,
}: {
  value: ScheduleZone;
  onChange: (zone: ScheduleZone) => void;
}) {
  return (
    <div className={styles.zone_switch} role="group" aria-label="Time zone for the schedule">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.zone_btn}
          data-active={value === option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
