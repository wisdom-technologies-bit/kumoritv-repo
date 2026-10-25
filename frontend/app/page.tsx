import styles from "./page.module.css";
import Link from "next/link";
import React from "react";
import HeroCarousel from "./components/HomePage/HeroCarouselHomePage";
import * as anilist from "./lib/anilist/medias.server";
import NavigationThroughMedias from "./components/HomePage/NavigationThroughMedias";
import parse from "html-react-parser";
import NewestMediaSection from "./components/HomePage/NewestMediaSection";
import MediaRankingSection from "./components/HomePage/MediaRankingSection";
import { AiringMediaResult, MediaData } from "./ts/interfaces/anilistMediaData";
import { Metadata } from "next";
import * as AddToPlaylistButton from "./components/Buttons/AddToFavourites";
import { checkDeviceIsMobile } from "./lib/checkMobileOrDesktop";
import { cookies, headers } from "next/headers";
import KeepWatchingSection from "./components/HomePage/KeepWatchingSection";
import PopularMediaSection from "./components/HomePage/PopularMediaSection";

export const metadata: Metadata = {
  title: "Home | KumoriTV",
  description:
    "A anime platform that showcases popular and trending animes, mangas and movies. Explore the latest releases, keep watching your favorites, and discover what's popular in the anime world.",
  keywords: [
    "Aniproject",
    "Ani project",
    "Ani project github",
    "Animes",
    "Anime Reviews",
    "Latest Anime Releases",
    "Anime Genres",
    "Popular Anime Series",
    "Anime News",
    "Anime Characters",
    "Manga Recommendations",
    "Anime Community",
    "Anime Events",
    "Subbed Anime",
    "Dubbed Anime",
    "Classic Anime",
    "Anime Trailers",
    "Anime Forums",
    "Anime Art",
    "Anime Culture",
  ],
};

export default async function Home() {
  const isOnMobileScreen = checkDeviceIsMobile(headers());

  const accessTokenCookie = cookies().get("access_token")?.value;

  const userAuthorization = accessTokenCookie
    ? JSON.parse(accessTokenCookie).accessToken
    : undefined;

  // section 3
  const listAnimesTrending = (await anilist.getMediaForThisFormat({
    type: "ANIME",
    accessToken: userAuthorization,
  })) as MediaData[];

  // section 1
  const listAnimesTrendingWithBackground = listAnimesTrending.filter(
    (item) => item.bannerImage
  );

  // section 2
  const listAnimesReleasingByPopularity = await anilist
    .getNewReleases({
      type: "ANIME",
      status: "RELEASING",
      page: 1,
      perPage: 12,
      accessToken: userAuthorization,
    })
    .then((res) => res as MediaData[]);

  // section 3
  const listMediasToBannerSection = (await anilist.getMediaForThisFormat({
    type: "ANIME",
    sort: "SCORE_DESC",
    accessToken: userAuthorization,
  })) as MediaData[];

  const randomIndexForBannerSection = listMediasToBannerSection.length
    ? Math.min(Math.floor(Math.random() * listMediasToBannerSection.length), listMediasToBannerSection.length - 1)
    : 0;
  const bannerMedia = listMediasToBannerSection[randomIndexForBannerSection];

  // section 4 data
  const listMediasReleasedToday = await anilist
    .getReleasingByDaysRange({
      type: "ANIME",
      days: 0,
      perPage: 11,
      accessToken: userAuthorization,
    })
    .then((res) =>
      (res as AiringMediaResult[])
        .sort((a, b) => a.media.popularity - b.media.popularity)
        .reverse()
    )
    .then((res) => res.map((item) => item.media));

  return (
    <main id={styles.container} className={styles.main}>
      {/* HERO */}
      <HeroCarousel
        animesList={listAnimesTrendingWithBackground}
        isOnMobileScreen={isOnMobileScreen || false}
      />

      {/* Keep Watching  */}
      <KeepWatchingSection />

      {/* POPULAR MEDIA SECTION*/}
      <PopularMediaSection animesList={listAnimesReleasingByPopularity} />

      {/* SECTION => SHOWS MEDIA RELEASED BY A SELECTED TIME (today, 7 days, 30 days)  */}
      <section className={styles.medias_sections_container}>
        <NavigationThroughMedias
          headingTitle={"Latest Releases"}
          route={"#"}
          sortBy="RELEASE"
          isFetchByDateButtonsOnScreen
          isResultsSortedByTrending
        />
      </section>

      {/* SECTION => Media Banner With Trailer Embeded  */}
      {bannerMedia && <section
        id={styles.media_banner_container}
        style={{
          background: `linear-gradient(rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.35)), url(${bannerMedia.bannerImage})`,
        }}
      >
        <div>
          <div id={styles.media_info}>
            {bannerMedia && (
              <h3>
                <Link
                  href={`/media/${bannerMedia.id}`}
                >
                  {
                    bannerMedia.title
                      .romaji
                  }
                </Link>
              </h3>
            )}

            {bannerMedia
              ?.description && (
              <span>
                {parse(
                  bannerMedia.description.replace(
                    new RegExp(`<br[^>]*>|<\/br>`, "gi"),
                    " "
                  )
                )}
              </span>
            )}

            <div className={styles.item_buttons}>
              <Link
                href={`/media/${bannerMedia.id}`}
              >
                WATCH NOW
              </Link>

              <AddToPlaylistButton.Button
                mediaInfo={
                  bannerMedia
                }
              />
            </div>
          </div>

          <div id={styles.player_button_container}>
            {bannerMedia.trailer && (
              <iframe
                className="yt_embed_video"
                src={`https://www.youtube.com/embed/${bannerMedia.trailer.id}?controls=0&showinfo=0`}
                frameBorder={0}
                title={
                  bannerMedia.title
                    .romaji + " Trailer"
                }
                allow="accelerometer; autoplay; encrypted-media; gyroscope;"
                allowFullScreen
              />
            )}
          </div>
        </div>
      </section>}

      {/* SECTION => SHOWS MEDIAS SORTED BY FAVOURITES */}
      <section
        className={`${styles.medias_sections_container} ${styles.dark_background}`}
      >
        <NavigationThroughMedias
          headingTitle={"All Time Favorites"}
          route={"#"}
          sortBy={"FAVOURITES_DESC"}
          onDarkBackground
        />
      </section>

      {/* SECTION => SHOWS MEDIAS SORTED BY LATEST UPDATES ON ANILIST */}
      <section className={`${styles.medias_sections_container}`}>
        <NavigationThroughMedias
          headingTitle={"Show Me Something New"}
          route={"#"}
          sortBy={"UPDATED_AT_DESC"}
          isLayoutInverted
        />
      </section>

      {/* RANKING and NEWEST SECTION */}
      <section className={styles.background}>
        {/* SECTION => MANGAS SORTED BY FAVOURITES */}
        <section
          className={`${styles.medias_sections_container} ${styles.transparent_background}`}
        >
          <NavigationThroughMedias
            headingTitle={"Best Rated Mangas"}
            route={"#"}
            mediaFormat="MANGA"
            sortBy={"FAVOURITES_DESC"}
            onDarkBackground
          />
        </section>

        <div id={styles.media_ranks_container}>
          {/* RANKING CONTAINER */}
          <MediaRankingSection initialAnimesList={listAnimesTrending} />

          {/* NEWEST CONTAINER*/}
          <NewestMediaSection initialAnimesList={listMediasReleasedToday} />
        </div>
      </section>
    </main>
  );
}
