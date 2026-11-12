import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import styles from "./page.module.css";
import * as MediaCardExpanded from "@/app/components/MediaCards/MediaInfoExpandedWithCover";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import { getEpisodeSeo } from "@/app/lib/seo/episode-seo";
import { ogImageUrl } from "@/app/lib/seo/og-image";
import { buildWatchJsonLd } from "@/app/lib/seo/jsonld";
import JsonLd from "@/app/lib/seo/JsonLd";
import {
  animeName,
  buildWatchCanonical,
  buildWatchDescription,
  buildWatchTitle,
  parseEpisodeNumber,
} from "@/app/lib/seo/titles";
import { absoluteUrl } from "@/app/lib/seo/text";
import { episodeExistsInDb, watchRobots } from "@/app/lib/seo/watch-indexability";
import { loadCommentSummary } from "@/app/lib/seo/comments-jsonld";
import Link from "next/link";
import Image from "next/image";
import VideoPlayer from "./components/VideoPlayer";
import WatchControls from "./components/WatchControls";
import EpisodesListContainer from "./components/EpisodesListContainer";
import CommentsSection from "@/app/components/CommentsSection";
import WatchLayout from "./components/WatchLayout";
import PlayerToolbar from "./components/PlayerToolbar";
import ExpandableText from "@/app/components/ExpandableText";
import AddToNotificationsButton from "@/app/components/Buttons/AddToNotification";
import * as AddToFavourites from "@/app/components/Buttons/AddToFavourites";
import * as AddToList from "@/app/components/Buttons/AddToList";
import FavouriteSvg from "@/public/assets/heart.svg";
import FavouriteFillSvg from "@/public/assets/heart-fill.svg";
import PlusSvg from "@/public/assets/plus-lg.svg";
import {
  EpisodesIcon,
  ReleaseIcon,
  StatusIcon,
} from "@/app/media/[id]/components/PageHeading/GridInfo/icons";
import { WatchState } from "./components/WatchState";
import { displayTitle } from "@/app/lib/titles";
import { nextEpisodeNumber } from "@/app/lib/episodes/items";
import ClipBridge from "./components/ClipBridge";
import { parseWatchRange } from "@/app/lib/clips/url";

const plain = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ep?: string; episode?: string };
}) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return { title: "Not Found", robots: { index: false, follow: false } };
  }

  const media = await getMediaInfo({ id });
  if (!media) {
    return { title: "Not Found", robots: { index: false, follow: false } };
  }

  const episode = parseEpisodeNumber(searchParams?.ep ?? searchParams?.episode, media.format);
  const seo = await getEpisodeSeo(id, episode);
  const name = animeName(media.title) || `Anime ${id}`;
  const title = buildWatchTitle({
    animeName: name,
    episode,
    episodeTitle: seo.episodeTitle,
    format: media.format,
  });
  const description = buildWatchDescription({
    animeName: name,
    episode,
    episodeTitle: seo.episodeTitle,
    hasSub: seo.hasSub,
    hasDub: seo.hasDub,
    synopsis: seo.synopsis || media.description,
    format: media.format,
  });
  const canonical = buildWatchCanonical(id, episode, media.format);
  const image = { url: ogImageUrl(id, episode), width: 1200, height: 630, alt: title };

  // No episode row in `episodes` -> nothing to play: keep the page working but
  // keep it (and its canonical) out of the index.
  const episodeExists = episodeExistsInDb(seo);

  return {
    title,
    description,
    alternates: episodeExists ? { canonical } : undefined,
    openGraph: {
      type: "video.episode",
      title,
      description,
      ...(episodeExists ? { url: canonical } : {}),
      siteName: "KumoriTV",
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: watchRobots(episodeExists),
  };
}

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    ep?: string;
    episode?: string;
    audio?: string;
    dub?: string;
    t?: string;
    end?: string;
  };
}) {
  const id = Number(params.id);
  const media = await getMediaInfo({ id });
  if (!media) notFound();
  const ep = parseEpisodeNumber(searchParams.ep ?? searchParams.episode, media.format);
  // Prompt 35: `?t=&end=` plays that range only. Bad values are ignored, so a
  // mangled link still opens the episode at the start.
  const watchRange = parseWatchRange(searchParams);
  const audio =
    searchParams.audio || (searchParams.dub === "true" ? "dub" : "sub");
  const lang = cookies().get("subtitle_language")?.value || "English";
  const cover =
    plain(media.coverImage?.extraLarge as unknown) ||
    plain(media.coverImage?.large as unknown) ||
    "";
  // Only the episodes that have actually aired count as "next".
  const airedEpisodes = media.nextAiringEpisode?.episode
    ? media.nextAiringEpisode.episode - 1
    : media.episodes || null;
  const nextEpisode = nextEpisodeNumber({
    episode: ep,
    airedEpisodes,
    format: media.format,
  });

  // One cached lookup feeds the heading, the metadata and the structured data.
  const episodeSeo = media.format === "MOVIE" ? null : await getEpisodeSeo(id, ep);
  const episodeTitle = episodeSeo?.episodeTitle || `Episode ${ep}`;
  const name = animeName(media.title) || `Anime ${id}`;
  const canonical = buildWatchCanonical(id, ep, media.format);

  // VideoObject only when we actually hold the episode: `source: "db"` means the
  // `episodes` row exists, so the page has something to play.
  const playable = episodeExistsInDb(episodeSeo);

  // Best effort: a failing or slow comments query omits comment/commentCount and
  // never blocks the render.
  const commentSummary = playable
    ? await loadCommentSummary({ anilistId: id, episodeNumber: ep })
    : null;

  const jsonLd = buildWatchJsonLd({
    id,
    animeName: name,
    episode: ep,
    episodeTitle: episodeSeo?.episodeTitle ?? null,
    description: episodeSeo?.synopsis || media.description,
    // Always our own /thumb route: it proxies the same source images (the
    // episode image, then the banner, then the cover) and falls back to the OG
    // card, so Googlebot never fetches a third-party host that blocks it.
    thumbnailUrl: absoluteUrl(`/thumb/${id}/${ep}`),
    airedAtISO: episodeSeo?.airedAtISO ?? null,
    rowCreatedAtISO: episodeSeo?.rowCreatedAtISO ?? null,
    durationISO: episodeSeo?.durationISO ?? null,
    url: canonical,
    seriesUrl: absoluteUrl(`/media/${id}`),
    format: media.format,
    playable,
    isFamilyFriendly: media.isAdult !== true,
    comments: commentSummary,
  });

  return (
    <WatchState
      anilistId={id}
      episode={ep}
      initialAudio={audio as "sub" | "dub"}
      initialSubtitleLanguage={lang}
    >
      <JsonLd data={jsonLd} />
      <main id={styles.container}>
        <ClipBridge
          anilistId={id}
          episode={ep}
          audio={audio as "sub" | "dub"}
          animeTitle={displayTitle(media.title) || name}
        >
        <WatchLayout>
          {/* LEFT COLUMN: player, its toolbar, the controls, this episode and
              the series card. On phones everything here is a single column. */}
          <div id={styles.stage}>
            <section className={styles.background}>
              <div id={styles.video_container}>
                <VideoPlayer
                  anilistId={id}
                  episode={ep}
                  audio={audio as "sub" | "dub"}
                  subtitleLanguage={lang}
                  initialTime={watchRange.seek ?? 0}
                  clip={
                    watchRange.range
                      ? {
                          start: watchRange.range.start,
                          end: watchRange.range.end,
                          mode: "watch" as const,
                        }
                      : null
                  }
                  title={displayTitle(media.title) || name}
                  episodeImage={episodeSeo?.thumbnailUrl || undefined}
                  cover={cover || undefined}
                  nextEpisode={nextEpisode}
                />
              </div>
            </section>

            <PlayerToolbar
              anilistId={id}
              episode={ep}
              audio={audio as "sub" | "dub"}
              episodeCount={airedEpisodes}
            />

            <WatchControls
              anilistId={id}
              episode={ep}
              audio={audio as "sub" | "dub"}
              episodeCount={airedEpisodes}
            />

            {/* THIS EPISODE: title, synopsis (clamped), aired + number chips. */}
            <section id={styles.episode_info}>
              <h1 id="episode-heading">
                EP {ep} -{" "}
                {media.format === "MOVIE"
                  ? displayTitle(media.title)
                  : episodeTitle}
              </h1>

              {episodeSeo?.synopsis ? (
                <ExpandableText lines={4} className={styles.synopsis}>
                  {episodeSeo.synopsis}
                </ExpandableText>
              ) : null}

              <div className={styles.chips}>
                <span className={styles.episode_chip}>
                  <EpisodesIcon />
                  {media.format === "MOVIE" ? "Movie" : `Episode ${ep}`}
                </span>

                {episodeSeo?.airedAtISO ? (
                  <span className={styles.episode_chip}>
                    <ReleaseIcon />
                    Aired{" "}
                    {new Date(episodeSeo.airedAtISO).toLocaleDateString("en-GB")}
                  </span>
                ) : null}
              </div>
            </section>

            {/* THE SERIES: a compact horizontal card, same data as before. */}
            <section id={styles.anime_card}>
              {cover ? (
                <Link
                  href={`/media/${id}`}
                  className={styles.poster}
                  aria-label={`${displayTitle(media.title)} details`}
                >
                  <Image
                    src={cover}
                    alt={`Cover Art for ${displayTitle(media.title)}`}
                    fill
                    sizes="(max-width: 1279px) 96px, 120px"
                  />
                </Link>
              ) : null}

              <div className={styles.card_body}>
                <h2 className={styles.card_title}>
                  <Link href={`/media/${id}`}>{displayTitle(media.title)}</Link>
                </h2>

                {media.title?.native ? (
                  <p className={styles.card_native}>{media.title.native}</p>
                ) : null}

                <div className={styles.card_chips}>
                  {media.format ? (
                    <span>{media.format === "TV" ? "Anime" : media.format}</span>
                  ) : null}
                  {media.seasonYear ? (
                    <span>
                      <ReleaseIcon />
                      {media.seasonYear}
                    </span>
                  ) : null}
                  {media.format !== "MOVIE" &&
                  (media.episodes || airedEpisodes) ? (
                    <span>
                      <EpisodesIcon />
                      {media.episodes || airedEpisodes} eps
                    </span>
                  ) : null}
                  {media.status ? (
                    <span>
                      <StatusIcon />
                      {media.status === "RELEASING"
                        ? "Airing"
                        : media.status === "FINISHED"
                          ? "Complete"
                          : media.status === "NOT_YET_RELEASED"
                            ? "Upcoming"
                            : "Hiatus"}
                    </span>
                  ) : null}
                </div>

                <ExpandableText lines={3} className={styles.card_description}>
                  <MediaCardExpanded.Description
                    description={media.description}
                  />
                </ExpandableText>

                <div className={styles.card_actions}>
                  <Link href={`/media/${id}`} className={styles.details_link}>
                    Details
                  </Link>

                  <div className={styles.round_actions}>
                    <AddToNotificationsButton mediaInfo={media as any} variant="round" />

                    <AddToList.Button
                      statusOnAnilist={media.mediaListEntry?.status}
                      listEntryId={media.mediaListEntry?.id}
                      mediaInfo={media as any}
                      amountWatchedOrRead={media.mediaListEntry?.progress}
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
                      isActiveOnAnilist={media.isFavourite}
                      mediaInfo={media as any}
                      variant="round"
                    >
                      <AddToFavourites.SvgIcon>
                        <FavouriteSvg
                          fill="var(--white-100)"
                          viewBox="0 0 16 16"
                        />
                      </AddToFavourites.SvgIcon>

                      <AddToFavourites.SvgIcon>
                        <FavouriteFillSvg
                          fill="var(--brand-color)"
                          viewBox="0 0 16 16"
                        />
                      </AddToFavourites.SvgIcon>
                    </AddToFavourites.Button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN (desktop): the episodes panel, sticky. */}
          <aside id={styles.sidebar} aria-label="Episodes">
            <EpisodesListContainer
              mediaId={id}
              activeEpisodeNumber={ep}
              audio={audio as "sub" | "dub"}
              nextAiringEpisodeInfo={media.nextAiringEpisode || undefined}
            />
          </aside>

          {/* COMMENTS FOR THIS EPISODE (keyed by episode so ?ep= reloads them) */}
          <div id={styles.comments_zone}>
            <CommentsSection
              key={`comments-${ep}`}
              mediaInfo={{
                id: media.id,
                title: media.title,
                format: media.format,
              }}
              isOnWatchPage
              episodeNumber={ep}
            />
          </div>
        </WatchLayout>
        </ClipBridge>
      </main>
    </WatchState>
  );
}
