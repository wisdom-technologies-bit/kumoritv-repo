"use client";
import styles from "../page.module.css";
import type { FeedFilter } from "@/app/lib/community/queries";

export const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "post", label: "Posts" },
  { value: "announcement", label: "Announcements" },
];

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
          className={styles.chip}
          data-active={value === filter.value}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
