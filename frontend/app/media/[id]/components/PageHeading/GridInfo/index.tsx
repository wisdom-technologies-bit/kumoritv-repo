import React from "react";
import styles from "./component.module.css";
import { MediaDataFullInfo } from "@/app/ts/interfaces/anilistMediaData";
import stringToOnlyAlphabetic from "@/app/lib/convertStrings";
import { ImdbEpisode } from "@/app/ts/interfaces/imdb";
import { getMediaReleaseDate } from "@/app/lib/formatDateUnix";
import { displayTitle } from "@/app/lib/titles";

// Compact metadata strip: one small chip per fact (status/source, episodes,
// volumes, release, length or chapters). Same data and the same conditions as
// the old tall tiles, just readable at a glance.
//
// The rotated labels and the faded background icons are gone, and the play
// button no longer lives here: it is a primary action and sits in the hero row
// next to the round icon buttons.
export default function GridHeadingMediaInfo({
  mediaInfo,
  imdbEpisodes,
}: {
  mediaInfo: MediaDataFullInfo;
  imdbEpisodes?: ImdbEpisode[];
}) {
  function convertMediaStatus(status: string) {
    if (status == "NOT_YET_RELEASED") {
      return "TO BE RELEASED";
    } else if (status == "FINISHED") {
      return "COMPLETE";
    }

    return stringToOnlyAlphabetic(status) || "Not Available";
  }

  function getEpisodesQuantity() {
    return imdbEpisodes?.length || mediaInfo.episodes || "Not Available";
  }

  return (
    <section id={styles.info_list_container}>
      <ul aria-label={`${displayTitle(mediaInfo.title)} details`}>
        {mediaInfo.format == "MOVIE" ? (
          <li className={`${styles.info_item}`}>
            <span className={styles.label}>SOURCE</span>

            <p>
              {stringToOnlyAlphabetic(mediaInfo.source?.toUpperCase()) ||
                "Not Available"}
            </p>
          </li>
        ) : (
          <li className={`${styles.info_item}`}>
            <span className={styles.label}>STATUS</span>

            <p>{convertMediaStatus(mediaInfo.status || "Not Available")}</p>
          </li>
        )}

        {mediaInfo.type == "ANIME" &&
          mediaInfo.format != "MOVIE" &&
          mediaInfo.status != "NOT_YET_RELEASED" && (
            <li className={`${styles.info_item}`}>
              <span className={styles.label}>EPISODES</span>

              <p>{getEpisodesQuantity()}</p>
            </li>
          )}

        {mediaInfo.type == "MANGA" && (
          <li className={`${styles.info_item}`}>
            <span className={styles.label}>VOLUMES</span>

            <p>{mediaInfo.volumes || "Not Available"}</p>
          </li>
        )}

        <li className={`${styles.info_item}`}>
          <span className={styles.label}>RELEASE</span>

          <p className={styles.width_min_content}>
            {getMediaReleaseDate(
              mediaInfo.startDate && mediaInfo.endDate.year
                ? mediaInfo.endDate
                : mediaInfo.startDate || undefined
            )}
          </p>
        </li>

        <li className={`${styles.info_item}`}>
          {mediaInfo.type == "ANIME" && (
            <React.Fragment>
              <span className={styles.label}>LENGTH</span>

              <p>
                {mediaInfo.duration == null
                  ? "Not Available"
                  : `${mediaInfo.duration} min` || "Not Available"}
              </p>
            </React.Fragment>
          )}

          {mediaInfo.type == "MANGA" && (
            <React.Fragment>
              <span className={styles.label}>CHAPTERS</span>

              <p>{mediaInfo.chapters || "Not Available"}</p>
            </React.Fragment>
          )}
        </li>
      </ul>
    </section>
  );
}
