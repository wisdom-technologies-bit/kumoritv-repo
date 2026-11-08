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
    <HeadingInfo
      mediaInfo={mediaInfo}
      imdbMediaInfo={imdbMediaInfo}
      searchParams={searchParams}
      imdbEpisodes={imdbEpisodes}
      titleLogo={titleLogo}
      /* The facts strip is rendered ONCE and handed to the hero, which places
         it right under the Play pill and the round icon buttons. It used to be
         a sibling of the hero, which is why it could not sit under the actions
         row on desktop without a second copy of the facts in the DOM. */
      infoSlot={
        <GridHeadingMediaInfo mediaInfo={mediaInfo} imdbEpisodes={imdbEpisodes} />
      }
    />
  );
}
