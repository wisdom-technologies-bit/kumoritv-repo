"use client";

import { MediaDataFullInfo } from "@/app/ts/interfaces/anilistMediaData";
import { ImdbMediaInfo } from "@/app/ts/interfaces/imdb";
import Image from "next/image";
import React from "react";
import styles from "./component.module.css";
import { displayTitle, secondaryTitle } from "@/app/lib/titles";

/** A stylised title logo (TMDB transparent PNG) stored in our own database. */
export type TitleLogo = {
  url: string;
  aspectRatio: number;
  width: number;
};

/** The heading text is the natural title; casing is a CSS decision, never a
 *  `.toUpperCase()` on the string, so the DOM keeps the real title for SEO and
 *  for screen readers. */

export default function HeadingTextAndMediaLogo({
  imdbMediaLogos,
  mediaTitles,
  titleLogo,
}: {
  imdbMediaLogos?: ImdbMediaInfo["logos"] | undefined;
  mediaTitles: MediaDataFullInfo["title"];
  preferredLanguage?: string;
  titleLogo?: TitleLogo;
}) {
  // A failed logo request falls back to the plain text heading instead of an
  // empty box.
  const [logoFailed, setLogoFailed] = React.useState(false);

  // The big heading is always the english title (falling back to romaji, then
  // native). The small line above it is the native title, and it is hidden when
  // it would just repeat the heading.
  const headingTitle = displayTitle(mediaTitles);
  const nativeTitle = secondaryTitle(mediaTitles);
  const showSecondaryTitle = nativeTitle !== "" && nativeTitle.toUpperCase() !== headingTitle.toUpperCase();

  // New database logo first, then the legacy AniList/IMDB shaped prop.
  const legacyLogo = imdbMediaLogos?.[0];
  const logo: TitleLogo | null =
    titleLogo && titleLogo.url
      ? titleLogo
      : legacyLogo?.url
        ? {
            url: legacyLogo.url,
            aspectRatio: legacyLogo.aspectRatio || 3,
            width: legacyLogo.width || 1000,
          }
        : null;

  const showLogo = logo !== null && !logoFailed;

  const displayWidth = Math.min(420, Math.max(120, Math.round(logo?.width || 1000)));
  const safeAspectRatio =
    logo && Number.isFinite(logo.aspectRatio) && logo.aspectRatio > 0 ? logo.aspectRatio : 3;
  const displayHeight = Math.max(1, Math.round(displayWidth / safeAspectRatio));

  return (
    <React.Fragment>
      {showSecondaryTitle && <small>{nativeTitle}</small>}

      {showLogo && logo ? (
        <React.Fragment>
          {/* Real title stays in the document: hidden visually, not removed. */}
          <h1 className={styles.sr_only}>{headingTitle}</h1>

          <div className={styles.heading_img_container}>
            <Image
              src={logo.url}
              alt={headingTitle}
              width={displayWidth}
              height={displayHeight}
              unoptimized
              onError={() => setLogoFailed(true)}
              className={styles.heading_logo}
            />
          </div>
        </React.Fragment>
      ) : (
        <h1 id={styles.heading_title}>{headingTitle}</h1>
      )}
    </React.Fragment>
  );
}
