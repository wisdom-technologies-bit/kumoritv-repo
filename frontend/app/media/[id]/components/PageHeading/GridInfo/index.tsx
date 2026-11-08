import React from "react";
import styles from "./component.module.css";
import { MediaDataFullInfo } from "@/app/ts/interfaces/anilistMediaData";
import stringToOnlyAlphabetic from "@/app/lib/convertStrings";
import { ImdbEpisode } from "@/app/ts/interfaces/imdb";
import { getMediaReleaseDate } from "@/app/lib/formatDateUnix";
import { displayTitle } from "@/app/lib/titles";
import {
  ChaptersIcon,
  EpisodesIcon,
  LengthIcon,
  ReleaseIcon,
  SourceIcon,
  StatusIcon,
  VolumesIcon,
} from "./icons";

// The media facts strip: status/source, episodes, volumes, release, length or
// chapters. Same facts, same conditions, same order as before.
//
// Placement: it is rendered once, from inside the hero body (PageHeading passes
// it to HeadingInfo as `infoSlot`), directly under the Play pill and the round
// icon buttons. Phones keep the wrapping chip layout, desktop turns the same
// list into a compact two-column, two-line icon grid.
//
// Every icon is decorative (`aria-hidden`), so the text label is still the only
// thing a screen reader announces for each fact.
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
            <span className={styles.label}>
              <SourceIcon className={styles.icon} />

              <span className={styles.label_text}>SOURCE</span>
            </span>

            <p>
              {stringToOnlyAlphabetic(mediaInfo.source?.toUpperCase()) ||
                "Not Available"}
            </p>
          </li>
        ) : (
          <li className={`${styles.info_item}`}>
            <span className={styles.label}>
              <StatusIcon className={styles.icon} />

              <span className={styles.label_text}>STATUS</span>
            </span>

            <p>{convertMediaStatus(mediaInfo.status || "Not Available")}</p>
          </li>
        )}

        {mediaInfo.type == "ANIME" &&
          mediaInfo.format != "MOVIE" &&
          mediaInfo.status != "NOT_YET_RELEASED" && (
            <li className={`${styles.info_item}`}>
              <span className={styles.label}>
                <EpisodesIcon className={styles.icon} />

                <span className={styles.label_text}>EPISODES</span>
              </span>

              <p>{getEpisodesQuantity()}</p>
            </li>
          )}

        {mediaInfo.type == "MANGA" && (
          <li className={`${styles.info_item}`}>
            <span className={styles.label}>
              <VolumesIcon className={styles.icon} />

              <span className={styles.label_text}>VOLUMES</span>
            </span>

            <p>{mediaInfo.volumes || "Not Available"}</p>
          </li>
        )}

        <li className={`${styles.info_item}`}>
          <span className={styles.label}>
            <ReleaseIcon className={styles.icon} />

            <span className={styles.label_text}>RELEASE</span>
          </span>

          {/* A long date ("October 20, 1999") wraps inside its own cell instead
              of widening the grid. */}
          <p>
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
              <span className={styles.label}>
                <LengthIcon className={styles.icon} />

                <span className={styles.label_text}>LENGTH</span>
              </span>

              <p>
                {mediaInfo.duration == null
                  ? "Not Available"
                  : `${mediaInfo.duration} min` || "Not Available"}
              </p>
            </React.Fragment>
          )}

          {mediaInfo.type == "MANGA" && (
            <React.Fragment>
              <span className={styles.label}>
                <ChaptersIcon className={styles.icon} />

                <span className={styles.label_text}>CHAPTERS</span>
              </span>

              <p>{mediaInfo.chapters || "Not Available"}</p>
            </React.Fragment>
          )}
        </li>
      </ul>
    </section>
  );
}
