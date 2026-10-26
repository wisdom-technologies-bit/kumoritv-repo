"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./component.module.css";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import anilist from "@/app/api/anilist/anilistMedias";
import SearchResultItemCard from "./components/SearchResultItemCard";
import LoadingIcon from "@/public/assets/ripple-1s-200px.svg";
import SearchIcon from "@/public/assets/search.svg";
import CloseSvg from "@/public/assets/x.svg";
import { AnimatePresence, motion } from "framer-motion";
import { getFirebaseAuth } from "@/app/firebaseApp";
import { MediaOnJSONFile } from "@/app/ts/interfaces/jsonMediaData";
import { useAppSelector } from "@/app/lib/redux/hooks";

const framerMotionshowUpMotion = {
  hidden: {
    y: "-40px",
    opacity: 0,
  },
  visible: {
    y: "0",
    opacity: 1,
    transition: {
      duration: 0.2,
    },
  },
  exit: {
    opacity: 0,
    y: "0",
  },
};

function SearchFormContainer() {
  const [isMobileSearchBarOpen, setIsMobileSearchBarOpen] =
    useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [searchType, setSearchType] = useState<
    "aniwatch" | "consumet" | "json-database" | "anilist"
  >("json-database");

  const [searchResultsList, setSearchResultsList] = useState<
    MediaData[] | MediaOnJSONFile[] | null
  >();

  const [searchInputValue, setSearchInputValue] = useState<string>("");
  const searchAbortController = useRef<AbortController | null>(null);

  const auth = getFirebaseAuth();
  const { user } = useUser();

  const anilistUser = useAppSelector((state) => state.UserInfo.value);

  async function handleSearchFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setSearchType("anilist");

    setSearchResultsList(null);

    if (searchInputValue.trim().length < 3) {
      setSearchResultsList([]);
      return;
    }

    searchAbortController.current?.abort();
    const controller = new AbortController();
    searchAbortController.current = controller;
    setIsLoading(true);

    const searchResults = await anilist.getSeachResults({
      query: searchInputValue,
      showAdultContent: undefined,
      signal: controller.signal,
    });

    setSearchResultsList(searchResults);

    setIsLoading(false);
  }

  useEffect(() => {
    if (searchInputValue.trim().length < 3) return;
    const timer = window.setTimeout(() => {
      void handleSearchFormSubmit(new Event("submit") as unknown as FormEvent<HTMLFormElement>);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInputValue]);

  function toggleMobileSearchBarVisibility(value: boolean) {
    setIsMobileSearchBarOpen(value);

    if (!value) setSearchResultsList(null);
  }

  return (
    <React.Fragment>
      <div id={styles.search_container}>
        <button
          id={styles.btn_open_search_form_mobile}
          onClick={() =>
            toggleMobileSearchBarVisibility(!isMobileSearchBarOpen)
          }
          aria-controls={styles.input_search_bar}
          data-active={isMobileSearchBarOpen}
          aria-label={
            isMobileSearchBarOpen
              ? "Click to Hide Search Bar"
              : "Click to Show Search Bar"
          }
          className={styles.heading_btn}
        >
          <SearchIcon alt="Search Icon" width={16} height={16} />
        </button>

        {/* TABLET AND DESKTOP */}
        <div id={styles.form_search}>
          <form
            onSubmit={(e) => handleSearchFormSubmit(e)}
            className={`${styles.search_form} display_flex_row`}
          >
            <input
              type="text"
              placeholder="Search..."
              name="searchField"
              onChange={(e) => setSearchInputValue(e.target.value)}
              // onChange={(e) => fetchSearchResultsOnInputChange(e.target.value)}
            />
            <button
              type="submit"
              disabled={isLoading}
              aria-label="Begin Search"
            >
              {isLoading ? (
                <LoadingIcon alt="Loading Icon" width={16} height={16} />
              ) : (
                <SearchIcon alt="Search Icon" width={16} height={16} />
              )}
            </button>
          </form>
        </div>

        {/* MOBILE */}
        <AnimatePresence initial={false} mode="wait">
          {isMobileSearchBarOpen && (
            <motion.div
              id={styles.form_mobile_search}
              aria-expanded={isMobileSearchBarOpen}
              className="display_align_justify_center"
              variants={framerMotionshowUpMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <form
                onSubmit={(e) => handleSearchFormSubmit(e)}
                className={`${styles.search_form} display_flex_row`}
              >
                <input
                  type="text"
                  placeholder="Search..."
                  name="searchField"
                  disabled={isLoading}
                  onChange={(e) => setSearchInputValue(e.target.value)}
                ></input>
                <button
                  type="submit"
                  disabled={isLoading}
                  aria-label="Begin Search"
                >
                  {isLoading ? (
                    <LoadingIcon alt="Loading Icon" width={16} height={16} />
                  ) : (
                    <SearchIcon alt="Search Icon" width={16} height={16} />
                  )}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* SEARCH RESULTS */}
      <AnimatePresence initial={false} mode="wait">
        {searchResultsList != null && searchResultsList.length != 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            id={styles.search_results_container}
          >
            <button
              onClick={() => setSearchResultsList(null)}
              title="Close Search Results"
            >
              <CloseSvg alt="Close Icon" width={16} height={16} />
            </button>

            <ul>
              {searchResultsList != null && searchResultsList.length == 0 && (
                <li>
                  <p>No results for this search</p>
                </li>
              )}

              {searchResultsList.map(
                (item: MediaData | MediaOnJSONFile, key: number) => (
                  <SearchResultItemCard
                    key={key}
                    mediaFromAnilist={
                      searchType == "anilist" ? (item as MediaData) : undefined
                    }
                    mediaFromOfflineDB={
                      searchType == "json-database"
                        ? (item as MediaOnJSONFile)
                        : undefined
                    }
                    handleChoseResult={() =>
                      toggleMobileSearchBarVisibility(false)
                    }
                  />
                )
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </React.Fragment>
  );
}

export default SearchFormContainer;
