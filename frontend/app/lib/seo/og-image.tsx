// Social card renderer shared by /og/[id] and /og/[id]/[ep].
//
// The route never 404s and never 500s: any failure (bad params, upstream image
// timeout, encoder problem) degrades to a brand card that is still a valid PNG.

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { classifyImage } from "@/app/lib/proxy/sniff";
import type { EpisodeSeo } from "./episode-seo";
import { animeName, parseEpisodeNumber } from "./titles";
import { absoluteUrl, isGenericEpisodeTitle, truncate } from "./text";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const BRAND_BACKGROUND = "#0B0B14";
export const BRAND_ACCENT = "#FF5FA2";
export const BRAND_MUTED = "#B9B4D6";

/** Real data: cache hard. */
export const OG_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
/** Fallback art: let real data replace it soon. */
export const OG_FALLBACK_CACHE_CONTROL =
  "public, max-age=300, s-maxage=300, stale-while-revalidate=600";

export const OG_IMAGE_TIMEOUT_MS = 3000;

/** 8x8 brand-coloured PNG, used only if the encoder itself fails. */
export const OG_LAST_RESORT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGPg5hb5jw8zjAwFAO+TSkHmnF6wAAAAAElFTkSuQmCC";

type MediaLike = {
  title?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
  bannerImage?: unknown;
  coverImage?: { extraLarge?: unknown; large?: unknown } | null;
  format?: string | null;
  seasonYear?: number | null;
};

export type OgDeps = {
  episodeSeo: (anilistId: number, episode: number) => Promise<EpisodeSeo>;
  media: (anilistId: number) => Promise<MediaLike | null>;
  imageDataUri: (url: string) => Promise<string | null>;
  wordmarkDataUri: () => Promise<string | null>;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

let wordmarkCache: string | null | undefined;

async function readWordmark(): Promise<string | null> {
  if (wordmarkCache !== undefined) return wordmarkCache;
  try {
    const file = await readFile(path.join(process.cwd(), "public", "kumoritv-wordmark-dark.svg"));
    wordmarkCache = `data:image/svg+xml;base64,${file.toString("base64")}`;
  } catch {
    wordmarkCache = null;
  }
  return wordmarkCache;
}

async function fetchImageDataUri(url: string): Promise<string | null> {
  const target = text(url);
  if (!target) return null;
  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(OG_IMAGE_TIMEOUT_MS),
      cache: "no-store",
      headers: { accept: "image/*" },
    });
    if (!response.ok) return null;
    const declared = (response.headers.get("content-type") || "").toLowerCase();
    if (declared && !declared.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sniffed = classifyImage(bytes);
    if (sniffed !== "image/png" && sniffed !== "image/jpeg" && sniffed !== "image/webp") return null;
    return `data:${sniffed};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export function defaultOgDeps(): OgDeps {
  return {
    async episodeSeo(anilistId, episode) {
      const { getEpisodeSeo } = await import("./episode-seo");
      return getEpisodeSeo(anilistId, episode);
    },
    async media(anilistId) {
      const { getMediaInfo } = await import("@/app/lib/anilist/medias.server");
      return (await getMediaInfo({ id: anilistId })) as MediaLike | null;
    },
    imageDataUri: fetchImageDataUri,
    wordmarkDataUri: readWordmark,
  };
}

function Wordmark({ dataUri, showText }: { dataUri: string | null; showText: boolean }) {
  if (dataUri) {
    return <img src={dataUri} width={248} height={60} alt="" />;
  }
  if (!showText) return null;
  return (
    <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#FFFFFF", letterSpacing: 1 }}>
      Kumori<span style={{ color: BRAND_ACCENT }}>TV</span>
    </div>
  );
}

function Card({
  title,
  subtitle,
  imageUri,
  wordmark,
}: {
  title: string;
  subtitle: string;
  imageUri: string | null;
  wordmark: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: BRAND_BACKGROUND,
      }}
    >
      {imageUri ? (
        <img
          src={imageUri}
          width={OG_WIDTH}
          height={OG_HEIGHT}
          alt=""
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          display: "flex",
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(180deg, rgba(11,11,20,0.25) 0%, rgba(11,11,20,0.72) 58%, rgba(11,11,20,0.97) 100%)",
        }}
      />
      <div style={{ position: "absolute", top: 56, left: 64, display: "flex" }}>
        <Wordmark dataUri={wordmark} showText />
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 56,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", fontSize: 62, fontWeight: 700, color: "#FFFFFF", lineHeight: 1.1 }}>
          {truncate(title, 52)}
        </div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 30, color: BRAND_MUTED }}>
          {truncate(subtitle, 64)}
        </div>
      </div>
    </div>
  );
}

async function toPngResponse(element: React.ReactElement, cacheControl: string): Promise<Response> {
  const image = new ImageResponse(element, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    headers: { "cache-control": cacheControl },
  });
  const png = Buffer.from(await image.arrayBuffer());
  return new Response(png, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      "cache-control": cacheControl,
    },
  });
}

async function lastResortResponse(cacheControl: string): Promise<Response> {
  const png = Buffer.from(OG_LAST_RESORT_PNG, "base64");
  return new Response(png, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      "cache-control": cacheControl,
    },
  });
}

const isMovie = (format: unknown) =>
  typeof format === "string" && format.toUpperCase() === "MOVIE";

/**
 * Builds the social image. `episode` is null for the series-level card.
 * Returns a PNG Response for every input.
 */
export async function ogImageResponse(
  input: { id: string | number; episode?: string | number | null },
  deps: Partial<OgDeps> = {},
): Promise<Response> {
  const resolved: OgDeps = { ...defaultOgDeps(), ...deps };
  const rawEpisode = input.episode;
  const hasEpisode = rawEpisode !== null && rawEpisode !== undefined && String(rawEpisode).trim() !== "";
  const id = Number(input.id);
  const validId = Number.isInteger(id) && id > 0;

  let wordmark: string | null = null;
  try {
    wordmark = await resolved.wordmarkDataUri();
  } catch {
    wordmark = null;
  }

  if (!validId) {
    try {
      return await toPngResponse(
        <Card title="KumoriTV" subtitle="Watch anime online" imageUri={null} wordmark={wordmark} />,
        OG_CACHE_CONTROL,
      );
    } catch {
      return lastResortResponse(OG_CACHE_CONTROL);
    }
  }

  let title = "KumoriTV";
  let subtitle = "Watch anime online";
  let thumbnail: string | null = null;
  let usedFallbackThumbnail = false;

  try {
    if (hasEpisode) {
      const episode = parseEpisodeNumber(rawEpisode);
      let media: MediaLike | null = null;
      try {
        media = await resolved.media(id);
      } catch {
        media = null;
      }
      let seo: EpisodeSeo | null = null;
      try {
        seo = await resolved.episodeSeo(id, episode);
      } catch {
        seo = null;
      }
      title = animeName(media?.title) || "KumoriTV";
      const episodeTitle = seo && !isGenericEpisodeTitle(seo.episodeTitle) ? seo.episodeTitle : "";
      subtitle = episodeTitle ? `Episode ${episode} · ${episodeTitle}` : `Episode ${episode}`;
      thumbnail = seo?.thumbnailUrl || null;
    } else {
      let media: MediaLike | null = null;
      try {
        media = await resolved.media(id);
      } catch {
        media = null;
      }
      title = animeName(media?.title) || "KumoriTV";
      const descriptors = [isMovie(media?.format) ? "Movie" : text(media?.format), text(media?.seasonYear)]
        .filter(Boolean)
        .map((value) => (typeof value === "number" ? String(value) : value));
      subtitle = descriptors.length ? descriptors.join(" · ") : "Watch anime online";
      thumbnail =
        text(media?.bannerImage) ||
        text(media?.coverImage?.extraLarge) ||
        text(media?.coverImage?.large) ||
        null;
    }
  } catch {
    usedFallbackThumbnail = true;
  }

  let imageUri: string | null = null;
  if (thumbnail) {
    try {
      imageUri = await resolved.imageDataUri(thumbnail);
    } catch {
      imageUri = null;
    }
    if (!imageUri) usedFallbackThumbnail = true;
  } else {
    usedFallbackThumbnail = true;
  }

  const cacheControl = usedFallbackThumbnail ? OG_FALLBACK_CACHE_CONTROL : OG_CACHE_CONTROL;

  try {
    return await toPngResponse(
      <Card title={title} subtitle={subtitle} imageUri={imageUri} wordmark={wordmark} />,
      cacheControl,
    );
  } catch {
    try {
      return await toPngResponse(
        <Card title={title} subtitle={subtitle} imageUri={null} wordmark={null} />,
        cacheControl,
      );
    } catch {
      return lastResortResponse(cacheControl);
    }
  }
}

/** Absolute URL of the series-level card, for metadata. */
export function ogImageUrl(id: string | number, episode?: string | number | null): string {
  const hasEpisode = episode !== null && episode !== undefined && String(episode).trim() !== "";
  return absoluteUrl(hasEpisode ? `/og/${id}/${parseEpisodeNumber(episode)}` : `/og/${id}`);
}
