"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useCallback, useEffect, useRef, useState } from "react";
import SwiperCarouselContainer from "../../SwiperCarouselContainer";
import styles from "./component.module.css";
import { AnimatePresence, motion } from "framer-motion";
import KeepWatchingEpisodeInfo from "./components/KeepWatchingEpisodeInfo";
import { SwiperSlide } from "swiper/react";
import { useAppSelector } from "@/app/lib/redux/hooks";
import { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";
import {
  listContinueWatchingFromServer,
  subscribe,
} from "@/app/lib/user-data/progress";
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

function KeepWatchingSection() {
  const anilistUser = useAppSelector((state) => state.UserInfo.value);

  const { user } = useUser();

  const [watchingList, setWatchingList] = useState<KeepWatchingMediaData[]>([]);
  // Episode thumbnails already resolved this page load: a refresh must not ask
  // for them again.
  const knownImages = useRef<Map<string, string>>(new Map());
  const [deletedFromWatchingList, setDeletedFromWatchingList] = useState<
    KeepWatchingMediaData[]
  >([]);

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
          <h2>Keep Watching</h2>

          <div>
            <SwiperCarouselContainer
              // Fixed-width cards: the slide width comes from the card CSS
              // (280px on phones, 320px from 741px up), so the swiper must not
              // stretch them. Swiper still snaps, drags and handles a11y.
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
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

export default KeepWatchingSection;
