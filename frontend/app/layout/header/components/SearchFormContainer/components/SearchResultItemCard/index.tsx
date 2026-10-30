"use client";
import React, { useState } from "react";
import styles from "./component.module.css";
import Image from "next/image";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import Link from "next/link";
import { MediaOnJSONFile } from "@/app/ts/interfaces/jsonMediaData";
import { displayTitle } from "@/app/lib/titles";

type SearchResultsTypes = {
  handleChoseResult?: () => void;
  mediaFromAnilist?: MediaData;
  mediaFromOfflineDB?: MediaOnJSONFile;
  isActive?: boolean;
  onActivate?: () => void;
  onFocusResult?: () => void;
  onArrowDown?: () => void;
  onArrowUp?: () => void;
};

/** "TV_SHORT" -> "TV Short", "TV" -> "TV", "ONE_SHOT" -> "One Shot" */
function readableFormat(format?: string | null) {
  if (!format) return "";

  return format
    .split("_")
    .map((word) => {
      const lower = word.toLowerCase();
      // AniList's two-letter abbreviation stays uppercase.
      if (lower === "tv") return "TV";

      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function SearchResultItemCard({
  handleChoseResult,
  mediaFromAnilist,
  mediaFromOfflineDB,
  isActive = false,
  onActivate,
  onFocusResult,
  onArrowDown,
  onArrowUp,
}: SearchResultsTypes) {
  const [coverFailed, setCoverFailed] = useState(false);

  const imgSource =
    mediaFromAnilist?.coverImage?.large ||
    mediaFromAnilist?.coverImage?.medium ||
    mediaFromOfflineDB?.picture ||
    mediaFromOfflineDB?.thumbnail;

  const mediaTitle = mediaFromAnilist?.title
    ? displayTitle(mediaFromAnilist.title)
    : displayTitle(mediaFromOfflineDB?.title);

  const mediaType = (
    mediaFromAnilist?.type ||
    mediaFromOfflineDB?.type ||
    ""
  ).toString();

  const format = readableFormat(mediaFromAnilist?.format);
  const year =
    mediaFromAnilist?.startDate?.year ||
    mediaFromAnilist?.seasonYear ||
    mediaFromOfflineDB?.animeSeason?.year ||
    null;
  const genres = (
    mediaFromAnilist?.genres?.length
      ? mediaFromAnilist.genres
      : ((mediaFromOfflineDB?.tags ?? []) as string[])
  )
    .slice(0, 3)
    .map((genre) => genre.charAt(0).toUpperCase() + genre.slice(1));

  const metaLine = [format, year ? String(year) : null, genres.join(", ") || null]
    .filter(Boolean)
    .join(" · ");

  const href = `/media/${mediaFromAnilist?.id || mediaFromOfflineDB?.anilistId}`;

  return (
    <li
      className={styles.result_container}
      data-active={isActive}
      data-search-row-item="true"
      onMouseEnter={onActivate}
    >
      <Link
        className={styles.result_link}
        href={href}
        data-search-row="true"
        aria-current={isActive ? "true" : undefined}
        onClick={handleChoseResult}
        onFocus={onFocusResult}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onArrowDown?.();
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            onArrowUp?.();
          }
        }}
      >
        <span className={styles.cover_container} data-cover-failed={coverFailed}>
          {imgSource && !coverFailed ? (
            <Image
              src={imgSource}
              alt=""
              fill
              sizes="56px"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <span className={styles.cover_fallback} aria-hidden="true">
              {mediaTitle.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
        </span>

        <span className={styles.result_info_container}>
          <span className={styles.result_title}>{mediaTitle}</span>

          {metaLine && <span className={styles.result_meta}>{metaLine}</span>}
        </span>

        {mediaType && (
          <span className={styles.type_tag}>{mediaType.toUpperCase()}</span>
        )}
      </Link>
    </li>
  );
}

export default SearchResultItemCard;
