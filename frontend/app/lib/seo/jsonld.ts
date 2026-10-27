// Pure schema.org builders. Everything a builder cannot prove is dropped by
// `pruneJsonLd`, so a rendered graph never contains undefined or empty fields.

import { absoluteUrl, stripHtml, truncate } from "./text";

export type JsonLdNode = Record<string, unknown>;

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && !value.trim()) ||
  (typeof value === "number" && !Number.isFinite(value)) ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);

/** Deep-copies dropping undefined, null, empty strings, empty arrays and objects. */
export function pruneJsonLd<T>(value: T): T {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => pruneJsonLd(item))
      .filter((item) => !isEmpty(item));
    return items as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneJsonLd(entry);
      if (isEmpty(pruned)) continue;
      result[key] = pruned;
    }
    return result as unknown as T;
  }
  return value;
}

/** The only serialiser allowed to feed dangerouslySetInnerHTML. */
export function serializeJsonLd(data: JsonLdNode): string {
  return JSON.stringify(pruneJsonLd(data))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

const isMovie = (format?: string | null) =>
  typeof format === "string" && format.toUpperCase() === "MOVIE";

function breadcrumb(trail: Array<{ name: string; url: string }>): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export type MediaJsonLdInput = {
  id: number | string;
  name: string;
  alternateNames?: Array<string | null | undefined>;
  description?: unknown;
  imageUrl?: string | null;
  url: string;
  genres?: Array<string | null | undefined>;
  format?: string | null;
  startDateISO?: string | null;
  episodes?: number | null;
  year?: number | null;
};

export function buildMediaJsonLd(input: MediaJsonLdInput): JsonLdNode {
  const movie = isMovie(input.format);
  const alternates = (input.alternateNames || [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value, index, list) => value && value !== input.name.trim() && list.indexOf(value) === index);
  const startDate = typeof input.startDateISO === "string" && input.startDateISO ? input.startDateISO : null;
  const episodes = Number(input.episodes);

  const main: JsonLdNode = {
    "@type": movie ? "Movie" : "TVSeries",
    name: input.name,
    alternateName: alternates,
    description: truncate(stripHtml(input.description), 500),
    image: input.imageUrl ? absoluteUrl(input.imageUrl) : null,
    url: input.url,
    genre: (input.genres || []).filter((genre): genre is string => typeof genre === "string" && !!genre.trim()),
    numberOfEpisodes: movie ? null : Number.isInteger(episodes) && episodes > 0 ? episodes : null,
    startDate,
    inLanguage: "ja",
  };

  return {
    "@context": "https://schema.org",
    "@graph": pruneJsonLd([
      main,
      breadcrumb([
        { name: "Home", url: absoluteUrl("/") },
        { name: input.name, url: input.url },
      ]),
    ]),
  };
}

export type WatchJsonLdInput = {
  id: number | string;
  animeName: string;
  episode: number;
  episodeTitle?: string | null;
  description?: unknown;
  imageUrl: string;
  thumbnailUrl?: string | null;
  airedAtISO?: string | null;
  durationISO?: string | null;
  url: string;
  seriesUrl: string;
  format?: string | null;
};

export function buildWatchJsonLd(input: WatchJsonLdInput): JsonLdNode {
  const movie = isMovie(input.format);
  const episode = Number.isFinite(input.episode) && input.episode > 0 ? Math.trunc(input.episode) : 1;
  const description = truncate(stripHtml(input.description), 500);
  const images = [
    absoluteUrl(input.imageUrl),
    input.thumbnailUrl ? absoluteUrl(input.thumbnailUrl) : null,
  ].filter((value): value is string => Boolean(value));
  const uniqueImages = images.filter((value, index) => images.indexOf(value) === index);
  const uploadDate = input.airedAtISO || null;
  const duration = input.durationISO || null;

  const main: JsonLdNode = movie
    ? {
        "@type": "Movie",
        name: input.animeName,
        description,
        image: uniqueImages[0] || null,
        datePublished: uploadDate,
        url: input.url,
        inLanguage: "ja",
        partOfSeries: { "@type": "TVSeries", name: input.animeName, url: input.seriesUrl },
      }
    : {
        "@type": "TVEpisode",
        name: input.episodeTitle || `Episode ${episode}`,
        episodeNumber: episode,
        description,
        image: uniqueImages[0] || null,
        datePublished: uploadDate,
        url: input.url,
        inLanguage: "ja",
        partOfSeries: { "@type": "TVSeries", name: input.animeName, url: input.seriesUrl },
      };

  const video: JsonLdNode | null =
    uploadDate && description
      ? {
          "@type": "VideoObject",
          name: input.episodeTitle || `${input.animeName} Episode ${episode}`,
          description,
          thumbnailUrl: uniqueImages,
          uploadDate,
          duration,
          url: input.url,
          inLanguage: "ja",
        }
      : null;

  const trail =
    movie
      ? [
          { name: "Home", url: absoluteUrl("/") },
          { name: input.animeName, url: input.seriesUrl },
        ]
      : [
          { name: "Home", url: absoluteUrl("/") },
          { name: input.animeName, url: input.seriesUrl },
          { name: `Episode ${episode}`, url: input.url },
        ];

  return {
    "@context": "https://schema.org",
    "@graph": pruneJsonLd([main, video, breadcrumb(trail)]),
  };
}

export function buildHomeJsonLd(): JsonLdNode {
  const site = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "KumoriTV",
        alternateName: "Kumori TV",
        url: site,
      },
      {
        "@type": "Organization",
        name: "KumoriTV",
        url: site,
        logo: absoluteUrl("/android-chrome-512.png"),
      },
    ],
  };
}

/** AniList's startDate is only usable when the day is known too. */
export function anilistStartDateIso(date: unknown): string | null {
  const value = date as { year?: number; month?: number; day?: number } | null | undefined;
  const year = Number(value?.year);
  const month = Number(value?.month);
  const day = Number(value?.day);
  if (!Number.isInteger(year) || year < 1900) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== day) return null;
  return iso;
}
