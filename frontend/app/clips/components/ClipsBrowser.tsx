"use client";

// Phase 5: the public clip browse, as a client shell over a server-rendered
// first page.
//
// The page renders page 1 on the server (SEO, no blank flash), and this shell
// takes over from there: filter changes, "Load more", error/retry, and the URL
// sync that makes the back button and shared links work.
//
// Filters live in the URL (?sort=&q=&anime=), not only in state, so a filter is
// shareable and pressing Back restores it. A filter change REPLACES the history
// entry (typing in a search should not add twenty entries), while a "Load more"
// keeps the page it was on.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";
import ClipCard from "./ClipCard";
import { filterQueryString as buildFilterQuery, type BrowseItem, type ClipsSort } from "@/app/lib/clips/browse";

const SORTS: Array<{ value: ClipsSort; label: string }> = [
  { value: "latest", label: "Latest" },
  { value: "views", label: "Most viewed" },
  { value: "week", label: "This week" },
];

type QueryState = { sort: ClipsSort; q: string; anime: number | null };

const FILTER_KEYS = ["sort", "q", "anime"] as const;

type Props = {
  initialItems: BrowseItem[];
  initialNextCursor: string | null;
  initialQuery: QueryState;
  initialCount: number;
  showAdult: boolean;
  /** A stale link whose cursor no longer resolves still renders the first page. */
  initialError?: boolean;
};

export default function ClipsBrowser({
  initialItems,
  initialNextCursor,
  initialQuery,
  initialCount,
  showAdult,
  initialError = false,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState<QueryState>(initialQuery);
  const [search, setSearch] = useState(initialQuery.q);
  const [items, setItems] = useState<BrowseItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "error">(
    initialError ? "error" : "idle",
  );
  const [announcement, setAnnouncement] = useState(
    `${initialCount} ${initialCount === 1 ? "clip" : "clips"}`,
  );
  const requestId = useRef(0);

  /** One place that talks to the API, so every state is handled once. */
  const load = useCallback(
    async (next: QueryState, cursor: string | null, mode: "replace" | "append") => {
      const ticket = ++requestId.current;
      setStatus(mode === "append" ? "more" : "loading");
      try {
        const params = new URLSearchParams();
        if (next.sort !== "latest") params.set("sort", next.sort);
        if (next.q) params.set("q", next.q);
        if (next.anime != null) params.set("anime", String(next.anime));
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/clips?${params.toString()}`, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { items: BrowseItem[]; nextCursor: string | null };
        if (ticket !== requestId.current) return; // a newer filter won the race
        setItems((current) => (mode === "append" ? [...current, ...body.items] : body.items));
        setNextCursor(body.nextCursor);
        setStatus("idle");
        setAnnouncement(
          mode === "append"
            ? `${body.items.length} more clips loaded`
            : `${body.items.length} ${body.items.length === 1 ? "clip" : "clips"}`,
        );
      } catch {
        if (ticket !== requestId.current) return;
        setStatus("error");
      }
    },
    [],
  );

  const applyQuery = useCallback(
    (next: QueryState) => {
      setQuery(next);
      router.replace(`/clips${buildFilterQuery(next)}`, { scroll: false });
      void load(next, null, "replace");
    },
    [load, router],
  );

  // 300 ms after the last keystroke, not on every character.
  useEffect(() => {
    const trimmed = search.replace(/\s+/g, " ").trim();
    const normalized = trimmed.length >= 2 ? trimmed : "";
    if (normalized === query.q) return;
    const timer = window.setTimeout(() => {
      applyQuery({ ...query, q: normalized });
    }, 300);
    return () => window.clearTimeout(timer);
    // `query` is intentionally read at schedule time; re-running on every
    // keystroke would restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const from = buildFilterQuery(query);

  const retry = () => void load(query, null, "replace");
  const loadMore = () => {
    if (nextCursor) void load(query, nextCursor, "append");
  };

  return (
    <div className={styles.browser}>
      <div className={styles.filter_bar} data-testid="clips-filter-bar">
        <div className={styles.segmented} role="tablist" aria-label="Sort clips">
          {SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={query.sort === option.value}
              data-active={query.sort === option.value}
              className={styles.segment}
              onClick={() => applyQuery({ ...query, sort: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <form
          role="search"
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault();
            applyQuery({ ...query, q: search.replace(/\s+/g, " ").trim() });
          }}
        >
          <label htmlFor="clips-search" className={styles.search_label}>
            Anime title
          </label>
          <input
            id="clips-search"
            type="search"
            inputMode="search"
            placeholder="Search anime"
            className={styles.search_input}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              className={styles.search_clear}
              aria-label="Clear the search"
              onClick={() => {
                setSearch("");
                applyQuery({ ...query, q: "" });
              }}
            >
              ×
            </button>
          ) : null}
        </form>
      </div>

      <p className={styles.results} role="status" aria-live="polite">
        {announcement}
        {query.anime != null ? ` · anime ${query.anime}` : ""}
      </p>

      {status === "loading" ? <SkeletonGrid /> : null}

      {status === "error" ? (
        <div className={styles.state} role="alert" data-testid="clips-error">
          <p className={styles.state_title}>The clip list did not load.</p>
          <p className={styles.state_text}>Your filters are still here.</p>
          <button type="button" className={styles.primary} onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}

      {status !== "loading" && status !== "error" && items.length === 0 ? (
        <div className={styles.state} data-testid="clips-empty">
          <p className={styles.state_title}>
            {query.q ? `No clips match "${query.q}"` : "No clips yet"}
          </p>
          <p className={styles.state_text}>
            Make one while watching: open any episode, pick a moment, and it appears here.
          </p>
          <a className={styles.primary} href="/search">
            Find something to watch
          </a>
        </div>
      ) : null}

      {items.length > 0 && status !== "loading" ? (
        <ul className={styles.grid} data-testid="clips-grid">
          {items.map((item, index) => (
            <li key={item.code} className={styles.grid_item}>
              <ClipCard item={item} showAdult={showAdult} priority={index === 0} from={from} />
            </li>
          ))}
        </ul>
      ) : null}

      {status === "idle" && items.length > 0 ? (
        nextCursor ? (
          <div className={styles.more_row}>
            <button type="button" className={styles.primary} onClick={loadMore}>
              Load more
            </button>
          </div>
        ) : (
          <p className={styles.end_marker} data-testid="clips-end">
            That is every clip.
          </p>
        )
      ) : null}

      {status === "more" ? (
        <div className={styles.more_row}>
          <button type="button" className={styles.primary} disabled>
            Loading…
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Six cards with the real geometry, so nothing jumps when the data lands. */
export function SkeletonGrid() {
  return (
    <ul className={styles.grid} aria-hidden="true" data-testid="clips-skeleton">
      {Array.from({ length: 6 }).map((_, index) => (
        <li key={index} className={styles.grid_item}>
          <div className={`${styles.card} ${styles.skeleton_card}`}>
            <div className={`${styles.thumb} ${styles.skeleton}`} />
            <div className={styles.card_body}>
              <span className={`${styles.skeleton_line} ${styles.skeleton_title}`} />
              <span className={`${styles.skeleton_line} ${styles.skeleton_sub}`} />
              <span className={`${styles.skeleton_line} ${styles.skeleton_meta}`} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Only exported for tests: the URL contract of a filter change. */
export const __filterKeys = FILTER_KEYS;
