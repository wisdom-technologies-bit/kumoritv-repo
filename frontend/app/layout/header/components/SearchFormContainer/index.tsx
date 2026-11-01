"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./component.module.css";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import anilist from "@/app/api/anilist/anilistMedias";
import SearchResultItemCard from "./components/SearchResultItemCard";
import LoadingIcon from "@/public/assets/ripple-1s-200px.svg";
import SearchIcon from "@/public/assets/search.svg";
import CloseSvg from "@/public/assets/x.svg";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";

export const SEARCH_MIN_LENGTH = 3;
export const SEARCH_DEBOUNCE_MS = 400;

const framerMotionshowUpMotion = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15 } },
  exit: { opacity: 0, y: -8 },
};

const SKELETON_ROWS = [0, 1, 2];

function SearchFormContainer() {
  const [isMobileInputOpen, setIsMobileInputOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);
  const [results, setResults] = useState<MediaData[]>([]);
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const abortController = useRef<AbortController | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length >= SEARCH_MIN_LENGTH;
  const seeAllHref = `/search?title=${encodeURIComponent(trimmedQuery)}`;

  const closePanel = useCallback((options: { restoreFocus?: boolean } = {}) => {
    setIsPanelOpen(false);
    setActiveIndex(-1);

    if (options.restoreFocus) inputRef.current?.focus();
  }, []);

  // Debounced search: the request is aborted as soon as the text changes.
  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      setIsLoading(false);
      setIsPanelOpen(false);

      return;
    }

    const timer = window.setTimeout(async () => {
      abortController.current?.abort();

      const controller = new AbortController();

      abortController.current = controller;
      setIsLoading(true);
      setIsPanelOpen(true);

      const found = await anilist.getSeachResults({
        query: trimmedQuery,
        showAdultContent: undefined,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setResults(found);
      setActiveIndex(-1);
      setIsLoading(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [trimmedQuery, hasQuery]);

  // A new query starts at the top of the list, never mid-scroll.
  useEffect(() => {
    const panel = panelRef.current;

    if (panel) panel.scrollTop = 0;
  }, [trimmedQuery]);

  // Close on route change (a result was followed) and on Escape / outside click.
  useEffect(() => {
    setIsPanelOpen(false);
    setIsMobileInputOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isPanelOpen) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;

      if (target && containerRef.current?.contains(target)) return;
      if (target && panelRef.current?.contains(target)) return;

      closePanel();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isPanelOpen, closePanel]);

  function focusResult(index: number) {
    const rows = panelRef.current?.querySelectorAll<HTMLAnchorElement>("[data-search-row]");

    if (!rows || rows.length === 0) return;

    const next = Math.min(Math.max(index, 0), rows.length - 1);

    setActiveIndex(next);
    rows[next]?.focus();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      inputRef.current?.blur();

      return;
    }

    if (event.key === "ArrowDown" && isPanelOpen && results.length > 0) {
      event.preventDefault();
      focusResult(activeIndex + 1);

      return;
    }

    if (event.key === "ArrowUp" && isPanelOpen && results.length > 0) {
      event.preventDefault();

      if (activeIndex <= 0) {
        setActiveIndex(-1);
        inputRef.current?.focus();

        return;
      }

      focusResult(activeIndex - 1);
    }
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasQuery) return;

    setIsPanelOpen(false);
    router.push(seeAllHref);
  }

  function clearSearch() {
    abortController.current?.abort();
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setIsPanelOpen(false);
    inputRef.current?.focus();
  }

  function toggleMobileInput(open: boolean) {
    setIsMobileInputOpen(open);

    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
    else clearSearch();
  }

  const showEmptyState = isPanelOpen && !isLoading && hasQuery && results.length === 0;

  return (
    <React.Fragment>
      <div id={styles.search_container} ref={containerRef}>
        <button
          id={styles.btn_open_search_form_mobile}
          type="button"
          ref={toggleRef}
          onClick={() => toggleMobileInput(!isMobileInputOpen)}
          aria-label={isMobileInputOpen ? "Close search" : "Open search"}
          aria-expanded={isMobileInputOpen}
          aria-controls={styles.input_search_bar}
          data-active={isMobileInputOpen}
          className="header-icon-btn"
        >
          {isMobileInputOpen ? (
            <CloseSvg alt="" width={22} height={22} viewBox="0 0 16 16" />
          ) : (
            <SearchIcon alt="" width={22} height={22} viewBox="0 0 16 16" />
          )}
        </button>

        {/* TABLET AND DESKTOP: the pill is always visible. */}
        <div id={styles.form_search}>
          <form
            onSubmit={handleFormSubmit}
            className={styles.search_form}
            role="search"
          >
            <div className={styles.input_pill} data-open={isPanelOpen}>
              <SearchIcon className={styles.input_icon} aria-hidden="true" width={18} height={18} />

              <input
                id={styles.input_search_bar}
                type="search"
                name="searchField"
                placeholder="Search anime or manga"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                autoComplete="off"
                aria-label="Search anime or manga"
              />

              {query.length > 0 && (
                <button
                  type="button"
                  className={styles.clear_btn}
                  onClick={clearSearch}
                  aria-label="Clear search"
                  data-search-clear="true"
                >
                  <CloseSvg alt="" width={14} height={14} />
                </button>
              )}
            </div>
          </form>
        </div>

        {/* MOBILE: the pill drops under the header when the icon is tapped. */}
        <AnimatePresence initial={false}>
          {isMobileInputOpen && (
            <motion.div
              id={styles.form_mobile_search}
              aria-expanded={isMobileInputOpen}
              variants={framerMotionshowUpMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <form onSubmit={handleFormSubmit} className={styles.search_form} role="search">
                <div className={styles.input_pill} data-open={isPanelOpen}>
                  <SearchIcon className={styles.input_icon} aria-hidden="true" width={18} height={18} />

                  <input
                    type="search"
                    name="searchField"
                    placeholder="Search anime or manga"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    autoComplete="off"
                    aria-label="Search anime or manga"
                  />

                  {query.length > 0 && (
                    <button
                      type="button"
                      className={styles.clear_btn}
                      onClick={clearSearch}
                      aria-label="Clear search"
                    >
                      <CloseSvg alt="" width={14} height={14} />
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* RESULTS PANEL */}
        <AnimatePresence initial={false}>
          {isPanelOpen && (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              id={styles.search_results_container}
              data-search-panel="true"
              data-mobile-input-open={isMobileInputOpen ? "true" : "false"}
              role="dialog"
              aria-label="Search results"
            >
              <div className={styles.panel_heading}>
                <p className={styles.panel_title}>
                  {isLoading ? "Searching…" : `Results for “${trimmedQuery}”`}
                </p>

                <button
                  type="button"
                  className={styles.panel_close_btn}
                  onClick={() => closePanel({ restoreFocus: true })}
                  aria-label="Close search results"
                  data-search-close="true"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>

              {isLoading && (
                <ul className={styles.results_list} aria-hidden="true">
                  {SKELETON_ROWS.map((row) => (
                    <li key={row} className={styles.skeleton_row} data-search-skeleton="true">
                      <span className={styles.skeleton_cover} />
                      <span className={styles.skeleton_text}>
                        <span />
                        <span />
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {showEmptyState && (
                <div className={styles.empty_state} data-search-empty="true">
                  <p className={styles.empty_title}>{`No results for “${trimmedQuery}”`}</p>
                  <p className={styles.empty_text}>Try a shorter title, or browse the full catalogue.</p>
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <ul className={styles.results_list} aria-label="Search results">
                  {results.map((item, index) => (
                    <SearchResultItemCard
                      key={`${item.id}-${index}`}
                      mediaFromAnilist={item}
                      isActive={activeIndex === index}
                      onActivate={() => setActiveIndex(index)}
                      onFocusResult={() => setActiveIndex(index)}
                      onArrowDown={() => focusResult(index + 1)}
                      onArrowUp={() => (index === 0 ? inputRef.current?.focus() : focusResult(index - 1))}
                      handleChoseResult={() => {
                        setIsPanelOpen(false);
                        setIsMobileInputOpen(false);
                      }}
                    />
                  ))}
                </ul>
              )}

              {!isLoading && hasQuery && (
                /* Sticky footer: the link stays reachable and never covers the
                   last row (it sits below the list in the flow). */
                <div className={styles.results_footer} data-search-footer="true">
                  <a
                    className={styles.see_all_link}
                    href={seeAllHref}
                    data-search-see-all="true"
                  >
                    <span className={styles.see_all_label}>
                      See all results for “{trimmedQuery}”
                    </span>
                  </a>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading && !isPanelOpen && <LoadingIcon alt="Loading" width={16} height={16} />}
      </div>
    </React.Fragment>
  );
}

export default SearchFormContainer;
