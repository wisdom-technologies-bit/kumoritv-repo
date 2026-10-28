"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useState } from "react";
import styles from "./component.module.css";
import Link from "next/link";
import Image from "next/image";
import MediaFormatIcon from "../../../../DynamicAssets/MediaFormatIcon";
import DeleteSvg from "@/public/assets/trash.svg";
import { AnimatePresence, motion } from "framer-motion";
import fallbackImg from "@/public/photo-placeholder.jpg";
import { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";
import { deleteContinueWatching } from "@/app/lib/user-data/progress";
import { displayTitle } from "@/app/lib/titles";

type ComponentTypes = {
  animeInfo: KeepWatchingMediaData;
  deleteFromListHook: () => void;
  darkMode?: boolean;
};

function KeepWatchingEpisodeInfo({
  animeInfo,
  darkMode,
  deleteFromListHook,
}: ComponentTypes) {
  const [wasDeleted, setWasDeleted] = useState<boolean>(false);

  const { user } = useUser();

  async function removeFromKeepWatching() {
    // Deletes this anime's incomplete watch_progress rows (and the local copy).
    await deleteContinueWatching(animeInfo.id);

    setWasDeleted(true);

    setTimeout(() => {
      deleteFromListHook();
    }, 350);
  }

  return (
    <AnimatePresence>
      {!wasDeleted && (
        <motion.div
          className={`${styles.media_item_container} ${darkMode ? styles.darkMode : ""}`}
          data-deleted={wasDeleted}
          animate={{ transition: { duration: 0.2 } }}
          exit={{ opacity: 0, scale: 0 }}
        >
          <div id={styles.img_container}>
            <Image
              title={displayTitle(animeInfo.title)}
              src={animeInfo.episodeImg || fallbackImg}
              placeholder="blur"
              blurDataURL="https://upload.wikimedia.org/wikipedia/commons/8/8d/ERR0R_NO_IMAGE_FOUND.jpg"
              alt={displayTitle(animeInfo.title)}
              fill
              sizes="(max-width: 324px) 100vw, (max-width: 495px) 50vw, (max-width: 1025px) 200px, (max-width: 1479px) 180px, 174px"
            ></Image>

            <span className={styles.media_type_icon}>
              <MediaFormatIcon format={animeInfo.format} />

              <span className={styles.media_format_title}>
                {animeInfo.format == "TV" ? "ANIME" : animeInfo.format}
              </span>
            </span>

            <div className={styles.overlay_info_container}>
              <Link
                href={`/watch/${animeInfo.id}?source=${animeInfo.source}&episode=${animeInfo.episode}&q=${animeInfo.episodeId}&t=${animeInfo.episodeTimeLastStop || 0}${animeInfo.dub ? "&dub=true" : ""}`}
              >
                {animeInfo.format != "MOVIE" ? "CONTINUE EPISODE" : "CONTINUE"}
              </Link>
            </div>

            {animeInfo.format != "MOVIE" && (
              <span className={styles.episode_name_span}>
                Episode {animeInfo.episode}
              </span>
            )}

            <motion.div className={styles.progress_bar}>
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{
                  scaleX:
                    ((animeInfo.episodeTimeLastStop /
                      animeInfo.episodeDuration) *
                      100) /
                      100 || 0.005,
                }}
                transition={{ duration: 1 }}
              />
            </motion.div>
          </div>

          <div className={styles.info_bottom}>
            <Link href={`/media/${animeInfo.id}`}>
              {displayTitle(animeInfo.title)}
            </Link>

            <button
              onClick={() => removeFromKeepWatching()}
              title={`Remove ${displayTitle(animeInfo.title)} from Keep Watching`}
            >
              <DeleteSvg width={16} height={16} alt="Delete" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default KeepWatchingEpisodeInfo;
