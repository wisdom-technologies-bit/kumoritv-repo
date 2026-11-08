import React from "react";
import GridHeadingMediaInfo from "./GridInfo";
import HeadingInfo from "./HeadingInfo";
import { MediaDataFullInfo } from "@/app/ts/interfaces/anilistMediaData";
import { ImdbEpisode, ImdbMediaInfo } from "@/app/ts/interfaces/imdb";
import type { TitleLogo } from "./HeadingInfo/MediaTitleOrLogo";

export default function PageHeading({
  mediaInfo,
  imdbMediaInfo,
  searchParams,
  imdbEpisodes,
  titleLogo,
}: {
  mediaInfo: MediaDataFullInfo;
  imdbMediaInfo?: ImdbMediaInfo;
  searchParams: { lang?: string };
  imdbEpisodes?: ImdbEpisode[];
  /** Stylised logo stored in our own database (TMDB), when there is one. */
  titleLogo?: TitleLogo;
}) {
  return (
    <React.Fragment>
      <HeadingInfo
        mediaInfo={mediaInfo}
        imdbMediaInfo={imdbMediaInfo}
        searchParams={searchParams}
        imdbEpisodes={imdbEpisodes}
        titleLogo={titleLogo}
      />

      <GridHeadingMediaInfo mediaInfo={mediaInfo} imdbEpisodes={imdbEpisodes} />
    </React.Fragment>
  );
}
