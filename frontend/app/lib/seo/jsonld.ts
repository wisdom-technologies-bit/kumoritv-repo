// Pure schema.org builders. Everything a builder cannot prove is dropped by
// `pruneJsonLd`, so a rendered graph never contains undefined, null or empty
// strings. EVERY date that leaves this module is ISO 8601 with a timezone.

import { absoluteUrl, siteUrl, stripHtml, truncate } from "./text";

export type JsonLdNode = Record<string, unknown>;

/** A comment trimmed for structured data (body already 300 chars or less). */
export type JsonLdComment = {
  text: string;
  datePublished: string;
  author: string;
};

/** What the server-side comments query can prove about a page. */
export type CommentSummary = {
  commentCount: number;
  comments: JsonLdComment[];
};

/** Comment bodies are trimmed to this before they reach the markup. */
export const COMMENT_TEXT_LIMIT = 300;

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

/**
 * The ONLY serialiser allowed to feed dangerouslySetInnerHTML.
 *
 * `<`, `>`, `&` and the two JavaScript line separators are escaped as `\uXXXX`
 * sequences. JSON.parse still returns the original characters, but the payload
 * can never close the surrounding <script> tag: a comment body containing
 * `</script>` is just text. U+2028/U+2029 matter because they are valid JSON
 * yet terminate a line in older JS parsers that scan inline scripts.
 */
export function serializeJsonLd(data: JsonLdNode): string {
  return JSON.stringify(pruneJsonLd(data))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** A date or date-time becomes ISO 8601 with a timezone, or null. */
export function isoDateTime(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  // A date-only column is midnight UTC, spelled with an explicit offset.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00+00:00`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  // toISOString always ends in "Z", which IS a timezone designator.
  return parsed.toISOString();
}

const isMovie = (format?: string | null) =>
  typeof format === "string" && format.toUpperCase() === "MOVIE";

/** Formats whose media page describes a series (schema.org TVSeries). */
const SERIES_FORMATS = new Set(["TV", "ONA", "OVA", "SPECIAL", "TV_SHORT"]);
/** Formats whose media page describes a printed work (schema.org Book). */
const BOOK_FORMATS = new Set(["MANGA", "ONE_SHOT", "NOVEL"]);

type MediaKind = "series" | "movie" | "book" | "other";

function mediaKind(format?: string | null): MediaKind {
  const value = typeof format === "string" ? format.toUpperCase() : "";
  if (value === "MOVIE") return "movie";
  if (SERIES_FORMATS.has(value)) return "series";
  if (BOOK_FORMATS.has(value)) return "book";
  return "other";
}

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

/** Up to five already-filtered comments as schema.org Comment nodes. */
export function commentNodes(summary?: CommentSummary | null): JsonLdNode[] {
  const comments = Array.isArray(summary?.comments) ? summary!.comments : [];
  const nodes: JsonLdNode[] = [];

  for (const comment of comments) {
    if (nodes.length >= 5) break;

    const text = truncate(stripHtml(comment?.text), COMMENT_TEXT_LIMIT);
    const datePublished = isoDateTime(comment?.datePublished);
    const author = typeof comment?.author === "string" ? comment.author.trim() : "";
    if (!text || !datePublished || !author) continue;

    nodes.push({
      "@type": "Comment",
      text,
      datePublished,
      author: { "@type": "Person", name: author },
    });
  }

  return nodes;
}

/** commentCount + comment, or nothing at all when the query failed. */
function commentFields(summary?: CommentSummary | null): JsonLdNode {
  if (!summary) return {};
  const count = Number(summary.commentCount);
  const nodes = commentNodes(summary);
  return {
    commentCount: Number.isFinite(count) && count > 0 ? Math.trunc(count) : null,
    comment: nodes,
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
  /** AniList id of the MyAnimeList entry, when the title has one. */
  idMal?: number | null;
  /** Type of the AniList entry: ANIME or MANGA. */
  type?: string | null;
  comments?: CommentSummary | null;
};

/** AniList's own page for the title. */
export function anilistUrl(id: number | string, type?: string | null): string {
  const section = typeof type === "string" && type.toUpperCase() === "MANGA" ? "manga" : "anime";
  return `https://anilist.co/${section}/${id}`;
}

/** MyAnimeList's page for the title, when idMal is known. */
export function malUrl(idMal: number | string, type?: string | null): string | null {
  const numeric = Number(idMal);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const section = typeof type === "string" && type.toUpperCase() === "MANGA" ? "manga" : "anime";
  return `https://myanimelist.net/${section}/${numeric}`;
}

/** The watch page of episode 1: the WatchAction target of a media page. */
export function episodeOneWatchUrl(id: number | string): string {
  return `${absoluteUrl(`/watch/${id}`)}?ep=1`;
}

export function buildMediaJsonLd(input: MediaJsonLdInput): JsonLdNode {
  const kind = mediaKind(input.format);
  const alternates = (input.alternateNames || [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value, index, list) => value && value !== input.name.trim() && list.indexOf(value) === index);
  const episodes = Number(input.episodes);
  const startDate = isoDateTime(input.startDateISO);
  const sameAs = [
    anilistUrl(input.id, input.type),
    malUrl(input.idMal as number, input.type),
  ].filter((value): value is string => Boolean(value));

  const name = kind === "movie" ? "Movie" : kind === "book" ? "Book" : "TVSeries";

  const main: JsonLdNode = {
    "@type": name,
    name: input.name,
    alternateName: alternates,
    description: truncate(stripHtml(input.description), 500),
    image: input.imageUrl ? absoluteUrl(input.imageUrl) : null,
    url: input.url,
    genre: (input.genres || []).filter((genre): genre is string => typeof genre === "string" && !!genre.trim()),
    inLanguage: "ja",
    sameAs,
    // A series/season start is startDate; a one-off work is datePublished.
    startDate: kind === "series" ? startDate : null,
    datePublished: kind === "series" || kind === "other" ? null : startDate,
    numberOfEpisodes:
      kind === "series" && Number.isInteger(episodes) && episodes > 0 ? episodes : null,
    // The score on the page comes from AniList, not from our own users, so no
    // aggregateRating is ever emitted.
    potentialAction: {
      "@type": "WatchAction",
      target: episodeOneWatchUrl(input.id),
    },
    ...commentFields(input.comments),
  };

  return {
    "@context": "https://schema.org",
    "@graph": pruneJsonLd([
      kind === "other" ? null : main,
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
  /** Episode image (or the anime cover) used for the VideoObject thumbnail. */
  thumbnailUrl?: string | null;
  /** The episode's air date. */
  airedAtISO?: string | null;
  /** The `episodes` row's created/updated time: the uploadDate fallback. */
  rowCreatedAtISO?: string | null;
  durationISO?: string | null;
  url: string;
  seriesUrl: string;
  format?: string | null;
  /**
   * True only when the episode exists in our own `episodes` table, i.e. there is
   * something to play. Without it no VideoObject is emitted.
   */
  playable?: boolean;
  /** false for adult titles. */
  isFamilyFriendly?: boolean;
  comments?: CommentSummary | null;
};

export function buildWatchJsonLd(input: WatchJsonLdInput): JsonLdNode {
  const movie = isMovie(input.format);
  const episode = Number.isFinite(input.episode) && input.episode > 0 ? Math.trunc(input.episode) : 1;
  const description = truncate(stripHtml(input.description), COMMENT_TEXT_LIMIT);
  const thumbnail = input.thumbnailUrl ? absoluteUrl(input.thumbnailUrl) : null;
  // The canonical watch page IS the player page (owner decision: no /embed
  // route), so embedUrl is the canonical URL and contentUrl is never emitted.
  const embedUrl = input.url;
  const uploadDate = isoDateTime(input.airedAtISO) || isoDateTime(input.rowCreatedAtISO);
  const duration = input.durationISO || null;

  const partOfSeries = { "@type": "TVSeries", name: input.animeName, url: input.seriesUrl };

  const main: JsonLdNode = movie
    ? {
        "@type": "Movie",
        name: input.animeName,
        description,
        image: thumbnail,
        datePublished: uploadDate,
        url: input.url,
        inLanguage: "ja",
        partOfSeries,
      }
    : {
        "@type": "TVEpisode",
        name: input.episodeTitle || `Episode ${episode}`,
        episodeNumber: episode,
        description,
        image: thumbnail,
        datePublished: uploadDate,
        url: input.url,
        inLanguage: "ja",
        partOfSeries,
      };

  const video: JsonLdNode | null =
    input.playable && uploadDate
      ? {
          "@type": "VideoObject",
          name: movie ? input.animeName : `${input.animeName} Episode ${episode}`,
          description,
          thumbnailUrl: thumbnail,
          uploadDate,
          duration,
          inLanguage: "ja",
          isFamilyFriendly: input.isFamilyFriendly === false ? false : true,
          embedUrl,
          ...commentFields(input.comments),
        }
      : null;

  const trail = movie
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

export type HomeJsonLdItem = {
  /** Absolute or site-relative media page path. */
  url: string;
};

export type HomeJsonLdInput = {
  /** Trending/popular entries already rendered on the page, best first. */
  items?: HomeJsonLdItem[];
};

export const HOME_ITEM_LIST_LIMIT = 10;

/**
 * Homepage graph: WebSite (with the SearchAction kept as harmless metadata,
 * Google retired the sitelinks search box in November 2024), Organization, and
 * ONE ItemList in Google's "summary page" carousel format.
 *
 * The summary format allows ONLY @type, position and url on each ListItem: the
 * cover images and names are carried by each media page's own markup. No
 * TVSeries is invented on the homepage.
 */
export function buildHomeJsonLd(input: HomeJsonLdInput = {}): JsonLdNode {
  const site = siteUrl();

  const seen = new Set<string>();
  const listItems: JsonLdNode[] = [];

  for (const item of input.items || []) {
    const url = typeof item?.url === "string" && item.url.trim() ? absoluteUrl(item.url.trim()) : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    listItems.push({ "@type": "ListItem", position: listItems.length + 1, url });
    if (listItems.length >= HOME_ITEM_LIST_LIMIT) break;
  }

  return {
    "@context": "https://schema.org",
    "@graph": pruneJsonLd([
      {
        "@type": "WebSite",
        name: "KumoriTV",
        alternateName: "Kumori TV",
        url: `${site}/`,
        potentialAction: {
          "@type": "SearchAction",
          target: `${site}/search?title={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: "KumoriTV",
        url: `${site}/`,
        logo: absoluteUrl("/android-chrome-512.png"),
      },
      listItems.length
        ? {
            "@type": "ItemList",
            itemListElement: listItems,
          }
        : null,
    ]),
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
