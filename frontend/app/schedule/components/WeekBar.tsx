"use client";
// The sticky week bar: seven day pills in the VIEWER's local days, a count per
// day, a dot for today, arrow keys, swipe, and prev/next-week + Today buttons.
import { useRef } from "react";
import styles from "../schedule.module.css";
import { dayMonthLabel, weekdayShort } from "@/app/lib/schedule/local";

export default function WeekBar({
  days,
  counts,
  selectedDay,
  today,
  hasPrev,
  hasNext,
  onSelect,
  onPrevWeek,
  onNextWeek,
  onToday,
}: {
  days: string[];
  counts: Record<string, number>;
  selectedDay: string;
  today: string;
  hasPrev: boolean;
  hasNext: boolean;
  onSelect: (day: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = days.indexOf(selectedDay);
    if (index < 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (index < days.length - 1) onSelect(days[index + 1]);
      else if (hasNext) onNextWeek();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (index > 0) onSelect(days[index - 1]);
      else if (hasPrev) onPrevWeek();
    } else if (event.key === "Home") {
      event.preventDefault();
      onSelect(days[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      onSelect(days[days.length - 1]);
    }
  }

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    const index = days.indexOf(selectedDay);
    if (dx < 0 && index >= 0 && index < days.length - 1) onSelect(days[index + 1]);
    if (dx > 0 && index > 0) onSelect(days[index - 1]);
  }

  return (
    <div className={styles.week_bar}>
      <div className={styles.week_nav}>
        <button
          type="button"
          className={styles.icon_btn}
          onClick={onPrevWeek}
          disabled={!hasPrev}
          aria-label="Previous week"
        >
          {"\u2039"}
        </button>
      </div>

      <div
        className={styles.days_scroller}
        role="tablist"
        aria-label="Day of the week"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-testid="week-bar"
      >
        {days.map((day) => {
          const selected = day === selectedDay;
          return (
            <button
              key={day}
              type="button"
              role="tab"
              id={`day-tab-${day}`}
              aria-selected={selected}
              aria-controls={`day-panel-${day}`}
              tabIndex={selected ? 0 : -1}
              className={styles.pill}
              data-selected={selected}
              data-today={day === today}
              onClick={() => onSelect(day)}
            >
              <span className={styles.pill_weekday}>
                {weekdayShort(day)}
                {day === today ? " \u00b7" : ""}
              </span>
              <span className={styles.pill_date}>{dayMonthLabel(day)}</span>
              <span className={styles.pill_count}>
                {counts[day] ? `${counts[day]} ${counts[day] === 1 ? "ep" : "eps"}` : "0 ep"}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.week_nav}>
        <button type="button" className={styles.today_btn} onClick={onToday}>
          Today
        </button>
        <button
          type="button"
          className={styles.icon_btn}
          onClick={onNextWeek}
          disabled={!hasNext}
          aria-label="Next week"
        >
          {"\u203a"}
        </button>
      </div>
    </div>
  );
}
