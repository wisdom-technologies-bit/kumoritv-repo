"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useEffect, useState } from "react";
import SwiperCarouselContainer from "../../SwiperCarouselContainer";
import styles from "./component.module.css";
import { AnimatePresence, motion } from "framer-motion";
import KeepWatchingEpisodeInfo from "./components/KeepWatchingEpisodeInfo";
import { SwiperSlide } from "swiper/react";
import { useAppSelector } from "@/app/lib/redux/hooks";
import { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";
import { listContinueWatchingFromServer } from "@/app/lib/user-data/progress";
import { imageKey } from "@/app/lib/episodes/images";

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

  useEffect(() => {
    if (user || anilistUser) getWatchingList();
  }, [user, anilistUser]);

  async function getWatchingList() {
    // Signed-in: latest incomplete watch_progress row per anime, from Supabase.
    // Guest / AniList-only: the local device copy.
    const continueWatchingList = await listContinueWatchingFromServer();
    const withImages = await fillEpisodeImages(continueWatchingList || []);

    setWatchingList(withImages);
  }

  return (
    <AnimatePresence initial={false}>
      {(user || anilistUser) && watchingList!.length > 0 && (
        <motion.section
          id={styles.keep_watching_container}
          variants={framerMotionVariants}
          initial={"initial"}
          animate={"animate"}
        >
          <h2>Keep Watching</h2>

          <div>
            <SwiperCarouselContainer
              options={{
                slidesPerView: 2.2,
                bp480: 2.2,
                bp740: 3.2,
                bp1275: 4.2,
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
