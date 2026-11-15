import "server-only";
import { aniConfig } from "@/app/lib/ani/config";
import type { AdConfig } from "./ad";

/**
 * Download links for one episode, from the ani-api download route.
 *
 * Facts (real curl, 2026-11-15):
 *   GET /v1/downloads/mal/{mal}/episode/{n}
 *   -> {mal_id, episode_number, available, provider:"nekostream"|null, reason,
 *       sources:[{provider:"Kiwi", audio:"sub"|"dub",
 *                 quality:"360p"|"720p"|"1080p"|"800p",
 *                 url:"https://pahe.nekostream.site/<id>"}], note}
 *
 * The `url` is an HTML landing page on an external host, not a file: the browser
 * must open it in a new tab. `available:false` arrives as HTTP 200 with
 * `reason:"UPSTREAM_HAS_NO_LINKS"`; an unmapped MAL id is HTTP 404
 * `{code:"ANIKOTO_NOT_MAPPED"}`.
 *
 * The key is used here and nowhere else: it is never part of a result, a cache
 * entry, a log line or the JSON the browser receives.
 */

export const DOWNLOAD_PROVIDER_LABEL = "Kiwi";
const POSITIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 30 * 60_000;
const UPSTREAM_TIMEOUT_MS = 4_000;
const CACHE_LIMIT = 500;
const DEFAULT_DOWNLOAD_HOST = "nekostream.site";

export type DownloadOption = { quality: string; url: string };
export type DownloadGroup = { audio: "sub" | "dub"; options: DownloadOption[] };
export type DownloadsPayload = {
  available: boolean;
  provider: string | null;
  groups: DownloadGroup[];
  note: string | null;
  /** Only ever true when the feature flag is off: the button is not rendered. */
  disabled?: boolean;
  /** Present only when an ad URL is configured. */
  ad?: AdConfig | null;
};

export function downloadsEnabled(): boolean {
  return (process.env.DOWNLOADS_ENABLED || "").trim() === "1";
}

/** `DOWNLOAD_HOSTS` (comma list) narrows/replaces the default landing host. */
export function downloadHosts(): string[] {
  const raw = (process.env.DOWNLOAD_HOSTS || "").trim();
  const list = raw ? raw.split(",") : [DEFAULT_DOWNLOAD_HOST];
  return list
    .map((entry) => entry.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

export function downloadAd(): AdConfig | null {
  const url = (process.env.DOWNLOAD_AD_URL || "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  // Empty (or garbage) keeps the 30 minute default; an explicit 0 means every click.
  const rawEnv = (process.env.DOWNLOAD_AD_INTERVAL_MIN || "").trim();
  const raw = rawEnv ? Number(rawEnv) : Number.NaN;
  const intervalMin =
    Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 30;
  return { url, intervalMin };
}

/** https only, host must end with an allowed suffix, no credentials. */
export function isAllowedDownloadUrl(value: unknown, hosts = downloadHosts()): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** "1080p" -> 1080, "800p" -> 800, "4k" -> 0 (kept as-is, sorted last). */
export function qualityRank(quality: string): number {
  const match = /(\d{3,4})/.exec(String(quality ?? ""));
  return match ? Number(match[1]) : 0;
}

/**
 * Group + sort the sources for the browser: sub before dub, qualities high to
 * low, duplicates removed, and anything not on an allowed host dropped (an odd
 * quality like "800p" is kept verbatim, never invented or renamed).
 */
export function buildDownloadGroups(
  sources: unknown,
  hosts = downloadHosts(),
): DownloadGroup[] {
  const byAudio: Record<"sub" | "dub", Map<string, DownloadOption>> = {
    sub: new Map(),
    dub: new Map(),
  };

  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source !== "object") continue;
    const audio = String((source as any).audio || "").trim().toLowerCase();
    if (audio !== "sub" && audio !== "dub") continue;
    const url = String((source as any).url || "").trim();
    const quality = String((source as any).quality || "").trim();
    if (!quality || !isAllowedDownloadUrl(url, hosts)) continue;
    if (byAudio[audio].has(url)) continue;
    byAudio[audio].set(url, { quality, url });
  }

  const groups: DownloadGroup[] = [];
  for (const audio of ["sub", "dub"] as const) {
    const options = [...byAudio[audio].values()].sort(
      (a, b) => qualityRank(b.quality) - qualityRank(a.quality) || a.quality.localeCompare(b.quality),
    );
    if (options.length) groups.push({ audio, options });
  }
  return groups;
}

/** Upstream body -> the browser shape. Never echoes an upstream error string. */
export function mapDownloadResponse(body: unknown, hosts = downloadHosts()): DownloadsPayload {
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, any>;
  const groups = buildDownloadGroups(payload.sources, hosts);
  if (payload.available !== true || !groups.length) {
    return {
      available: false,
      provider: null,
      groups: [],
      note: "No download links for this episode.",
    };
  }
  const firstSourceProvider = String(payload.sources?.[0]?.provider || "").trim();
  return {
    available: true,
    provider: firstSourceProvider || DOWNLOAD_PROVIDER_LABEL,
    groups,
    note: typeof payload.note === "string" && payload.note.trim() ? payload.note.trim() : null,
  };
}

type CacheEntry = { at: number; ttl: number; value: DownloadsPayload };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DownloadsPayload>>();
const cacheKey = (malId: number, episode: number) => `${malId}:${episode}`;

const unavailable = (note = "Download links are unavailable right now."): DownloadsPayload => ({
  available: false,
  provider: null,
  groups: [],
  note,
});

function readCache(key: string): DownloadsPayload | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: DownloadsPayload, ttl: number) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), ttl, value });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export type DownloadFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type DownloadResult = { payload: DownloadsPayload; cached: boolean; status: number };

/**
 * Resolve one episode's links: 10 minute positive cache, 30 minute negative
 * cache for `ANIKOTO_NOT_MAPPED` and `available:false`, single-flight per
 * (mal, episode), 4 s timeout.
 */
export async function getEpisodeDownloads(input: {
  malId: number;
  episode: number;
  fetchImpl?: DownloadFetch;
  hosts?: string[];
}): Promise<DownloadResult> {
  const hosts = input.hosts ?? downloadHosts();
  const key = cacheKey(input.malId, input.episode);
  const cached = readCache(key);
  if (cached) return { payload: cached, cached: true, status: 200 };

  const running = inflight.get(key);
  if (running) return { payload: await running, cached: true, status: 200 };

  const config = aniConfig();
  if (!config.baseUrl || !config.apiKey)
    return { payload: unavailable("Downloads are not configured."), cached: false, status: 200 };

  const fetchImpl: DownloadFetch =
    input.fetchImpl ??
    ((url, init) => fetch(url, init) as unknown as ReturnType<DownloadFetch>);

  const run = (async (): Promise<DownloadsPayload> => {
    const url = `${config.baseUrl}/v1/downloads/mal/${input.malId}/episode/${input.episode}`;
    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await fetchImpl(url, {
        headers: {
          "x-api-key": config.apiKey || "",
          "user-agent": "KumoriTV",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      // Timeout or network: transient, so nothing is cached.
      return unavailable();
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    const code = String((body as any)?.code || "").toUpperCase();
    if (response.status === 404 && code === "ANIKOTO_NOT_MAPPED") {
      const value = unavailable("This title has no download page yet.");
      writeCache(key, value, NEGATIVE_TTL_MS);
      return value;
    }
    if (!response.ok) return unavailable();

    const mapped = mapDownloadResponse(body, hosts);
    writeCache(key, mapped, mapped.available ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS);
    return mapped;
  })().finally(() => inflight.delete(key));

  inflight.set(key, run);
  return { payload: await run, cached: false, status: 200 };
}

/** Test seam: module state is per process. */
export function __resetDownloadCacheForTests() {
  cache.clear();
  inflight.clear();
}
