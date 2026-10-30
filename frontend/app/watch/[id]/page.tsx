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
import VideoPlayer from "./components/VideoPlayer";
import WatchControls from "./components/WatchControls";
import EpisodesListContainer from "./components/EpisodesListContainer";
import CommentsSection from "@/app/components/CommentsSection";
import { WatchState } from "./components/WatchState";
import { displayTitle } from "@/app/lib/titles";
import { nextEpisodeNumber } from "@/app/lib/episodes/items";

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

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "video.episode",
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
  };
}) {
  const id = Number(params.id);
  const media = await getMediaInfo({ id });
  if (!media) notFound();
  const ep = parseEpisodeNumber(searchParams.ep ?? searchParams.episode, media.format);
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
  const jsonLd = buildWatchJsonLd({
    id,
    animeName: name,
    episode: ep,
    episodeTitle: episodeSeo?.episodeTitle ?? null,
    description: episodeSeo?.synopsis || media.description,
    imageUrl: ogImageUrl(id, ep),
    thumbnailUrl:
      episodeSeo?.thumbnailUrl ||
      plain(media.bannerImage) ||
      plain(media.coverImage?.extraLarge as unknown) ||
      null,
    airedAtISO: episodeSeo?.airedAtISO ?? null,
    durationISO: episodeSeo?.durationISO ?? null,
    url: canonical,
    seriesUrl: absoluteUrl(`/media/${id}`),
    format: media.format,
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
        <section className={styles.background}>
          <div id={styles.video_container}>
            <VideoPlayer
              anilistId={id}
              episode={ep}
              audio={audio as "sub" | "dub"}
              subtitleLanguage={lang}
              initialTime={Number(searchParams.t || 0)}
              title={displayTitle(media.title) || name}
              episodeImage={episodeSeo?.thumbnailUrl || undefined}
              cover={cover || undefined}
              nextEpisode={nextEpisode}
            />
          </div>
        </section>
        <WatchControls
          anilistId={id}
          episode={ep}
          audio={audio as "sub" | "dub"}
          episodeCount={airedEpisodes}
        />

        {/* The current episode's own synopsis, under the player. */}
        {episodeSeo && (episodeSeo.episodeTitle || episodeSeo.synopsis) && (
          <section className={styles.episode_panel}>
            <h2>{episodeSeo.episodeTitle || `Episode ${ep}`}</h2>
            {episodeSeo.synopsis ? <p>{episodeSeo.synopsis}</p> : null}
            {episodeSeo.airedAtISO ? (
              <small>
                Aired {new Date(episodeSeo.airedAtISO).toLocaleDateString("en-GB")}
              </small>
            ) : null}
          </section>
        )}
        <section id={styles.media_info_container}>
          <div id={styles.heading_info_container}>
            <h1>
              EP {ep} -{" "}
              {media.format === "MOVIE"
                ? displayTitle(media.title)
                : episodeTitle}
            </h1>
            <MediaCardExpanded.Container mediaInfo={media as any}>
              <MediaCardExpanded.Description description={media.description} />
            </MediaCardExpanded.Container>
          </div>
          <EpisodesListContainer
            mediaId={id}
            activeEpisodeNumber={ep}
            audio={audio as "sub" | "dub"}
            nextAiringEpisodeInfo={media.nextAiringEpisode || undefined}
          />
          {/* COMMENTS FOR THIS EPISODE (keyed by episode so ?ep= reloads them) */}
          <CommentsSection
            key={`comments-${ep}`}
            mediaInfo={{ id: media.id, title: media.title, format: media.format }}
            isOnWatchPage
            episodeNumber={ep}
          />
        </section>
      </main>
    </WatchState>
  );
}
