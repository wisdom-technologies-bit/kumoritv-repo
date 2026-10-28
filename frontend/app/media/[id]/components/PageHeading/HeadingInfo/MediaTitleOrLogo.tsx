import { MediaDataFullInfo } from "@/app/ts/interfaces/anilistMediaData";
import { ImdbMediaInfo } from "@/app/ts/interfaces/imdb";
import Image from "next/image";
import React from "react";
import styles from "./component.module.css";
import { displayTitle, secondaryTitle } from "@/app/lib/titles";

export default function HeadingTextAndMediaLogo({
  imdbMediaLogos,
  mediaTitles,
}: {
  imdbMediaLogos: ImdbMediaInfo["logos"] | undefined;
  mediaTitles: MediaDataFullInfo["title"];
  preferredLanguage?: string;
}) {
  // The big heading is always the english title (falling back to romaji, then
  // native). The small line above it is the native title, and it is hidden when
  // it would just repeat the heading.
  const headingTitle = displayTitle(mediaTitles);
  const nativeTitle = secondaryTitle(mediaTitles);
  const showSecondaryTitle = nativeTitle !== "" && nativeTitle.toUpperCase() !== headingTitle.toUpperCase();

  return (
    <React.Fragment>
      {imdbMediaLogos && imdbMediaLogos?.length > 0 ? (
        <React.Fragment>
          <h1>{headingTitle.toUpperCase()}</h1>

          <div
            className={styles.heading_img_container}
            style={{ aspectRatio: imdbMediaLogos[0]?.aspectRatio }}
          >
            <Image
              src={imdbMediaLogos[0]?.url}
              alt={headingTitle}
              fill
              sizes="(max-width: 520px) 100%, 280px"
            />
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          {showSecondaryTitle && <small>{nativeTitle}</small>}

          <h1 id={styles.heading_title}>{headingTitle.toUpperCase()}</h1>
        </React.Fragment>
      )}
    </React.Fragment>
  );
}
