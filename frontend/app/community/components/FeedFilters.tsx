"use client";
import styles from "../page.module.css";
import type { FeedFilter } from "@/app/lib/community/queries";
import { FEED_FILTERS } from "@/app/lib/community/filters";

/** Kept as a re-export so nothing that imported the list has to move. */
export const FILTERS = FEED_FILTERS;

type FeedFiltersProps = {
  value: FeedFilter;
  onChange: (value: FeedFilter) => void;
  /** "nav" is the left column, "chips" is the pill row (tablet + mobile bar). */
  variant: "nav" | "chips";
  ariaLabel: string;
};

/** One control, three placements. The state lives in FeedShell, so the three
 *  copies can never disagree. */
export default function FeedFilters({ value, onChange, variant, ariaLabel }: FeedFiltersProps) {
  if (variant === "nav") {
    return (
      <nav className={styles.panel} aria-label={ariaLabel}>
        <p className={styles.panel_heading}>Feed</p>
        <ul className={styles.nav_list}>
          {FILTERS.map((filter) => (
            <li key={filter.value}>
              <button
                type="button"
                className={styles.nav_item}
                data-active={value === filter.value}
                aria-current={value === filter.value ? "page" : undefined}
                onClick={() => onChange(filter.value)}
              >
                {filter.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <div className={styles.chip_row} role="tablist" aria-label={ariaLabel}>
      {FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          role="tab"
          aria-selected={value === filter.value}
          aria-label={filter.label}
          className={styles.chip}
          data-active={value === filter.value}
          onClick={() => onChange(filter.value)}
        >
          <span className={styles.chip_label}>{filter.label}</span>
          <span className={styles.chip_label_short} aria-hidden="true">
            {filter.short}
          </span>
        </button>
      ))}
    </div>
  );
}
