// Prompt 35: /clip/[code]
//
// A clip is a POINTER to a time range, never a video file. This page server-
// renders the metadata (noindex: a thin clip page should not pollute search)
// and plays only that range with the normal watch player.

import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import styles from "./page.module.css";
import ClipPlayer from "./components/ClipPlayer";
import ReportClip from "./components/ReportClip";
import { getAnimeSummary, getClipByCode, toPublicClip, type AnimeSummary } from "@/app/lib/clips/server";
import { isClipCode } from "@/app/lib/clips/code";
import { formatRange, formatTime } from "@/app/lib/clips/time";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import { getEpisodeSeo } from "@/app/lib/seo/episode-seo";
import { ogImageUrl } from "@/app/lib/seo/og-image";
import { animeName } from "@/app/lib/seo/titles";
import { absoluteUrl } from "@/app/lib/seo/text";
import { readShowAdultContent } from "@/app/lib/anilist/adult-content";
import { displayTitle } from "@/app/lib/titles";

type Params = { params: { code: string } };

const plain = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Clip pages read the anime from our own `anime` row (cheap, works when AniList
 * is slow) and fall back to AniList only when the row is missing.
 */
async function readAnime(anilistId: number): Promise<AnimeSummary | null> {
  const stored = await getAnimeSummary(anilistId);
  if (stored) return stored;
  try {
    const media = await getMediaInfo({ id: anilistId });
    if (!media) return null;
    return {
      anilistId,
      title: animeName(media.title) || null,
      cover: plain(media.coverImage?.extraLarge) || plain(media.coverImage?.large) || null,
      banner: plain(media.bannerImage) || null,
      isAdult: media.isAdult === true,
    };
  } catch {
    return null;
  }
}

async function loadClip(code: string) {
  if (!isClipCode(code)) return null;
  const row = await getClipByCode(code);
  if (!row) return null;
  const clip = toPublicClip(row);
  const anime = await readAnime(clip.anilistId);
  return { clip, anime };
}

export async function generateMetadata({ params }: Params) {
  const loaded = await loadClip(params.code);
  if (!loaded) {
    return { title: "Clip not found", robots: { index: false, follow: false } };
  }

  const { clip, anime } = loaded;
  const name = (anime?.title || "").trim() || `Anime ${clip.anilistId}`;
  const range = formatRange(clip.start, clip.end);
  const title = `${name} - Episode ${clip.episode} clip (${range})`;
  const description = `Watch ${range} of ${name} episode ${clip.episode} on KumoriTV. A clip is a link to a moment of the episode, not a download.`;
  const canonical = absoluteUrl(`/clip/${clip.code}`);

  // Adult titles follow the existing adult-content setting. When it is off the
  // page is INVISIBLE, so it must not ship an image either.
  const adultHidden = anime?.isAdult === true && !(await readShowAdultContent());
  const image = {
    url: ogImageUrl(clip.anilistId, clip.episode),
    width: 1200,
    height: 630,
    alt: title,
  };

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "video.other",
      title,
      description,
      url: canonical,
      siteName: "KumoriTV",
      ...(adultHidden ? {} : { images: [image] }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(adultHidden ? {} : { images: [image] }),
    },
    // Thin, viewer-created pages stay out of the index but their links are
    // still followed (the episode page behind them is the real destination).
    robots: { index: false, follow: true },
  };
}

export default async function ClipPage({ params }: Params) {
  const loaded = await loadClip(params.code);
  if (!loaded) notFound();

  const { clip, anime } = loaded;
  const name = (anime?.title || "").trim() || `Anime ${clip.anilistId}`;
  // Prompt 35 pins this target: the full episode, no extra params. Audio
  // continuity is the watch page's own concern (saved preferences), so a clip
  // link never carries it.
  const episodePage = `/watch/${clip.anilistId}?ep=${clip.episode}`;
  const adultHidden = anime?.isAdult === true && !(await readShowAdultContent());

  if (adultHidden) {
    return (
      <main id={styles.container}>
        <section className={styles.gate} data-testid="clip-adult-gate">
          <h1>This clip is from adult content</h1>
          <p>
            Adult titles are hidden by your current setting. Turn on adult content in
            settings to view clips from them.
          </p>
          <div className={styles.gate_actions}>
            <Link href="/">Go home</Link>
            <Link href={`/media/${clip.anilistId}`}>About this anime</Link>
          </div>
        </section>
      </main>
    );
  }

  const lang = cookies().get("subtitle_language")?.value || "English";
  const episodeSeo = await getEpisodeSeo(clip.anilistId, clip.episode);
  const created = new Date(clip.createdAt ?? "");
  const createdLabel = Number.isNaN(created.getTime())
    ? null
    : created.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <main id={styles.container}>
      <div id={styles.video_area}>
        <ClipPlayer
          code={clip.code}
          anilistId={clip.anilistId}
          episode={clip.episode}
          start={clip.start}
          end={clip.end}
          audio={clip.audio ?? "sub"}
          subtitleLanguage={lang}
          title={`${name} - Episode ${clip.episode}`}
          episodeImage={episodeSeo?.thumbnailUrl || undefined}
          cover={anime?.cover || undefined}
          fullEpisodeHref={episodePage}
          animeTitle={name}
        />
      </div>

      <section id={styles.info}>
        <div id={styles.heading}>
          {anime?.cover ? (
            <Link href={`/media/${clip.anilistId}`} className={styles.poster} aria-label={`${name} details`}>
              <Image src={anime.cover} alt={`Cover art for ${name}`} fill sizes="72px" />
            </Link>
          ) : null}

          <div className={styles.heading_text}>
            <p className={styles.kicker}>Clip</p>
            <h1>
              <Link href={`/media/${clip.anilistId}`}>{name}</Link>
            </h1>
            <p className={styles.episode}>Episode {clip.episode}</p>
          </div>
        </div>

        {clip.title ? (
          <p className={styles.clip_title} data-testid="clip-title">
            {clip.title}
          </p>
        ) : null}

        <div className={styles.meta}>
          <span className={styles.chip} data-testid="clip-range">
            {formatTime(clip.start)}-{formatTime(clip.end)}
          </span>
          <span className={styles.chip}>
            {Math.round((clip.end - clip.start) * 10) / 10}s
          </span>
          <span className={styles.chip} data-testid="clip-views">
            {clip.views} {clip.views === 1 ? "view" : "views"}
          </span>
          {createdLabel ? <span className={styles.chip}>Made {createdLabel}</span> : null}
        </div>

        <p className={styles.note}>
          A clip is a link to a time range of the episode. Nothing is downloaded or
          re-hosted, and playback uses the normal stream.
        </p>

        {/* Prompt 36: primary on its own line, then "Anime details" and
            "Report clip" sharing one row - never three stacked pills. */}
        <div className={styles.actions}>
          <Link className={styles.primary} href={episodePage} data-testid="clip-watch-full">
            Watch the full episode
          </Link>
          <Link className={styles.secondary} href={`/media/${clip.anilistId}`}>
            Anime details
          </Link>
          <ReportClip code={clip.code} variant="text" />
        </div>
      </section>
    </main>
  );
}
