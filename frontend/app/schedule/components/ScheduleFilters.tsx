"use client";
// Instant filters: scope, format chips, a title search, and list/poster view.
// Everything here is local state; the week itself lives in the URL.
import styles from "../schedule.module.css";
import { FILTER_FORMATS, formatChip } from "@/app/lib/schedule/format";
import type { ScheduleFilters as Filters } from "@/app/lib/schedule/format";

const SCOPES: Array<{ value: Filters["scope"]; label: string }> = [
  { value: "all", label: "All" },
  { value: "kumori", label: "On KumoriTV" },
  { value: "mylist", label: "My list" },
];

export default function ScheduleFiltersBar({
  filters,
  onChange,
  view,
  onViewChange,
  isToday,
  signedIn,
}: {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  view: "list" | "grid";
  onViewChange: (view: "list" | "grid") => void;
  isToday: boolean;
  signedIn: boolean;
}) {
  const toggleFormat = (format: string) => {
    const next = filters.formats.includes(format)
      ? filters.formats.filter((value) => value !== format)
      : [...filters.formats, format];
    onChange({ formats: next });
  };

  return (
    <div className={styles.filters} data-testid="schedule-filters">
      <div className={styles.chip_row} role="group" aria-label="Filter by availability">
        {SCOPES.map((scope) => (
          <button
            key={scope.value}
            type="button"
            className={styles.chip}
            data-active={filters.scope === scope.value}
            aria-pressed={filters.scope === scope.value}
            onClick={() => onChange({ scope: scope.value })}
            disabled={scope.value === "mylist" && !signedIn}
            title={scope.value === "mylist" && !signedIn ? "Sign in to filter by your list" : undefined}
          >
            {scope.label}
          </button>
        ))}
      </div>

      <div className={styles.chip_row} role="group" aria-label="Filter by format">
        {FILTER_FORMATS.map((format) => (
          <button
            key={format}
            type="button"
            className={styles.chip}
            data-active={filters.formats.includes(format)}
            aria-pressed={filters.formats.includes(format)}
            onClick={() => toggleFormat(format)}
          >
            {formatChip(format)}
          </button>
        ))}
      </div>

      <input
        type="search"
        className={styles.search}
        placeholder="Search titles this week"
        aria-label="Search titles this week"
        value={filters.query}
        onChange={(event) => onChange({ query: event.target.value })}
        data-testid="schedule-search"
      />

      {isToday ? (
        <button
          type="button"
          className={styles.chip}
          data-active={filters.hideAired}
          aria-pressed={filters.hideAired}
          onClick={() => onChange({ hideAired: !filters.hideAired })}
        >
          Hide aired
        </button>
      ) : null}

      <div className={styles.view_toggle} role="group" aria-label="Layout">
        <button
          type="button"
          className={styles.view_btn}
          data-active={view === "list"}
          aria-pressed={view === "list"}
          onClick={() => onViewChange("list")}
        >
          List
        </button>
        <button
          type="button"
          className={styles.view_btn}
          data-active={view === "grid"}
          aria-pressed={view === "grid"}
          onClick={() => onViewChange("grid")}
          data-testid="view-grid"
        >
          Posters
        </button>
      </div>
    </div>
  );
}
