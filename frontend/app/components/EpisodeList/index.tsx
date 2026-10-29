"use client";

// ani.pm-style episode list, shared by the media page and the watch page.
// All logic (search / sort / filter / chunking) runs over the FULL list, so a
// 1000+ episode anime stays fast without ever hiding episodes from search.

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./component.module.css";
import {
  EPISODE_CHUNK_SIZE,
  chunkEpisodes,
  displayEpisodeTitle,
  episodeCounts,
  filterEpisodes,
  formatEpisodeDuration,
  type EpisodeItem,
  type EpisodeOrder,
  type EpisodeView,
} from "@/app/lib/episodes/items";
import { getProgress, subscribe } from "@/app/lib/user-data/progress";

const ORDER_KEY = "kumori_episode_order_v1";
const VIEW_KEY = "kumori_episode_view_v1";
const HIDE_WATCHED_KEY = "kumori_episode_hide_watched_v1";

export default function EpisodeList({
  episodes,
  anilistId,
  audio,
  activeEpisode = null,
  watched = [],
  format,
  title = "Episodes",
}: {
  episodes: EpisodeItem[];
  anilistId: number;
  audio: "sub" | "dub";
  activeEpisode?: number | null;
  watched?: number[];
  format?: string | null;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<EpisodeOrder>("desc");
  const [view, setView] = useState<EpisodeView>("list");
  const [hideWatched, setHideWatched] = useState(false);
  const [subOnly, setSubOnly] = useState(false);
  const [dubOnly, setDubOnly] = useState(false);
  const [pages, setPages] = useState(0);
  const [localWatched, setLocalWatched] = useState<number[]>([]);
  const activeRef = useRef<HTMLLIElement | null>(null);

  // The media page does not pass progress: read the same watch progress here.
  useEffect(() => {
    if (watched) return;
    const sync = () => setLocalWatched(getProgress(anilistId)?.watched || []);
    sync();
    return subscribe(sync);
  }, [anilistId, watched]);

  const watchedList = watched || localWatched;

  useEffect(() => {
    try {
      const savedOrder = window.localStorage.getItem(ORDER_KEY);
      if (savedOrder === "asc" || savedOrder === "desc") setOrder(savedOrder);
      const savedView = window.localStorage.getItem(VIEW_KEY);
      if (savedView === "list" || savedView === "grid") setView(savedView);
      const savedHide = window.localStorage.getItem(HIDE_WATCHED_KEY);
      if (savedHide === "true") setHideWatched(true);
    } catch {}
  }, []);

  const counts = useMemo(() => episodeCounts(episodes), [episodes]);
  const watchedSet = useMemo(() => new Set(watchedList || []), [watchedList]);
  const filtered = useMemo(
    () =>
      filterEpisodes(
        episodes,
        { query, order, subOnly, dubOnly, hideWatched },
        watchedList,
      ),
    [episodes, query, order, subOnly, dubOnly, hideWatched, watchedList],
  );
  const chunks = useMemo(
    () => chunkEpisodes(filtered, EPISODE_CHUNK_SIZE),
    [filtered],
  );
  const shownChunks = chunks.slice(0, pages + 1);
  const shown = shownChunks.flat();
  const hasMore = filtered.length > shown.length;
  const movie = format === "MOVIE";

  // Watch page: land on the episode being watched.
  useEffect(() => {
    if (!activeEpisode) return;
    const node = activeRef.current;
    if (!node) return;
    if (typeof node.scrollIntoView === "function")
      node.scrollIntoView({ block: "center" });
  }, [activeEpisode, shown.length]);

  const toggleView = () => {
    const next: EpisodeView = view === "grid" ? "list" : "grid";
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const toggleOrder = () => {
    const next: EpisodeOrder = order === "desc" ? "asc" : "desc";
    setOrder(next);
    try {
      window.localStorage.setItem(ORDER_KEY, next);
    } catch {}
  };

  const toggleHideWatched = () => {
    const next = !hideWatched;
    setHideWatched(next);
    try {
      window.localStorage.setItem(HIDE_WATCHED_KEY, String(next));
    } catch {}
  };

  return (
    <section className={styles.wrapper} data-view={view}>
      <header className={styles.header}>
        <h3>
          {title} ({counts.total})
        </h3>
        <div className={styles.toolbar}>
          <input
            className={styles.search}
            type="search"
            inputMode="search"
            placeholder="Search episode or title"
            aria-label="Search episodes"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPages(0);
            }}
          />
          <button
            className={styles.toggle}
            type="button"
            onClick={toggleOrder}
            aria-label="Sort episodes"
          >
            {order === "desc" ? "Newest" : "Oldest"}
          </button>
          <button
            className={styles.toggle}
            type="button"
            onClick={toggleView}
            aria-label="Toggle layout"
            aria-pressed={view === "grid"}
          >
            {view === "grid" ? "Grid" : "List"}
          </button>
          <button
            className={styles.toggle}
            type="button"
            onClick={toggleHideWatched}
            aria-pressed={hideWatched}
          >
            Watched
          </button>
        </div>
        <div className={styles.chips}>
          <button
            type="button"
            className={subOnly ? styles.chip_active : styles.chip}
            aria-pressed={subOnly}
            onClick={() => {
              setSubOnly(!subOnly);
              setPages(0);
            }}
          >
            Sub only ({counts.sub})
          </button>
          <button
            type="button"
            className={dubOnly ? styles.chip_active : styles.chip}
            aria-pressed={dubOnly}
            onClick={() => {
              setDubOnly(!dubOnly);
              setPages(0);
            }}
          >
            Dub only ({counts.dub})
          </button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className={styles.empty}>No episodes match this filter.</p>
      ) : (
        <>
          {shownChunks.map((chunk, chunkIndex) => (
            <ul className={styles.list} key={chunkIndex}>
              {chunk.map((episode) => {
                const isActive = activeEpisode === episode.number;
                const isWatched = watchedSet.has(episode.number);
                return (
                  <li
                    key={episode.number}
                    ref={isActive ? activeRef : undefined}
                    className={[
                      styles.item,
                      isActive ? styles.item_active : "",
                      isWatched ? styles.item_watched : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-active={isActive || undefined}
                  >
                    <Link
                      className={styles.link}
                      href={`/watch/${anilistId}?ep=${episode.number}&audio=${audio}`}
                    >
                      <span className={styles.thumb}>
                        {episode.image ? (
                          <Image
                            src={episode.image}
                            alt=""
                            width={160}
                            height={90}
                            unoptimized
                          />
                        ) : (
                          <span className={styles.thumb_empty} aria-hidden />
                        )}
                        {isWatched ? (
                          <span
                            className={styles.watched_check}
                            aria-label="Watched"
                            title="Watched"
                          >
                            ✓
                          </span>
                        ) : null}
                      </span>

                      <span className={styles.info}>
                        <span className={styles.line}>
                          <b className={styles.badge}>
                            {movie ? "Movie" : `Episode ${episode.number}`}
                          </b>
                          {episode.hasDub ? (
                            <span className={styles.dub_badge}>DUB</span>
                          ) : null}
                          {episode.filler ? (
                            <span className={styles.tag}>Filler</span>
                          ) : null}
                          {episode.recap ? (
                            <span className={styles.tag}>Recap</span>
                          ) : null}
                          {isActive ? (
                            <span className={styles.playing}>Now playing</span>
                          ) : null}
                        </span>

                        <span className={styles.ep_title}>
                          {displayEpisodeTitle(episode)}
                        </span>

                        {episode.description ? (
                          <span className={styles.synopsis}>
                            {episode.description}
                          </span>
                        ) : null}

                        <span className={styles.meta}>
                          {formatEpisodeDuration(episode.duration) ? (
                            <span>
                              {formatEpisodeDuration(episode.duration)}
                            </span>
                          ) : null}
                          {episode.airDate ? <span>{episode.airDate}</span> : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}

          {hasMore ? (
            <button
              className={styles.more}
              type="button"
              onClick={() => setPages(pages + 1)}
            >
              Show more ({filtered.length - shown.length} left)
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
