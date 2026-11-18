/**
 * The watchhentai service client.
 *
 * It answers with one entry per quality, each carrying the referer its CDN
 * demands (`https://watchhentai.net/`). Files are MP4, not HLS, so the caller
 * proxies them through the segment proxy rather than the manifest one.
 */

import type { AdultConfig, AdultVariant } from "./config";

export type AdultSource = {
  url: string;
  type: string;
  label: string;
  referer: string;
};

export type AdultEpisode = {
  title: string;
  variant: AdultVariant;
  sources: AdultSource[];
};

export type AdultServiceError = {
  ok: false;
  code: "ADULT_SERVICE_UNREACHABLE" | "ADULT_SERVICE_REJECTED" | "ADULT_SOURCE_MISSING";
  message: string;
};

export type AdultServiceResult = { ok: true; episode: AdultEpisode } | AdultServiceError;

const TIMEOUT_MS = 15_000;

type RawSource = { src?: unknown; type?: unknown; label?: unknown; referer?: unknown };

/** Pure: pick the source the operator prefers, else the first usable one. */
export function pickSource(
  sources: readonly RawSource[],
  preferredQuality: string,
  referer: string,
): AdultSource | null {
  const usable = sources
    .filter((source) => typeof source?.src === "string" && source.src.length > 0)
    .map((source) => ({
      url: String(source.src),
      type: typeof source.type === "string" && source.type ? source.type : "video/mp4",
      label:
        typeof source.label === "string" && source.label ? source.label : "default",
      referer:
        typeof source.referer === "string" && source.referer ? source.referer : referer,
    }));
  if (usable.length === 0) return null;
  const preferred = usable.find(
    (source) => source.label.toLowerCase() === preferredQuality.toLowerCase(),
  );
  return preferred ?? usable[0];
}

export async function fetchAdultEpisode(
  config: AdultConfig,
  videoSlug: string,
  variant: AdultVariant,
  fetchImpl: typeof fetch = fetch,
): Promise<AdultServiceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${config.baseUrl}/api/watch/${encodeURIComponent(videoSlug)}`,
      {
        headers: { "x-api-key": config.apiKey, accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return {
        ok: false,
        code: "ADULT_SERVICE_REJECTED",
        message: `watchhentai responded ${response.status}`,
      };
    }
    const body = (await response.json()) as {
      success?: boolean;
      data?: { title?: string; player?: { referer?: string; sources?: RawSource[] } };
    };
    const player = body?.data?.player;
    const referer =
      typeof player?.referer === "string" && player.referer
        ? player.referer
        : "https://watchhentai.net/";
    const source = pickSource(player?.sources ?? [], config.preferredQuality, referer);
    if (!source) {
      return {
        ok: false,
        code: "ADULT_SOURCE_MISSING",
        message: "the source listed no playable file",
      };
    }
    return {
      ok: true,
      episode: {
        title: typeof body?.data?.title === "string" ? body.data.title : "",
        variant,
        sources: [source],
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: "ADULT_SERVICE_UNREACHABLE",
      message: error instanceof Error ? error.message : "watchhentai unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}

export type CachedAdultStream = {
  url: string;
  referer: string;
  label: string;
  title: string;
  variant: AdultVariant;
};

export async function readAdultCache(
  db: any,
  key: { anilistId: number; episode: number; variant: AdultVariant },
  now = Date.now(),
): Promise<CachedAdultStream | null> {
  if (!db) return null;
  try {
    const { data, error } = await db
      .from("adult_stream_cache")
      .select("payload, expires_at")
      .eq("anilist_id", key.anilistId)
      .eq("episode_number", key.episode)
      .eq("variant", key.variant)
      .maybeSingle();
    if (error || !data?.payload) return null;
    const expiresAt = Date.parse(String(data.expires_at));
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
    const payload = data.payload as CachedAdultStream;
    return typeof payload?.url === "string" && payload.url ? payload : null;
  } catch {
    // A missing table must never break playback: it only means no cache.
    return null;
  }
}

export async function writeAdultCache(
  db: any,
  key: { anilistId: number; episode: number; variant: AdultVariant },
  payload: CachedAdultStream,
  ttlSeconds: number,
  now = Date.now(),
): Promise<void> {
  if (!db) return;
  try {
    await db.from("adult_stream_cache").upsert(
      {
        anilist_id: key.anilistId,
        episode_number: key.episode,
        variant: key.variant,
        payload,
        expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
      },
      { onConflict: "anilist_id,episode_number,variant" },
    );
  } catch {
    // Best effort only.
  }
}

export type AdultSeriesEpisode = {
  title: string;
  url: string;
  /** Parsed from the service when it gives one; null when it does not. */
  number: number | null;
};

export type AdultMatchCandidate = {
  title: string;
  slug: string;
  url: string;
  score: number;
  variant: string;
};

export type AdultMatchResult =
  | { ok: true; candidates: AdultMatchCandidate[] }
  | AdultServiceError;

/**
 * Title -> candidate series. This is what makes the provider work without any
 * hand-made mapping: the service ranks what its own search returns, and the
 * caller decides whether the score is good enough to trust.
 */
export async function fetchAdultMatch(
  config: AdultConfig,
  title: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AdultMatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const query = `${config.baseUrl}/api/match?title=${encodeURIComponent(title)}&limit=${limit}`;
    const response = await fetchImpl(query, {
      headers: { "x-api-key": config.apiKey, accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        code: "ADULT_SERVICE_REJECTED",
        message: `watchhentai responded ${response.status}`,
      };
    }
    const body = (await response.json()) as {
      data?: {
        candidates?: Array<{
          title?: unknown;
          slug?: unknown;
          url?: unknown;
          score?: unknown;
          variant?: unknown;
        }>;
      };
    };
    return {
      ok: true,
      candidates: (body?.data?.candidates ?? [])
        .map((candidate) => ({
          title: typeof candidate?.title === "string" ? candidate.title : "",
          slug: typeof candidate?.slug === "string" ? candidate.slug : "",
          url: typeof candidate?.url === "string" ? candidate.url : "",
          score: Number(candidate?.score) || 0,
          variant: typeof candidate?.variant === "string" ? candidate.variant : "unknown",
        }))
        .filter((candidate) => candidate.slug),
    };
  } catch {
    return {
      ok: false,
      code: "ADULT_SERVICE_UNREACHABLE",
      message: "watchhentai did not answer the title search",
    };
  } finally {
    clearTimeout(timer);
  }
}

export type AdultSeriesResult =
  | { ok: true; title: string; censored: string; episodes: AdultSeriesEpisode[] }
  | AdultServiceError;

/** One series, so a whole run can be mapped from a single slug. */
export async function fetchAdultSeries(
  config: AdultConfig,
  seriesSlug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdultSeriesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${config.baseUrl}/api/series/${encodeURIComponent(seriesSlug)}`,
      {
        headers: { "x-api-key": config.apiKey, accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return {
        ok: false,
        code: "ADULT_SERVICE_REJECTED",
        message: `watchhentai responded ${response.status}`,
      };
    }
    const body = (await response.json()) as {
      data?: {
        title?: string;
        censored?: unknown;
        episodes?: Array<{ title?: string; url?: string; number?: unknown }>;
      };
    };
    return {
      ok: true,
      title: typeof body?.data?.title === "string" ? body.data.title : "",
      censored: typeof (body?.data as { censored?: unknown })?.censored === "string"
        ? String((body?.data as { censored?: unknown }).censored)
        : "",
      episodes: (body?.data?.episodes ?? []).map((episode) => ({
        title: typeof episode?.title === "string" ? episode.title : "",
        url: typeof episode?.url === "string" ? episode.url : "",
        number:
          typeof episode?.number === "number" && Number.isFinite(episode.number)
            ? episode.number
            : null,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      code: "ADULT_SERVICE_UNREACHABLE",
      message: error instanceof Error ? error.message : "watchhentai unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}
