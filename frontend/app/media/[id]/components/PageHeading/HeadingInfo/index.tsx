import React from "react";
import styles from "./component.module.css";
import AddToNotificationsButton from "@/app/components/Buttons/AddToNotification";
import {
  MediaData,
  MediaDataFullInfo,
} from "@/app/ts/interfaces/anilistMediaData";
import Link from "next/link";
import Image from "next/image";
import HeadingTextAndMediaLogo from "./MediaTitleOrLogo";
import { ImdbEpisode, ImdbMediaInfo } from "@/app/ts/interfaces/imdb";
import * as AddToFavourites from "@/app/components/Buttons/AddToFavourites";
import * as AddToList from "@/app/components/Buttons/AddToList";
import FavouriteSvg from "@/public/assets/heart.svg";
import FavouriteFillSvg from "@/public/assets/heart-fill.svg";
import PlusSvg from "@/public/assets/plus-lg.svg";
import PlayBtn from "../../WatchPlayBtn";
import { displayTitle } from "@/app/lib/titles";
import type { TitleLogo } from "./MediaTitleOrLogo";

export default function HeadingInfo({
  mediaInfo,
  searchParams,
  imdbMediaInfo,
  imdbEpisodes,
  titleLogo,
  infoSlot,
}: {
  mediaInfo: MediaDataFullInfo;
  searchParams: { lang?: string };
  imdbMediaInfo?: ImdbMediaInfo;
  imdbEpisodes?: ImdbEpisode[];
  titleLogo?: TitleLogo;
  /** The facts strip (STATUS / EPISODES / RELEASE / ...). Rendered once, here,
      under the actions row so desktop can read it as one compact block. */
  infoSlot?: React.ReactNode;
}) {
  // Poster card for the desktop hero. Hidden with CSS below 1024px, where the
  // banner already carries the artwork.
  const poster = mediaInfo.coverImage?.extraLarge || mediaInfo.coverImage?.large;

  return (
    <section id={styles.hero}>
      {poster ? (
        <div id={styles.poster}>
          <Image
            src={poster}
            alt={`${displayTitle(mediaInfo.title)} cover`}
            fill
            priority
            sizes="(max-width: 1023px) 1px, (max-width: 1439px) 200px, 240px"
          />
        </div>
      ) : null}

      <div id={styles.hero_body}>
        <div id={styles.media_title_container}>
          <HeadingTextAndMediaLogo
            imdbMediaLogos={imdbMediaInfo?.logos}
            mediaTitles={mediaInfo.title}
            preferredLanguage={searchParams.lang}
            titleLogo={titleLogo}
          />
        </div>

        <div
          id={styles.genres_and_type_container}
          className="display_flex_row align_items_center"
        >
          <div
            id={styles.genres_container}
            className="display_flex_row align_items_center"
          >
            {mediaInfo.genres && (
              <ul>
                {mediaInfo.genres.slice(0, 3).map((genre, key) => (
                  <li key={key}>
                    <Link href={`/search?genre=[${genre.toLowerCase()}]`}>
                      {genre}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {mediaInfo.format && (
              <span id={styles.format_chip}>
                {(mediaInfo.format == "TV"
                  ? "anime"
                  : mediaInfo.format
                ).toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* PRIMARY ACTION (Play / Continue) + round icon actions */}
        <div id={styles.hero_actions}>
          <ul id={styles.watch_action}>
            <PlayBtn
              mediaId={mediaInfo.id}
              mediaTitle={displayTitle(mediaInfo.title)}
              mediaFormat={mediaInfo.format}
              anilistLastEpisodeWatched={
                mediaInfo.mediaListEntry?.status != "COMPLETED"
                  ? mediaInfo.mediaListEntry?.progress
                  : undefined
              }
              mediaEpisodes={mediaInfo.episodes}
              nextAiringEpisode={mediaInfo.nextAiringEpisode}
            />
          </ul>

          <div id={styles.btns_actions_container}>
            <AddToNotificationsButton mediaInfo={mediaInfo} variant="round" />

            <AddToList.Button
              statusOnAnilist={mediaInfo.mediaListEntry?.status}
              listEntryId={mediaInfo.mediaListEntry?.id}
              mediaInfo={mediaInfo as MediaData}
              imdbEpisodesList={imdbEpisodes}
              amountWatchedOrRead={mediaInfo.mediaListEntry?.progress}
              variant="round"
            >
              <AddToFavourites.SvgIcon>
                <PlusSvg
                  className={styles.plus_icon}
                  fill="currentColor"
                  viewBox="0 0 16 16"
                />
              </AddToFavourites.SvgIcon>

              <AddToFavourites.SvgIcon>
                <PlusSvg
                  className={styles.plus_icon}
                  fill="currentColor"
                  viewBox="0 0 16 16"
                />
              </AddToFavourites.SvgIcon>
            </AddToList.Button>

            <AddToFavourites.Button
              isActiveOnAnilist={mediaInfo.isFavourite}
              mediaInfo={mediaInfo as MediaData}
              variant="round"
            >
              <AddToFavourites.SvgIcon>
                <FavouriteSvg fill="var(--white-100)" viewBox="0 0 16 16" />
              </AddToFavourites.SvgIcon>

              <AddToFavourites.SvgIcon>
                <FavouriteFillSvg fill="var(--brand-color)" viewBox="0 0 16 16" />
              </AddToFavourites.SvgIcon>
            </AddToFavourites.Button>
          </div>
        </div>

        {/* FACTS STRIP: STATUS/SOURCE, EPISODES, VOLUMES, RELEASE, LENGTH/CHAPTERS.
            Comes from PageHeading as a prop so it exists exactly once in the DOM. */}
        {infoSlot}
      </div>
    </section>
  );
}
