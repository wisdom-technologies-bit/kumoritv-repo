// Server-only episode SEO data: the DB row first, AniList as the fallback.
//
// `episodes.duration` is stored in SECONDS: `mergeEpisodes` (app/lib/anivexa/merge.ts)
// multiplies provider values of 300 or less by 60 and keeps larger values as they
// are. Anything below 60 here can only be a raw minutes value, so it is treated as
// minutes. `episodes.air_date` is a plain date, `airing_episodes.aired_at` a
// timestamptz.

import "server-only";
import { cache } from "react";
import { parseEpisodeNumber } from "./titles";
import { stripHtml } from "./text";

export type EpisodeSeoSource = "db" | "anilist" | "fallback";

export type EpisodeSeo = {
  episodeTitle: string;
  synopsis: string | null;
  thumbnailUrl: string | null;
  airedAtISO: string | null;
  durationISO: string | null;
  hasSub: boolean;
  hasDub: boolean;
  source: EpisodeSeoSource;
};

export type EpisodeSeoRow = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  airDate: string | null;
  duration: number | null;
  hasSub: boolean;
  hasDub: boolean;
  airedAtISO: string | null;
};

export type EpisodeSeoDeps = {
  readEpisode: (anilistId: number, episode: number) => Promise<EpisodeSeoRow | null>;
  importAnime: (anilistId: number) => Promise<unknown>;
  getMedia: (anilistId: number) => Promise<unknown | null>;
  background: (task: Promise<unknown>) => void;
  now: () => number;
  budgetMs: number;
};

export const TOTAL_BUDGET_MS = 2500;
const DB_BUDGET_MS = 900;
const IMPORT_RACE_MS = 1200;
const MEDIA_BUDGET_MS = 900;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function providerCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as object).length;
  return 0;
}

/** Seconds (or a legacy minutes value) to ISO-8601, e.g. 1440 -> PT24M. */
export function episodeDurationToIso(raw: unknown): string | null {
  const value = asNumber(raw);
  if (value === null || value <= 0) return null;
  const total = Math.round(value < 60 ? value * 60 : value);
  if (total <= 0) return null;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const body = `${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${seconds ? `${seconds}S` : ""}`;
  return body ? `PT${body}` : null;
}

/** AniList's media.duration is in minutes. */
export function minutesToIsoDuration(raw: unknown): string | null {
  const value = asNumber(raw);
  if (value === null || value <= 0) return null;
  return episodeDurationToIso(Math.round(value * 60));
}

/** A date-only column becomes a UTC timestamp, timestamps pass through as ISO. */
export function toAiredAtIso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00+00:00`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Reads one episode row plus its airing timestamp from any Supabase-like client. */
export async function readEpisodeSeoRow(
  db: any,
  anilistId: number,
  episode: number,
): Promise<EpisodeSeoRow | null> {
  if (!db) return null;
  const [episodeResult, airingResult] = await Promise.allSettled([
    db
      .from("episodes")
      .select("title, description, image_url, air_date, duration, sub_providers, dub_providers")
      .eq("anilist_id", anilistId)
      .eq("episode_number", episode)
      .maybeSingle(),
    db
      .from("airing_episodes")
      .select("aired_at")
      .eq("anilist_id", anilistId)
      .eq("episode", episode)
      .maybeSingle(),
  ]);

  const row =
    episodeResult.status === "fulfilled" ? (episodeResult.value?.data as Record<string, any> | null) : null;
  const airing =
    airingResult.status === "fulfilled" ? (airingResult.value?.data as Record<string, any> | null) : null;
  if (!row) return null;

  return {
    title: text(row.title) || null,
    description: text(row.description) || null,
    imageUrl: text(row.image_url) || null,
    airDate: text(row.air_date) || null,
    duration: asNumber(row.duration),
    hasSub: providerCount(row.sub_providers) > 0,
    hasDub: providerCount(row.dub_providers) > 0,
    airedAtISO: toAiredAtIso(airing?.aired_at) || toAiredAtIso(row.air_date),
  };
}

type MediaLike = {
  bannerImage?: unknown;
  coverImage?: { extraLarge?: unknown; large?: unknown } | null;
  description?: unknown;
  duration?: unknown;
  streamingEpisodes?: Array<{ title?: unknown; thumbnail?: unknown }> | null;
};

function mediaImage(media: MediaLike | null): string | null {
  if (!media) return null;
  return (
    text(media.bannerImage) ||
    text(media.coverImage?.extraLarge) ||
    text(media.coverImage?.large) ||
    null
  );
}

/** "Episode 2 - The Great Swordsman" -> "The Great Swordsman" for the H1 and title. */
export function cleanEpisodeTitle(title: unknown, episode: number): string {
  const value = text(title);
  if (!value) return "";
  const prefix = new RegExp(
    `^\\s*(?:episode|ep|e)\\s*[.\\-–—:]?\\s*0*${episode}\\s*(?:[.\\-–—:|]+\\s*)?`,
    "i",
  );
  const stripped = value.replace(prefix, "").trim();
  return stripped || "";
}

function streamingEpisode(media: MediaLike | null, episode: number): { title: string; thumbnail: string } | null {
  const list = Array.isArray(media?.streamingEpisodes) ? media!.streamingEpisodes! : [];
  const pattern = new RegExp(`(?:^|[^a-z0-9])(?:episode|ep)\\s*0*${episode}(?![0-9])`, "i");
  for (const item of list) {
    const title = text(item?.title);
    if (!title) continue;
    if (pattern.test(title)) return { title, thumbnail: text(item?.thumbnail) };
  }
  return null;
}

async function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return fallback;
  const guarded = promise.catch(() => fallback);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The real gatherer behind `getEpisodeSeo`, with injectable dependencies.
 * Never throws and never runs past its budget.
 */
export async function resolveEpisodeSeo(
  anilistId: number | string,
  episode: number | string,
  deps: EpisodeSeoDeps,
): Promise<EpisodeSeo> {
  const id = Number(anilistId);
  const ep = parseEpisodeNumber(episode);
  const fallback: EpisodeSeo = {
    episodeTitle: `Episode ${ep}`,
    synopsis: null,
    thumbnailUrl: null,
    airedAtISO: null,
    durationISO: null,
    hasSub: false,
    hasDub: false,
    source: "fallback",
  };
  if (!Number.isInteger(id) || id <= 0) return fallback;

  const deadline = deps.now() + (deps.budgetMs || TOTAL_BUDGET_MS);
  const remaining = () => deadline - deps.now();

  try {
    let row = await within(deps.readEpisode(id, ep), Math.min(DB_BUDGET_MS, remaining()), null);

    if (!row) {
      // Kick the import off so the NEXT visit has real data, then wait a little.
      const importTask = Promise.resolve()
        .then(() => deps.importAnime(id))
        .catch(() => null);
      try {
        deps.background(importTask);
      } catch {
        /* background scheduling is best effort */
      }
      const imported = await within(importTask, Math.min(IMPORT_RACE_MS, remaining()), null);
      if (imported) {
        row = await within(deps.readEpisode(id, ep), Math.min(DB_BUDGET_MS, remaining()), null);
      }
    }

    const needsMedia = !row || !row.description || !row.imageUrl || !row.duration;
    const media = needsMedia
      ? await within<MediaLike | null>(
          Promise.resolve()
            .then(() => deps.getMedia(id))
            .then((value) => (value as MediaLike | null) ?? null),
          Math.min(MEDIA_BUDGET_MS, remaining()),
          null,
        )
      : null;

    const streaming = needsMedia ? streamingEpisode(media, ep) : null;

    const episodeTitle =
      text(row?.title) ||
      cleanEpisodeTitle(streaming?.title, ep) ||
      `Episode ${ep}`;
    const synopsis =
      stripHtml(row?.description) || stripHtml(media?.description) || null;
    const thumbnailUrl =
      text(row?.imageUrl) || text(streaming?.thumbnail) || mediaImage(media);
    const durationISO =
      episodeDurationToIso(row?.duration) || minutesToIsoDuration(media?.duration);
    const airedAtISO = row?.airedAtISO || null;

    const source: EpisodeSeoSource = row
      ? "db"
      : streaming || media
        ? "anilist"
        : "fallback";

    return {
      episodeTitle,
      synopsis: synopsis || null,
      thumbnailUrl: thumbnailUrl || null,
      airedAtISO,
      durationISO,
      hasSub: Boolean(row?.hasSub),
      hasDub: Boolean(row?.hasDub),
      source: row ? "db" : source,
    };
  } catch {
    return fallback;
  }
}

/** Lazily loads the server-only pieces so importing this module stays cheap. */
export function defaultEpisodeSeoDeps(): EpisodeSeoDeps {
  return {
    async readEpisode(anilistId, episode) {
      const { createAdminClient } = await import("@/app/lib/supabase/admin");
      const db = createAdminClient();
      if (!db) return null;
      return readEpisodeSeoRow(db, anilistId, episode);
    },
    async importAnime(anilistId) {
      const { importAnime } = await import("@/app/lib/anime-db/import");
      return importAnime(anilistId, { source: "open" });
    },
    async getMedia(anilistId) {
      const { getMediaInfo } = await import("@/app/lib/anilist/medias.server");
      return getMediaInfo({ id: anilistId });
    },
    background(task) {
      void import("@vercel/functions")
        .then((mod) => {
          if (typeof mod.waitUntil === "function") mod.waitUntil(task);
        })
        .catch(() => {});
    },
    now: () => Date.now(),
    budgetMs: TOTAL_BUDGET_MS,
  };
}

const gather = (anilistId: number, episode: number) =>
  resolveEpisodeSeo(anilistId, episode, defaultEpisodeSeoDeps());

// React 18.3 only exposes `cache()` in Next's react-server build.
const reactCache = cache as unknown as
  | (<T extends (...args: never[]) => unknown>(fn: T) => T)
  | undefined;

/** Cached per request so generateMetadata and the page share one result. */
export const getEpisodeSeo: (anilistId: number, episode: number) => Promise<EpisodeSeo> =
  typeof reactCache === "function" ? reactCache(gather) : gather;
