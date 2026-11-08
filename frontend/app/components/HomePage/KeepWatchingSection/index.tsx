"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import SwiperCarouselContainer from "../../SwiperCarouselContainer";
import styles from "./component.module.css";
import { AnimatePresence, motion } from "framer-motion";
import KeepWatchingEpisodeInfo from "./components/KeepWatchingEpisodeInfo";
import { SwiperSlide } from "swiper/react";
import { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";
import { listContinueWatchingFromServer } from "@/app/lib/user-data/progress";
import { imageKey } from "@/app/lib/episodes/images";
import { useRefreshOnReturn } from "./useRefreshOnReturn";

// Old entries have no episode thumbnail: resolve them in ONE batched request
// (episodes.image_url -> anime cover -> placeholder) instead of one call a card.
async function fillEpisodeImages(list: KeepWatchingMediaData[]) {
  const missing = list.filter((media) => !media.episodeImg);
  if (!missing.length) return list;
  try {
    const response = await fetch("/api/anime/episode-images", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: missing.map((media) => ({
          anilistId: Number(media.id),
          episode: Number(media.episode),
        })),
      }),
    });
    if (!response.ok) return list;
    const body = (await response.json()) as { images?: Record<string, string | null> };
    const images = body.images || {};
    return list.map((media) => {
      if (media.episodeImg) return media;
      const url = images[imageKey(Number(media.id), Number(media.episode))];
      return url ? { ...media, episodeImg: url } : media;
    });
  } catch {
    return list;
  }
}

const framerMotionVariants = {
  initial: {
    opacity: 0,
    height: 0,
  },
  animate: {
    opacity: 1,
    height: "auto",
    transition: {
      staggerChildren: 0.1,
    },
  },
};

/** Cards in the grid before the toggle: one or two rows, never a full screen. */
export const KEEP_WATCHING_INITIAL_COUNT = 6;
/** The toggle stops here, however long the list is. */
export const KEEP_WATCHING_MAX_COUNT = 12;

/** True from the tablet layout up, where the cluster grid replaces the swiper.
 *  Server render and first paint answer `false` (the phone scroller), then the
 *  effect settles it, so hydration stays clean. */
function useWideLayout() {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsWide(Boolean(query.matches));

    apply();
    query.addEventListener?.("change", apply);

    return () => query.removeEventListener?.("change", apply);
  }, []);

  return isWide;
}

function KeepWatchingSection() {
  const [watchingList, setWatchingList] = useState<KeepWatchingMediaData[]>([]);
  // Episode thumbnails already resolved this page load: a refresh must not ask
  // for them again.
  const knownImages = useRef<Map<string, string>>(new Map());
  const [deletedFromWatchingList, setDeletedFromWatchingList] = useState<
    KeepWatchingMediaData[]
  >([]);

  const isWide = useWideLayout();
  const [visibleCount, setVisibleCount] = useState(KEEP_WATCHING_INITIAL_COUNT);

  useEffect(() => {
    const filterAvailableMedias = deletedFromWatchingList.map((mediaRemoved) =>
      watchingList.filter((media) => media.id != mediaRemoved.id)
    )[0];

    if (deletedFromWatchingList.length != 0) {
      setWatchingList(() => filterAvailableMedias);
      setDeletedFromWatchingList([]);
    }
  }, [deletedFromWatchingList]);

  const getWatchingList = useCallback(async () => {
    // Signed-in: Supabase merged with the local copy. Guest / AniList-only: the
    // local copy alone. Both paths go through the same call, so a guest with
    // local progress sees the section too.
    const continueWatchingList = (await listContinueWatchingFromServer()) || [];

    const withKnownImages = continueWatchingList.map((media) => {
      if (media.episodeImg) return media;
      const known = knownImages.current.get(String(media.id));
      return known ? { ...media, episodeImg: known } : media;
    });

    const withImages = await fillEpisodeImages(withKnownImages);

    for (const media of withImages) {
      if (media.episodeImg) knownImages.current.set(String(media.id), media.episodeImg);
    }

    setWatchingList(withImages);
  }, []);

  // One load on mount, then a debounced reload whenever the page may have
  // missed something (focus, bfcache restore, visibility, a player save).
  useEffect(() => {
    void getWatchingList();
  }, [getWatchingList]);

  useRefreshOnReturn(getWatchingList);

  return (
    <AnimatePresence initial={false}>
      {watchingList.length > 0 && (
        <motion.section
          id={styles.keep_watching_container}
          variants={framerMotionVariants}
          initial={"initial"}
          animate={"animate"}
        >
          <h2>
            Keep Watching
            <span className={styles.media_count} data-keep-watching-count="true">
              {watchingList.length}
            </span>
          </h2>

          <div>
            {isWide ? (
              <>
                <ul
                  id="keep-watching-list"
                  className={styles.grid}
                  data-keep-watching-grid="true"
                  aria-label="Continue watching"
                >
                  {watchingList
                    .slice(0, Math.min(visibleCount, KEEP_WATCHING_MAX_COUNT))
                    .map((media) => (
                      <li key={media.id} role="listitem">
                        <KeepWatchingEpisodeInfo
                          animeInfo={media}
                          darkMode
                          layout="grid"
                          deleteFromListHook={() =>
                            setDeletedFromWatchingList((currMedias) => [
                              ...currMedias,
                              media,
                            ])
                          }
                        />
                      </li>
                    ))}
                </ul>

                {watchingList.length > KEEP_WATCHING_INITIAL_COUNT && (
                  <button
                    type="button"
                    className={styles.show_more_btn}
                    data-keep-watching-toggle="true"
                    aria-controls="keep-watching-list"
                    onClick={() =>
                      setVisibleCount((current) =>
                        current > KEEP_WATCHING_INITIAL_COUNT
                          ? KEEP_WATCHING_INITIAL_COUNT
                          : KEEP_WATCHING_MAX_COUNT,
                      )
                    }
                  >
                    {visibleCount > KEEP_WATCHING_INITIAL_COUNT
                      ? "Show less"
                      : "Show more"}
                  </button>
                )}
              </>
            ) : (
              <SwiperCarouselContainer
                // Fixed-width cards: the slide width comes from the card CSS
                // (240px on phones), so the swiper must not stretch them.
                // Swiper still snaps, drags and handles a11y.
                options={{
                  slidesPerView: "auto",
                  bp480: "auto",
                  bp740: "auto",
                  bp1275: "auto",
                }}
              >
                {watchingList.map((media) => (
                  <SwiperSlide
                    key={media.id}
                    className="custom_swiper_list_item"
                    role="listitem"
                  >
                    <KeepWatchingEpisodeInfo
                      animeInfo={media}
                      darkMode
                      deleteFromListHook={() =>
                        setDeletedFromWatchingList((currMedias) => [
                          ...currMedias,
                          media,
                        ])
                      }
                    />
                  </SwiperSlide>
                ))}
              </SwiperCarouselContainer>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

export default KeepWatchingSection;
