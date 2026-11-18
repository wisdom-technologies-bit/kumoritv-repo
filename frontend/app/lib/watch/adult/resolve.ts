/**
 * Adult playback, gated four times before a single byte is served:
 *
 *   1. the deployment opted in (ADULT_PROVIDER_ENABLED=1 and credentials set),
 *   2. the caller named a variant, so the viewer has made the explicit choice,
 *   3. the anime row is actually marked adult,
 *   4. a mapping row exists for that episode and variant.
 *
 * Miss any of them and the caller is told to carry on with the normal path, so
 * a non-adult title never reaches this module's provider and never gains a new
 * failure mode.
 */

import {
  ADULT_PROVIDER,
  ADULT_SERVER_LABEL,
  normalizeVariant,
  orderedVariants,
  readAdultConfig,
  type AdultVariant,
} from "./config";
import { discoverAdultSources, titlesForDiscovery } from "./auto";
import {
  fetchAdultEpisode,
  readAdultCache,
  writeAdultCache,
  type CachedAdultStream,
} from "./watchhentai";

export type AdultDecision =
  | { kind: "skip"; reason: string }
  | {
      kind: "unavailable";
      code: string;
      message: string;
      variants?: AdultVariant[];
    }
  | { kind: "ok"; body: Record<string, unknown> };

export type AdultProxy = (
  kind: "segment",
  options: { u: string; h?: Record<string, string>; f?: string },
) => Promise<string>;

type MappedRow = {
  variant: string;
  wh_video_slug: string;
  matched_title: string | null;
};

async function mappingRows(
  db: any,
  anilistId: number,
  episode: number,
): Promise<MappedRow[]> {
  try {
    const { data, error } = await db
      .from("adult_sources")
      .select("variant, wh_video_slug, matched_title")
      .eq("anilist_id", anilistId)
      .eq("episode_number", episode);
    if (error || !Array.isArray(data)) return [];
    return data as MappedRow[];
  } catch {
    return [];
  }
}

type AnimeAdultInfo = { isAdult: boolean; titles: string[] };

async function animeAdultInfo(db: any, anilistId: number): Promise<AnimeAdultInfo> {
  try {
    const { data, error } = await db
      .from("anime")
      .select("is_adult, title, title_english, title_romaji")
      .eq("anilist_id", anilistId)
      .maybeSingle();
    if (error || !data) return { isAdult: false, titles: [] };
    return { isAdult: data.is_adult === true, titles: titlesForDiscovery(data) };
  } catch {
    return { isAdult: false, titles: [] };
  }
}

/**
 * Discovery writes the row it earned, so the answer is stable afterwards and a
 * human can correct or delete it later. A curated row is never overwritten:
 * `auto` is only set on rows this path created.
 */
async function saveDiscovered(
  db: any,
  anilistId: number,
  episode: number,
  sources: Array<{ variant: AdultVariant; videoSlug: string; seriesSlug: string; title: string; score: number }>,
) {
  if (sources.length === 0) return;
  try {
    await db.from("adult_sources").upsert(
      sources.map((source) => ({
        anilist_id: anilistId,
        episode_number: episode,
        variant: source.variant,
        wh_series_slug: source.seriesSlug,
        wh_video_slug: source.videoSlug,
        matched_title: source.title,
        match_score: source.score,
        auto: true,
        checked_at: new Date().toISOString(),
      })),
      { onConflict: "anilist_id,episode_number,variant", ignoreDuplicates: true },
    );
  } catch {
    /* a cache write is never worth failing playback over */
  }
}

/** Curated rows first; discovery only when the episode has none. */
async function outcomeRows(
  db: any,
  config: ReturnType<typeof readAdultConfig>,
  anilistId: number,
  episode: number,
  titles: string[],
  fetchImpl?: typeof fetch,
): Promise<MappedRow[]> {
  const curated = await mappingRows(db, anilistId, episode);
  if (curated.length > 0 || !config) return curated;
  const discovered = await discoverAdultSources({ config, titles, episode, fetchImpl });
  if (discovered.length === 0) return [];
  await saveDiscovered(db, anilistId, episode, discovered);
  return discovered.map((source) => ({
    variant: source.variant,
    wh_video_slug: source.videoSlug,
    matched_title: source.title,
  }));
}

/** The chooser's data source. Never reveals anything about a non-adult title. */
export async function listAdultVariants(
  db: any,
  anilistId: number,
  episode: number,
): Promise<{ providerEnabled: boolean; adult: boolean; variants: AdultVariant[] }> {
  const config = readAdultConfig();
  if (!config) return { providerEnabled: false, adult: false, variants: [] };
  const info = await animeAdultInfo(db, anilistId);
  if (!info.isAdult) return { providerEnabled: true, adult: false, variants: [] };
  const rows = await outcomeRows(db, config, anilistId, episode, info.titles);
  return {
    providerEnabled: true,
    adult: true,
    variants: orderedVariants(rows.map((row) => row.variant)),
  };
}

export async function resolveAdultWatch(input: {
  db: any;
  anilistId: number;
  episode: number;
  variant: AdultVariant;
  proxy: AdultProxy;
  fetchImpl?: typeof fetch;
}): Promise<AdultDecision> {
  const variant = normalizeVariant(input.variant);
  if (!variant) return { kind: "skip", reason: "no_variant" };

  const config = readAdultConfig();
  if (!config) return { kind: "skip", reason: "disabled" };

  const info = await animeAdultInfo(input.db, input.anilistId);
  if (!info.isAdult) return { kind: "skip", reason: "not_adult" };

  const rows = await outcomeRows(
    input.db,
    config,
    input.anilistId,
    input.episode,
    info.titles,
    input.fetchImpl,
  );
  const variants = orderedVariants(rows.map((row) => row.variant));
  const mapped = rows.find((row) => row.variant === variant);
  if (!mapped) {
    return {
      kind: "unavailable",
      code: "ADULT_VARIANT_UNAVAILABLE",
      message: variants.length
        ? "that episode is available, but not in the variant you asked for"
        : "no source matched this episode on the adult service",
      variants,
    };
  }

  const key = {
    anilistId: input.anilistId,
    episode: input.episode,
    variant,
  };

  let stream: CachedAdultStream | null = await readAdultCache(input.db, key);
  if (!stream) {
    const result = await fetchAdultEpisode(
      config,
      mapped.wh_video_slug,
      variant,
      input.fetchImpl,
    );
    if (!result.ok) {
      return { kind: "unavailable", code: result.code, message: result.message };
    }
    const source = result.episode.sources[0];
    stream = {
      url: source.url,
      referer: source.referer,
      label: source.label,
      title: result.episode.title || mapped.matched_title || "",
      variant,
    };
    await writeAdultCache(input.db, key, stream, config.cacheTtlSeconds);
  }

  const url = await input.proxy("segment", {
    u: stream.url,
    h: { referer: stream.referer },
    f: "mp4",
  });

  return {
    kind: "ok",
    body: {
      provider: ADULT_PROVIDER,
      server: ADULT_SERVER_LABEL,
      serverId: ADULT_PROVIDER,
      hasBackup: false,
      type: "mp4",
      url,
      subtitles: [],
      thumbnails: null,
      intro: null,
      outro: null,
      availableAudio: { sub: true, dub: false },
      adult: true,
      variant: stream.variant,
      adultTitle: stream.title,
      quality: stream.label,
      servers: [
        { id: ADULT_PROVIDER, label: ADULT_SERVER_LABEL, active: true, healthy: true },
      ],
      resolvedAt: new Date().toISOString(),
    },
  };
}
