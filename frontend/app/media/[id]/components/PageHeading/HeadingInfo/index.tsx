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
}: {
  mediaInfo: MediaDataFullInfo;
  searchParams: { lang?: string };
  imdbMediaInfo?: ImdbMediaInfo;
  imdbEpisodes?: ImdbEpisode[];
  titleLogo?: TitleLogo;
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
            <AddToNotificationsButton mediaInfo={mediaInfo} />

            <AddToList.Button
              statusOnAnilist={mediaInfo.mediaListEntry?.status}
              listEntryId={mediaInfo.mediaListEntry?.id}
              mediaInfo={mediaInfo as MediaData}
              imdbEpisodesList={imdbEpisodes}
              amountWatchedOrRead={mediaInfo.mediaListEntry?.progress}
            >
              <AddToFavourites.SvgIcon>
                <PlusSvg fill="var(--white-100)" />
              </AddToFavourites.SvgIcon>

              <AddToFavourites.SvgIcon>
                <PlusSvg fill="var(--brand-color)" />
              </AddToFavourites.SvgIcon>
            </AddToList.Button>

            <AddToFavourites.Button
              isActiveOnAnilist={mediaInfo.isFavourite}
              mediaInfo={mediaInfo as MediaData}
            >
              <AddToFavourites.SvgIcon>
                <FavouriteSvg fill="var(--white-100)" />
              </AddToFavourites.SvgIcon>

              <AddToFavourites.SvgIcon>
                <FavouriteFillSvg fill="var(--brand-color)" />
              </AddToFavourites.SvgIcon>
            </AddToFavourites.Button>
          </div>
        </div>
      </div>
    </section>
  );
}
