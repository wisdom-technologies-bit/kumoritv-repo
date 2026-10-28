"use client";
import React, { useState } from "react";
import styles from "./component.module.css";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import SvgFilter from "@/public/assets/funnel.svg";
import SvgClose from "@/public/assets/x.svg";
import * as SearchOptions from "./constants";
import simulateRange from "@/app/lib/simulateRange";
import { parseGenreSlugs, serializeGenreParam } from "@/app/lib/search/genres";

const showUpMotion = {
  hidden: {
    opacity: 0,
    scale: 1.08,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.3,
    },
  },
};

function NavigationSideBar({ isMobile }: { isMobile: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchParamsState, setSearchParamsState] = useState(
    new URLSearchParams(Array.from(searchParams.entries()))
  );

  const [isLoading, setLoading] = useState(false);
  const [isFiltersMenuOpen, setIsFiltersMenuOpen] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fetchNewResultsByQueryType(queryType: string, inputTarget: any) {
    const currSearchParams = new URLSearchParams(
      Array.from(searchParams.entries())
    );

    setLoading(true);

    switch (queryType) {
      case "genre": {
        // Every format on the site ([adventure], [action-comedy], "slice of life"…)
        // is read into canonical slugs, toggled, then written back as brackets.
        const currentSlugs = parseGenreSlugs(currSearchParams.getAll("genre"));
        const nextSlugs = currentSlugs.includes(inputTarget.value)
          ? currentSlugs.filter((slug) => slug !== inputTarget.value)
          : [...currentSlugs, inputTarget.value];

        const nextGenreParam = serializeGenreParam(nextSlugs);

        if (nextGenreParam) {
          currSearchParams.set("genre", nextGenreParam);
        } else {
          currSearchParams.delete("genre");
        }

        break;
      }

      default:
        if (queryType == "year" && inputTarget.value == "any") {
          currSearchParams.delete("year");

          const query = `?${currSearchParams}`;

          setSearchParamsState(currSearchParams);

          router.push(`${pathname}${decodeURI(query)}`);

          setLoading(false);

          return;
        }

        if (currSearchParams.get(queryType)?.includes(inputTarget.value)) {
          currSearchParams.delete(queryType);
        } else {
          currSearchParams.set(queryType, inputTarget.value);
        }

        break;
    }

    const newSearchParams = currSearchParams ? `?${currSearchParams}` : "";

    router.push(`${pathname}${decodeURI(newSearchParams)}`);

    setSearchParamsState(currSearchParams);

    setLoading(false);
  }

  return (
    <React.Fragment>
      {isMobile && (
        <button
          id={styles.btn_filters}
          onClick={() => setIsFiltersMenuOpen(!isFiltersMenuOpen)}
          data-active={isFiltersMenuOpen}
        >
          {isFiltersMenuOpen ? (
            <>
              <SvgClose width={16} height={16} alt="Close" /> FILTERS
            </>
          ) : (
            <>
              <SvgFilter width={16} height={16} alt="Filter" /> FILTERS
            </>
          )}
        </button>
      )}

      <AnimatePresence initial={false} mode="wait">
        {((isMobile && isFiltersMenuOpen == true) ||
          (!isMobile && !isFiltersMenuOpen)) && (
          <motion.div
            id={styles.backdrop}
            onClick={() => setIsFiltersMenuOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* SHOW IF IT IS MOBILE AND MENU IS OPEN, OR IF IS NOT MOBILE (ON DESKTOP) AND MENU IS CLOSED */}
            {((isMobile && isFiltersMenuOpen == true) ||
              (!isMobile && !isFiltersMenuOpen)) && (
              <motion.div
                onClick={(e: { stopPropagation: () => void }) =>
                  e.stopPropagation()
                }
                onScrollCapture={(e: { stopPropagation: () => void }) =>
                  e.stopPropagation()
                }
                id={styles.container}
                variants={showUpMotion}
                initial="hidden"
                animate="visible"
                data-loading={isLoading}
                data-active={isFiltersMenuOpen}
              >
                <form className={styles.nav_container}>
                  <p>GENRES</p>

                  <ul>
                    {SearchOptions.allGenres.map((item, key) => (
                      <li key={key}>
                        <label>
                          {item.name}
                          <input
                            type="checkbox"
                            value={item.value}
                            defaultChecked={parseGenreSlugs(
                              searchParamsState.getAll("genre")
                            ).includes(item.value)}
                            onClick={(e) =>
                              fetchNewResultsByQueryType("genre", e.target)
                            }
                          ></input>
                        </label>
                      </li>
                    ))}
                  </ul>
                </form>

                <form className={styles.nav_container}>
                  <p>YEAR</p>

                  <select
                    defaultValue={
                      searchParamsState.get("year")
                        ? `${searchParamsState.get("year")}`
                        : `any`
                    }
                    onChange={(e) =>
                      fetchNewResultsByQueryType("year", e.target)
                    }
                  >
                    <option value="any">Any</option>
                    {simulateRange(60).map((item, key) => (
                      <option key={key} value={new Date().getFullYear() - item}>
                        {new Date().getFullYear() - item}
                      </option>
                    ))}
                  </select>
                </form>

                <form
                  className={`${styles.nav_container} ${styles.hidden_checkbox}`}
                >
                  <p>TYPE</p>

                  <ul>
                    {SearchOptions.allTypes.map((item, key) => (
                      <li key={key}>
                        <label>
                          {item.name}
                          <input
                            type="checkbox"
                            value={item.value}
                            defaultChecked={searchParamsState
                              .get("type")
                              ?.includes(item.value)}
                            onClick={(e) =>
                              fetchNewResultsByQueryType("type", e.target)
                            }
                          ></input>
                        </label>
                      </li>
                    ))}
                  </ul>
                </form>

                <form
                  className={`${styles.nav_container} ${styles.hidden_checkbox} ${styles.hidden_checkbox2}`}
                >
                  <p>STATUS</p>

                  <ul>
                    {SearchOptions.allStatus.map((item, key) => (
                      <li key={key}>
                        <label>
                          {item.name}
                          <input
                            type="checkbox"
                            value={item.value}
                            defaultChecked={searchParamsState
                              .get("status")
                              ?.includes(item.value)}
                            onClick={(e) =>
                              fetchNewResultsByQueryType("status", e.target)
                            }
                          ></input>
                        </label>
                      </li>
                    ))}
                  </ul>
                </form>

                <form
                  className={`${styles.nav_container} ${styles.hidden_checkbox} ${styles.hidden_checkbox2}`}
                >
                  <p>SEASON</p>

                  <ul>
                    {SearchOptions.allSeasons.map((item, key) => (
                      <li key={key}>
                        <label>
                          {item.name}
                          <input
                            type="checkbox"
                            value={item.value}
                            defaultChecked={searchParamsState
                              .get("season")
                              ?.includes(item.value)}
                            onClick={(e) =>
                              fetchNewResultsByQueryType("season", e.target)
                            }
                          ></input>
                        </label>
                      </li>
                    ))}
                  </ul>
                </form>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </React.Fragment>
  );
}

export default NavigationSideBar;
