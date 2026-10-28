import { MediaDataFullInfo } from "@/app/ts/interfaces/anilistMediaData";
import React from "react";
import styles from "./page.module.css";
import Image from "next/image";
import parse from "html-react-parser";
import * as MediaCard from "@/app/components/MediaCards/MediaCard";
import MangaChaptersContainer from "./components/MangaChaptersContainer";
import ScoreRating from "@/app/components/DynamicAssets/ScoreRating";
import { headers } from "next/headers";
import { checkDeviceIsMobile } from "@/app/lib/checkMobileOrDesktop";
import { convertFromUnix, getMediaReleaseDate } from "@/app/lib/formatDateUnix";
import MediaRelatedContainer from "./components/MediaRelatedContainer";
import PageHeading from "./components/PageHeading";
import Reviews from "./components/Reviews";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import { animeName, buildMediaCanonical, buildMediaDescription, buildMediaTitle } from "@/app/lib/seo/titles";
import { absoluteUrl } from "@/app/lib/seo/text";
import { anilistStartDateIso, buildMediaJsonLd } from "@/app/lib/seo/jsonld";
import JsonLd from "@/app/lib/seo/JsonLd";
import { notFound } from "next/navigation";
import { displayTitle } from "@/app/lib/titles";
import { Suspense } from "react";
import EpisodesSection from "./components/EpisodesSection";
import CommentsSection from "@/app/components/CommentsSection";

export const maxDuration = 60;

export async function generateMetadata({ params }: { params: { id: number } }) {
  const id = Number(params.id);
  const mediaData = await getMediaInfo({ id });
  if (!mediaData) return { title: "Not Found", robots: { index: false, follow: false } };

  const name = animeName(mediaData.title) || `Anime ${id}`;
  const title = buildMediaTitle({
    animeName: name,
    year: mediaData.seasonYear || mediaData.startDate?.year,
  });
  const description = buildMediaDescription({ description: mediaData.description, animeName: name });
  const canonical = buildMediaCanonical(id);
  const image = { url: absoluteUrl(`/og/${id}`), width: 1200, height: 630, alt: title };
  const keywords = [
    mediaData.title.romaji,
    mediaData.title.english,
    mediaData.title.native,
    `${mediaData.title.romaji} anime`,
    `${mediaData.title.romaji} episodes`,
    `${name} watch online`,
    "anime info",
  ].filter((keyword): keyword is string => typeof keyword === "string" && !!keyword.trim());

  return {
    title,
    description,
    keywords,
    alternates: { canonical },
    openGraph: {
      type: mediaData.format === "MOVIE" ? "video.movie" : "video.tv_show",
      title,
      description,
      url: canonical,
      siteName: "KumoriTV",
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: { index: true, follow: true },
  };
}

export default async function MediaPage({
  params,
  searchParams,
}: {
  params: { id: number };
  searchParams: { lang?: string };
}) {
  const isOnMobileScreen = checkDeviceIsMobile(headers()) || false;

  const mediaInfo = (await getMediaInfo({ id: Number(params.id) })) as MediaDataFullInfo | null;
  if (!mediaInfo) {
    notFound();
    return null;
  }

  // External episode providers are intentionally disabled until task 7a.
  const imdbMediaInfo = undefined;

  function randomizeBcgImg() {
    const backgroundImgs: { url: string }[] = [];

    if (mediaInfo?.bannerImage)
      backgroundImgs.push({ url: mediaInfo?.bannerImage });
    const randomNumber = Math.floor(Math.random() * backgroundImgs?.length);

    return backgroundImgs[randomNumber]?.url;
  }

  function bcgImgBasedOnScreenDisplay() {
    if (isOnMobileScreen) {
      return `linear-gradient(rgba(0, 0, 0, 0.05), var(--background) 100%), url(${mediaInfo?.coverImage?.extraLarge})`;
    } else {
      return `linear-gradient(rgba(0, 0, 0, 0.05), var(--background) 100%), url(${
        mediaInfo!.format == "MANGA" ? mediaInfo!.bannerImage : randomizeBcgImg()
      })`;
    }
  }

  const canonical = buildMediaCanonical(params.id);
  const structuredData = buildMediaJsonLd({
    id: mediaInfo.id,
    name: animeName(mediaInfo.title) || `Anime ${params.id}`,
    alternateNames: [mediaInfo.title.romaji, mediaInfo.title.native, mediaInfo.title.english],
    description: mediaInfo.description,
    imageUrl:
      (typeof mediaInfo.coverImage?.extraLarge === "string" && mediaInfo.coverImage.extraLarge) ||
      (typeof mediaInfo.bannerImage === "string" && mediaInfo.bannerImage) ||
      null,
    url: canonical,
    genres: mediaInfo.genres,
    format: mediaInfo.format,
    startDateISO: anilistStartDateIso(mediaInfo.startDate),
    episodes: mediaInfo.episodes,
    year: mediaInfo.seasonYear || mediaInfo.startDate?.year,
  });

  return (
    <main id={styles.container}>
      <JsonLd data={structuredData} />
      {/* BANNER or BACKGROUND COLOR*/}
      <div
        id={styles.banner_background_container}
        style={{ background: bcgImgBasedOnScreenDisplay() }}
      />

      <div
        id={styles.media_info_container}

      >
      <PageHeading
  searchParams={searchParams}
  mediaInfo={{
    ...mediaInfo,
    title: {
      ...mediaInfo.title,
      userPreferred: displayTitle(mediaInfo.title),
    },
  }}
/>

        <section id={styles.info_container}>
          <div id={styles.description_episodes_related_container}>
            {/* NEXT EPISODE */}
            {isOnMobileScreen == true &&
              mediaInfo.nextAiringEpisode &&
              mediaInfo.format != "MOVIE" && (
                <div id={styles.next_episode_container}>
                  <h2 className={styles.heading_style}>NEXT EPISODE</h2>

                  <p>
                    <span>Episode {mediaInfo.nextAiringEpisode.episode}</span>{" "}
                    on{" "}
                    {convertFromUnix(mediaInfo.nextAiringEpisode.airingAt, {
                      month: "long",
                      year: "numeric",
                      hour: undefined,
                      minute: undefined,
                    })}
                  </p>
                </div>
              )}

            {/* DESCRIPTION */}
            <section id={styles.description_container}>
              <h2 className={styles.heading_style}>DESCRIPTION</h2>

              {mediaInfo.description && (
                <span>{parse(mediaInfo.description) || "Not Available"}</span>
              )}
            </section>

            {/* CAST */}
            {mediaInfo.characters.edges[0] && (
              <section id={styles.cast_container}>
                <h2 className={styles.heading_style}>CAST</h2>

                {/* WHEN HOVERING, FLIP IMAGE AND SHOW THE ACTOR */}
                <div>
                  <ul className="display_flex_row">
                    {mediaInfo.characters.edges.map((character, key) => (
                      <li key={key} data-mediatype={mediaInfo.type}>
                        <div className={styles.character_container}>
                          <div className={styles.img_container}>
                            <Image
                              src={character.node.image.large}
                              alt={character.node.name.full}
                              fill
                              sizes="90px"
                            />
                          </div>

                          <h3>{character.node.name.full}</h3>
                        </div>

                        {/* SHOWS ACTOR ONLY FOR ANIMES  */}
                        {mediaInfo.type == "ANIME" &&
                          character.voiceActorRoles[0] && (
                            <div className={styles.actor_container}>
                              <div className={styles.img_container}>
                                <Image
                                  src={
                                    character.voiceActorRoles[0] &&
                                    character.voiceActorRoles[0].voiceActor
                                      .image.large
                                  }
                                  alt={
                                    `${
                                      character.voiceActorRoles[0] &&
                                      character.voiceActorRoles[0].voiceActor
                                        .name.full
                                    } voiceover for ${
                                      character.node.name.full
                                    }` || "No Name Actor"
                                  }
                                  fill
                                  sizes="90px"
                                />
                              </div>

                              <h3>
                                {character.voiceActorRoles[0] &&
                                  character.voiceActorRoles[0].voiceActor.name
                                    .full}
                              </h3>
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {mediaInfo.type == "ANIME" && (
              <section id={styles.episodes_container}>
                <Suspense fallback={<p>Episodes are being prepared. Check back soon.</p>}>
                  <EpisodesSection anilistId={Number(params.id)} format={mediaInfo.format} cover={mediaInfo.coverImage.extraLarge || mediaInfo.coverImage.large} />
                </Suspense>
              </section>
            )}

            {/* CHAPTERS - ONLY FOR MANGAS */}
            {mediaInfo.type == "MANGA" && (
              <section>
                <h2 className={styles.heading_style}>CHAPTERS</h2>

                <MangaChaptersContainer
                  mediaInfo={mediaInfo}
                  chaptersReadOnAnilist={
                    mediaInfo.mediaListEntry?.progress || undefined
                  }
                />
              </section>
            )}

            {/* RELATIONED TO THIS MEDIA */}
            {mediaInfo.relations.nodes[0] && (
              <section id={styles.related_container}>
                <div className="display_flex_row space_beetween align_items_center display_wrap">
                  <h2 className={styles.heading_style}>
                    RELATED TO {displayTitle(mediaInfo.title).toUpperCase()}
                  </h2>
                </div>

                <ul>
                  <MediaRelatedContainer
                    mediaList={mediaInfo.relations.nodes}
                  />
                </ul>
              </section>
            )}

            {/* REVIEWS SECTION */}
            {mediaInfo.reviews?.nodes.length > 0 && (
              <Reviews reviews={mediaInfo.reviews.nodes} />
            )}

            {/* COMMENTS SECTION */}
            <section>
              <h2 className={styles.heading_style}>COMMENTS</h2>

              <CommentsSection
                mediaInfo={{
                  id: mediaInfo.id,
                  title: mediaInfo.title,
                  format: mediaInfo.format,
                }}
              />
            </section>

            {/* RECOMMENDATIONS ACCORDING TO THIS MEDIA */}
            {mediaInfo.recommendations.edges[0] && (
              <section id={styles.similar_container}>
                <h2 className={styles.heading_style}>
                  SIMILAR {mediaInfo.type.toUpperCase()}S YOU MAY LIKE
                </h2>

                <ul>
                  {mediaInfo?.recommendations.edges
                    .slice(0, 12)
                    .map((media, key) => (
                      <li key={key}>
                        <MediaCard.Container positionIndex={key + 1} onDarkMode>
                          <MediaCard.MediaImgLink
                            mediaInfo={media.node.mediaRecommendation}
                            mediaId={media.node.mediaRecommendation?.id}
                            title={displayTitle(
                              media.node.mediaRecommendation?.title
                            )}
                            formatOrType={
                              media.node.mediaRecommendation?.format
                            }
                            url={
                              media.node.mediaRecommendation?.coverImage.large
                            }
                          />

                          <MediaCard.SmallTag
                            seasonYear={
                              media.node.mediaRecommendation?.seasonYear
                            }
                            tags={media.node.mediaRecommendation?.genres[0]}
                          />

                          <MediaCard.LinkTitle
                            title={displayTitle(
                              media.node.mediaRecommendation?.title
                            )}
                            id={media.node.mediaRecommendation?.id}
                          />
                        </MediaCard.Container>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </div>

          <div id={styles.hype_container}>
            {/* NEXT EPISODE */}
            {isOnMobileScreen == false &&
              mediaInfo.nextAiringEpisode &&
              mediaInfo.format != "MOVIE" && (
                <div id={styles.next_episode_container}>
                  <h2 className={styles.heading_style}>NEXT EPISODE</h2>

                  <p>
                    <span>Episode {mediaInfo.nextAiringEpisode.episode}</span>{" "}
                    on{" "}
                    {convertFromUnix(mediaInfo.nextAiringEpisode.airingAt, {
                      month: "long",
                      year: "numeric",
                      hour: undefined,
                      minute: undefined,
                    })}
                  </p>
                </div>
              )}

            {/* SCORE */}
            {mediaInfo.averageScore && (
              <div id={styles.score_container}>
                <h2 className={styles.heading_style}>SCORE</h2>

                <ul>
                  {mediaInfo.averageScore && (
                    <li className="display_flex_row align_items_center">
                      <ScoreRating
                        ratingScore={mediaInfo.averageScore / 2 / 10}
                        source="anilist"
                      />

                      <span style={{ marginLeft: "64px" }}>
                        {`(${mediaInfo.averageScore / 2 / 10}/5)`}
                      </span>
                    </li>
                  )}

                </ul>
              </div>
            )}

            {/* TRAILER */}
            {mediaInfo.trailer && (
              <div id={styles.yt_video_container}>
                <h2 className={styles.heading_style}>TRAILER</h2>
                <iframe
                  className="yt_embed_video"
                  src={`https://www.youtube.com/embed/${mediaInfo.trailer.id}`}
                  frameBorder={0}
                  title={displayTitle(mediaInfo.title) + " Trailer"}
                  allow="accelerometer; autoplay; encrypted-media; gyroscope;"
                  allowFullScreen
                />
              </div>
            )}

            <div id={styles.more_info_container}>
              <h2 className={styles.heading_style}>MORE INFO</h2>

              <ul>
                {mediaInfo.endDate?.year && (
                  <li>
                    <p>
                      Ended in
                      <span>
                        {getMediaReleaseDate(
                          mediaInfo.startDate ? mediaInfo.endDate : undefined
                        )}
                      </span>
                    </p>
                  </li>
                )}

                {mediaInfo.studios?.edges[0]?.node && (
                  <li>
                    <p>
                      Main Studio{" "}
                      <span className={styles.color_brand}>
                        {mediaInfo.studios.edges[0].node.name}
                      </span>
                    </p>
                  </li>
                )}

                {mediaInfo.trending != 0 && (
                  <li>
                    <p>
                      Trending Level{" "}
                      <span className={styles.color_brand}>
                        {mediaInfo.trending}
                      </span>
                    </p>
                  </li>
                )}

                {mediaInfo.favourites && (
                  <li>
                    <p>
                      Favorited by{" "}
                      <span>
                        <span className={styles.color_brand}>
                          {mediaInfo.favourites.toLocaleString("en-US")}
                        </span>{" "}
                        {mediaInfo.favourites == 1 ? "User" : "Users"}
                      </span>
                    </p>
                  </li>
                )}

                {mediaInfo.hashtag && (
                  <li>
                    <p>
                      Hashtag{" "}
                      <span className={styles.color_brand}>
                        {mediaInfo.hashtag.toUpperCase()}
                      </span>
                    </p>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
