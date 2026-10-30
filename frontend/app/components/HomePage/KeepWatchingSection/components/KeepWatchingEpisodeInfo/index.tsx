"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useState } from "react";
import styles from "./component.module.css";
import Link from "next/link";
import Image from "next/image";
import DeleteSvg from "@/public/assets/trash.svg";
import { AnimatePresence, motion } from "framer-motion";
import fallbackImg from "@/public/photo-placeholder.jpg";
import { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";
import { deleteContinueWatching } from "@/app/lib/user-data/progress";
import { displayTitle } from "@/app/lib/titles";
import { remainingLabel } from "@/app/lib/episodes/items";

/** Inline so the card needs no asset import for one glyph. */
function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}

type ComponentTypes = {
  animeInfo: KeepWatchingMediaData;
  deleteFromListHook: () => void;
  darkMode?: boolean;
};

/** /watch/{id}?ep=N&t={seconds}&audio={sub|dub} (legacy params dropped). */
export function watchHref(animeInfo: KeepWatchingMediaData) {
  const episode = Number(animeInfo.episode) || 1;
  const time = Math.floor(Number(animeInfo.episodeTimeLastStop) || 0);
  return `/watch/${animeInfo.id}?ep=${episode}${time > 0 ? `&t=${time}` : ""}&audio=${
    animeInfo.dub ? "dub" : "sub"
  }`;
}

/** 0-1, never 0 so a started episode still shows a sliver of progress. */
export function progressRatio(animeInfo: KeepWatchingMediaData) {
  const duration = Number(animeInfo.episodeDuration);
  const position = Number(animeInfo.episodeTimeLastStop) || 0;

  if (!Number.isFinite(duration) || duration <= 0) return 0;

  return Math.min(1, Math.max(position / duration, 0.005));
}

/** "Episode 18 · 11m left" */
export function episodeMetaLine(animeInfo: KeepWatchingMediaData) {
  const remaining = remainingLabel(
    animeInfo.episodeTimeLastStop,
    animeInfo.episodeDuration,
  );
  const episode = Number(animeInfo.episode) || 1;
  const showEpisode = animeInfo.format != "MOVIE";

  return [showEpisode ? `Episode ${episode}` : null, remaining || null]
    .filter(Boolean)
    .join(" · ");
}

function KeepWatchingEpisodeInfo({
  animeInfo,
  darkMode,
  deleteFromListHook,
}: ComponentTypes) {
  const [wasDeleted, setWasDeleted] = useState<boolean>(false);
  const [imageFailed, setImageFailed] = useState<boolean>(false);

  const { user } = useUser();

  const title = displayTitle(animeInfo.title);
  const episodeNumber = Number(animeInfo.episode) || 1;
  const metaLine = episodeMetaLine(animeInfo);
  const ratio = progressRatio(animeInfo);
  const showEpisodeBadge = animeInfo.format != "MOVIE";
  const coverSrc = animeInfo.episodeImg || fallbackImg;

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
          <Link
            className={styles.card_link}
            href={watchHref(animeInfo)}
            aria-label={`${title}, episode ${episodeNumber}`}
            data-keep-watching-link="true"
          >
            <div id={styles.img_container} data-image-failed={imageFailed}>
              {imageFailed ? (
                <span className={styles.img_placeholder} data-img-fallback="true">
                  <PlayIcon size={22} />
                </span>
              ) : (
                <Image
                  title={title}
                  src={coverSrc}
                  placeholder="blur"
                  blurDataURL="https://upload.wikimedia.org/wikipedia/commons/8/8d/ERR0R_NO_IMAGE_FOUND.jpg"
                  alt={title}
                  fill
                  sizes="(max-width: 640px) 280px, 320px"
                  onError={() => setImageFailed(true)}
                />
              )}

              <span className={styles.gradient} aria-hidden="true" />

              <span className={styles.play_circle} aria-hidden="true">
                <PlayIcon size={16} />
              </span>

              {showEpisodeBadge && (
                <span className={styles.ep_badge}>Ep. {episodeNumber}</span>
              )}

              <span className={styles.progress_bar} aria-hidden="true">
                <span
                  className={styles.progress_fill}
                  style={{ transform: `scaleX(${ratio})` }}
                  data-progress-ratio={ratio}
                />
              </span>
            </div>
          </Link>

          <button
            type="button"
            className={styles.delete_btn}
            onClick={() => removeFromKeepWatching()}
            title={`Remove ${title} from Keep Watching`}
            aria-label={`Remove ${title} from Keep Watching`}
          >
            <DeleteSvg width={16} height={16} alt="" />
          </button>

          <div className={styles.info_bottom}>
            <Link className={styles.card_title} href={`/media/${animeInfo.id}`}>
              {title}
            </Link>

            <p className={styles.meta_line}>
              {metaLine}

              {animeInfo.dub && (
                <span className={styles.dub_tag} data-dub-tag="true">
                  DUB
                </span>
              )}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default KeepWatchingEpisodeInfo;
