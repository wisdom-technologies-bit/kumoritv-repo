"use client";
import React, { useEffect, useState } from "react";
import styles from "./carouselComponent.module.css";
import Link from "next/link";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import { wrap } from "popmotion";
import { AnimatePresence, motion } from "framer-motion";
import * as AddToFavourites from "../../Buttons/AddToFavourites";
import SwiperCarouselContainer from "../../SwiperCarouselContainer";
import ListItemHeroCarousel from "./components/HeroListCarousel";
import EyeSvg from "@/public/assets/eye-fill.svg";
import EyeSlashSvg from "@/public/assets/eye-slash-fill.svg";
import { convertFromUnix } from "@/app/lib/formatDateUnix";
import { SwiperSlide } from "swiper/react";
import { displayTitle } from "@/app/lib/titles";
import Image from "next/image";
import {
  YOUTUBE_IFRAME_ALLOW,
  YOUTUBE_REFERRER_POLICY,
  autoplayAllowed,
  browserOrigin,
  buildYoutubeEmbedSrc,
  isYoutubeTrailer,
  readPlaybackEnvironment,
  youtubeTrailerId,
} from "@/app/lib/youtube";
import { useYoutubeTrailerGuard } from "../../Trailer/useYoutubeTrailerGuard";

const framerMotionVariants = {
  enter: (direction: number) => {
    return {
      x: direction > 0 ? 1000 : -1000,
      opacity: 0,
    };
  },
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => {
    return {
      zIndex: 0,
      x: direction < 0 ? 1000 : -1000,
      opacity: 0,
    };
  },
};

/** The stored TMDB wordmark for a title, keyed by AniList id. */
export type HeroTitleLogos = Record<
  number,
  { url: string; aspectRatio: number; width: number }
>;

function HeroCarousel({
  animesList,
  isOnMobileScreen,
  titleLogos,
}: {
  animesList: MediaData[];
  isOnMobileScreen: boolean;
  titleLogos?: HeroTitleLogos;
}) {
  const [[page, direction], setPage] = useState([0, 0]);

  const [autoPlayTrailer, setAutoPlayTrailer] = useState<boolean>(true);

  // localStorage is only readable after mount. Until it has been read we do not
  // know whether this visitor turned trailers off, so the iframe is not
  // rendered at all (that is what used to make a "false" setting flash).
  const [trailerPreferenceKnown, setTrailerPreferenceKnown] = useState(false);

  // Origin for the embed URL, plus the reduced-motion / data-saver policy.
  // Both are browser-only, so they land in the same post-mount effect.
  const [trailerEmbedOrigin, setTrailerEmbedOrigin] = useState("");
  const [trailerPlaybackAllowed, setTrailerPlaybackAllowed] = useState(false);

  // A logo that fails to load falls back to the text title (one failed id, so
  // the next slide still tries its own logo).
  const [failedLogoId, setFailedLogoId] = useState<number | null>(null);

  useEffect(() => {
    const storedPreference = localStorage.getItem("autoPlayTrailer");

    if (storedPreference == undefined) {
      localStorage.setItem("autoPlayTrailer", "true");
      setAutoPlayTrailer(true);
    } else {
      setAutoPlayTrailer(storedPreference == "true");
    }

    setTrailerPreferenceKnown(true);

    setTrailerEmbedOrigin(browserOrigin());
    setTrailerPlaybackAllowed(autoplayAllowed(readPlaybackEnvironment()));
  }, []);

  // Slide Carousel Props
  const swipeConfidenceThreshold = 10000;
  const swipePower = (offset: number, velocity: number) => {
    return Math.abs(offset) * velocity;
  };

  const currMediaOnScreenIndex = wrap(0, animesList.length, page);

  const paginate = (newDirection: number) => {
    setPage([page + newDirection, newDirection]);
  };

  // Only a real YouTube trailer may be embedded: AniList also returns
  // `dailymotion` trailers and sometimes a stale id, and the YouTube player
  // shows a configuration error for those.
  const currentTrailer = animesList[currMediaOnScreenIndex]?.trailer;
  const currentTrailerId = youtubeTrailerId(
    isYoutubeTrailer(currentTrailer) ? currentTrailer : null
  );

  const {
    failed: trailerEmbedFailed,
    frameRef: trailerFrameRef,
    onFrameLoad: onTrailerFrameLoad,
  } = useYoutubeTrailerGuard(currentTrailerId);

  const shouldShowTrailer =
    trailerPreferenceKnown &&
    autoPlayTrailer &&
    trailerPlaybackAllowed &&
    !!trailerEmbedOrigin &&
    !!currentTrailerId &&
    !trailerEmbedFailed;

  const currentId = Number(animesList[currMediaOnScreenIndex]?.id);
  const currentTitleLogo =
    titleLogos && Number.isInteger(currentId) && failedLogoId !== currentId
      ? titleLogos[currentId]
      : undefined;

  const backgroundImageStyle = {
    background: isOnMobileScreen
      ? `linear-gradient(rgba(0, 0, 0, 0.05), var(--background) 100%), url(${animesList[currMediaOnScreenIndex]?.coverImage.extraLarge})`
      : `linear-gradient(rgba(0, 0, 0, 0.00), var(--background) 100%), url(${animesList[currMediaOnScreenIndex]?.bannerImage})`,
    backgroundPosition: isOnMobileScreen ? "top" : "center",
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
  };

  // change auto play trailer state
  function changeAutoPlayTrailerState() {
    localStorage.setItem("autoPlayTrailer", `${!autoPlayTrailer}`);
    setAutoPlayTrailer(!autoPlayTrailer);
  }

  function handleBcgImgTransition(e: { target: { outerText: string } }) {
    setPage([
      animesList.findIndex(
        (item) => displayTitle(item.title) == e.target.outerText
      ),
      animesList.findIndex(
        (item) => displayTitle(item.title) == e.target.outerText
      ),
    ]);
  }

  return (
    <section id={styles.hero_section_container}>
      {/* CAROUSEL OF BCG IMG AND MEDIA TITLE*/}
      {animesList != undefined && (
        <AnimatePresence initial={true} custom={direction} mode="sync">
          <ul
            id="carousel"
            className={`${styles.carousel_container} display_flex_row`}
          >
            <motion.li
              key={page}
              className={styles.carousel_item}
              style={backgroundImageStyle}
              custom={direction}
              variants={framerMotionVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: "spring", stiffness: 300, damping: 30 },
                opacity: { duration: 0.2 },
              }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={1}
              onDragEnd={(e, { offset, velocity }) => {
                const swipe = swipePower(offset.x, velocity.x);

                if (swipe < -swipeConfidenceThreshold) {
                  paginate(1);
                } else if (swipe > swipeConfidenceThreshold) {
                  paginate(-1);
                }
              }}
            >
              {shouldShowTrailer && currentTrailerId && (
                <AnimatePresence>
                  <motion.div className={styles.video_container}>
                    <motion.iframe
                      /* One frame per video: a new slide never reuses the
                         previous trailer's player. */
                      key={currentTrailerId}
                      ref={trailerFrameRef}
                      onLoad={onTrailerFrameLoad}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 3 }}
                      src={buildYoutubeEmbedSrc(currentTrailerId, {
                        autoplay: true,
                        loop: true,
                        controls: false,
                        origin: trailerEmbedOrigin,
                      })}
                      frameBorder={0}
                      /* Cross-origin muted autoplay needs the permission
                         granted on the frame, not only `mute=1`. */
                      allow={YOUTUBE_IFRAME_ALLOW}
                      referrerPolicy={YOUTUBE_REFERRER_POLICY}
                      title={
                        displayTitle(
                          animesList[currMediaOnScreenIndex].title
                        ) + " Trailer"
                      }
                    />
                  </motion.div>
                </AnimatePresence>
              )}

              <div className={styles.carousel_position_wrapper}>
                <div className={styles.item_info}>
                  <h2>
                    <Link
                      href={`/media/${animesList[currMediaOnScreenIndex]?.id}`}
                    >
                      {currentTitleLogo ? (
                        <>
                          {/* The artwork replaces the text visually; the real
                              title stays in the DOM for the heading, the link
                              text, SEO and screen readers. */}
                          <Image
                            className={styles.title_logo}
                            /* A very wide wordmark (aspect > 3.5, e.g. a long
                               series name) is capped shorter on phones. The
                               attribute is inert on desktop. */
                            data-wide-logo={
                              currentTitleLogo.aspectRatio > 3.5
                                ? "true"
                                : undefined
                            }
                            src={currentTitleLogo.url}
                            alt={displayTitle(
                              animesList[currMediaOnScreenIndex]?.title
                            )}
                            unoptimized
                            width={720}
                            height={Math.max(
                              1,
                              Math.round(720 / currentTitleLogo.aspectRatio)
                            )}
                            /* Reserve the box before the image loads so the
                               meta line never jumps when the logo arrives. */
                            style={{
                              aspectRatio: currentTitleLogo.aspectRatio
                                ? String(currentTitleLogo.aspectRatio)
                                : undefined,
                            }}
                            onError={() =>
                              setFailedLogoId(
                                Number(animesList[currMediaOnScreenIndex]?.id)
                              )
                            }
                          />
                          <span className={styles.title_text_hidden}>
                            {displayTitle(
                              animesList[currMediaOnScreenIndex]?.title
                            )}
                          </span>
                        </>
                      ) : (
                        displayTitle(animesList[currMediaOnScreenIndex]?.title)
                      )}
                    </Link>
                  </h2>

                  <div
                    className={`${styles.item_info_inside} display_flex_row`}
                  >
                    {animesList[currMediaOnScreenIndex]?.seasonYear && (
                      <p>
                        {animesList[
                          currMediaOnScreenIndex
                        ].seasonYear.toString()}
                      </p>
                    )}
                    {animesList[currMediaOnScreenIndex]?.genres &&
                      animesList[currMediaOnScreenIndex]?.seasonYear !=
                        undefined && <span>|</span>}

                    {animesList[currMediaOnScreenIndex]?.genres && (
                      <p>
                        <Link
                          href={`/search?genre=[${animesList[currMediaOnScreenIndex]?.genres[0]?.toLowerCase()}]`}
                        >
                          {animesList[currMediaOnScreenIndex]?.genres[0] || "Unknown"}
                        </Link>
                      </p>
                    )}
                    {animesList[currMediaOnScreenIndex]?.seasonYear !=
                      undefined &&
                      animesList[currMediaOnScreenIndex]?.episodes !=
                        undefined &&
                      animesList[currMediaOnScreenIndex]?.nextAiringEpisode ==
                        null && <span>|</span>}

                    {animesList[currMediaOnScreenIndex]?.episodes &&
                      animesList[currMediaOnScreenIndex].format != "MOVIE" &&
                      animesList[currMediaOnScreenIndex]?.nextAiringEpisode ==
                        null && (
                      <p>
                        {animesList[
                          currMediaOnScreenIndex
                        ].episodes.toString()}{" "}
                        {animesList[currMediaOnScreenIndex].episodes > 1
                          ? "Episodes"
                          : "Episode"}
                      </p>
                    )}
                    {animesList[currMediaOnScreenIndex]?.duration &&
                      animesList[currMediaOnScreenIndex].format == "MOVIE" && (
                      <p>
                        {animesList[currMediaOnScreenIndex].duration} Minutes
                      </p>
                    )}
                    {animesList[currMediaOnScreenIndex]?.nextAiringEpisode && (
                      <span>|</span>
                    )}

                    {animesList[currMediaOnScreenIndex]?.nextAiringEpisode && (
                      <p>
                        Ep{" "}
                        {
                          animesList[currMediaOnScreenIndex]?.nextAiringEpisode
                            .episode
                        }{" "}
                        on{" "}
                        {convertFromUnix(
                          animesList[currMediaOnScreenIndex]?.nextAiringEpisode
                            .airingAt,
                          { month: "long", year: undefined }
                        )}
                      </p>
                    )}
                  </div>

                  <div className={styles.item_buttons}>
                    <Link
                      href={`/media/${animesList[currMediaOnScreenIndex]?.id}`}
                    >
                      {animesList[currMediaOnScreenIndex].format == "MANGA"
                        ? "READ"
                        : "WATCH"}{" "}
                      NOW
                    </Link>

                    <AddToFavourites.Button
                      mediaInfo={animesList[currMediaOnScreenIndex]}
                    />
                  </div>
                </div>
              </div>
            </motion.li>
          </ul>
        </AnimatePresence>
      )}

      {/* RECOMENDATIONS GRID */}
      <div id={styles.recomendations_position_wrapper}>
        <div id={styles.recomendations_container}>
          <h3>Todays Recomendation</h3>

          {/* SHOWS ONLY ON MOBILE */}
          <div id={styles.swiper_list_container}>
            {animesList != undefined && (
              <SwiperCarouselContainer
                options={{
                  slidesPerView: 2,
                  bp480: 2,
                  bp740: 3,
                  bp1275: 3,
                }}
              >
                {animesList.slice(0, 9).map((item, key) => (
                  <SwiperSlide
                    key={key}
                    className="custom_swiper_list_item"
                    role="listitem"
                  >
                    <ListItemHeroCarousel
                      animeInfo={item as MediaData}
                      handleFunction={handleBcgImgTransition as () => void}
                    />
                  </SwiperSlide>
                ))}
              </SwiperCarouselContainer>
            )}
          </div>

          {/* SHOWS ONLY ON DESKTOP */}
          <ul>
            {animesList != undefined &&
              animesList
                .slice(0, 9)
                .map(
                  (media, key: number) =>
                    media.bannerImage && (
                      <ListItemHeroCarousel
                        animeInfo={media}
                        handleFunction={() => setPage([key, key])}
                        key={key}
                      />
                    )
                )}
          </ul>
        </div>
      </div>

      {/* STOP/PLAY TRAILER BUTTON */}
      <div id={styles.stop_trailer_btn_container}>
        <motion.button
          onClick={() => changeAutoPlayTrailerState()}
          whileTap={{ scale: 0.9 }}
        >
          {autoPlayTrailer ? (
            <>
              <EyeSlashSvg width={16} height={16} /> Stop Auto Play Trailer
            </>
          ) : (
            <>
              <EyeSvg width={16} height={16} /> Auto Play Trailer
            </>
          )}
        </motion.button>
      </div>
    </section>
  );
}

export default HeroCarousel;
