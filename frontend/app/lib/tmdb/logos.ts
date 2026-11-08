import "server-only";

// TMDB stlyised title logos (the transparent PNG wordmarks Kaori shows).
//
// Everything here is optional: without `TMDB_API_KEY` (v3) or
// `TMDB_READ_ACCESS_TOKEN` (v4 bearer) every function answers
// `{ status: "disabled" }` and nothing is fetched or logged as an error.
//
// The key is never logged, never placed in an error message and never returned
// to a caller. Error strings are fixed on purpose: a thrown fetch error can
// quote the request URL, which for a v3 key contains the secret.

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const REQUEST_TIMEOUT_MS = 8000;

/** Sizes we are willing to build a URL for. */
const IMAGE_SIZES = new Set(["w300", "w500", "w780", "original"]);

/** `/abc123.png` and nothing else: no host, no traversal, no query. */
const LOGO_PATH = /^\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/;

export type TmdbLogo = {
  /** TMDB file path, e.g. `/1abcDEF.png`. */
  path: string;
  aspectRatio: number;
  width: number;
};

export type TmdbLogoResult =
  | { status: "found"; logo: TmdbLogo }
  | { status: "none" }
  | { status: "disabled" }
  | { status: "rate_limited"; retryAfterMs: number }
  | { status: "error"; message: string };

type TmdbImageEntry = {
  file_path?: unknown;
  aspect_ratio?: unknown;
  width?: unknown;
  height?: unknown;
  iso_639_1?: unknown;
  vote_average?: unknown;
  vote_count?: unknown;
};

export function tmdbConfigured(): boolean {
  return Boolean((process.env.TMDB_API_KEY || "").trim() || (process.env.TMDB_READ_ACCESS_TOKEN || "").trim());
}

/** Reads `themoviedbId` (or `tmdbId`) out of the Anivexa mappings we store in
 *  `anime.mappings`. No title searching, ever. */
export function tmdbIdFromMappings(mappings: unknown): number | null {
  let value = mappings;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;

  for (const key of ["themoviedbId", "tmdbId"]) {
    const candidate = record[key];

    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) return candidate;

    if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) {
      const parsed = Number(candidate.trim());
      if (parsed > 0) return parsed;
    }
  }

  return null;
}

function languageRank(entry: TmdbImageEntry): number {
  if (entry.iso_639_1 === "en") return 0;
  if (entry.iso_639_1 === null || entry.iso_639_1 === undefined) return 1;

  return 2;
}

function voteOf(entry: TmdbImageEntry): number {
  const value = Number(entry.vote_average);

  return Number.isFinite(value) ? value : 0;
}

/** Language first (en, then no language, then anything), then votes, then size. */
export function pickBestLogo(logos: unknown): TmdbLogo | null {
  if (!Array.isArray(logos)) return null;

  const usable = (logos as TmdbImageEntry[]).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (typeof entry.file_path !== "string" || !LOGO_PATH.test(entry.file_path)) return false;

    const aspectRatio = Number(entry.aspect_ratio);
    if (!Number.isFinite(aspectRatio) || aspectRatio < 0.8 || aspectRatio > 8) return false;

    const width = Number(entry.width);
    if (!Number.isFinite(width) || width < 200) return false;

    return true;
  });

  if (!usable.length) return null;

  usable.sort((a, b) => {
    const byLanguage = languageRank(a) - languageRank(b);
    if (byLanguage !== 0) return byLanguage;

    const byVotes = voteOf(b) - voteOf(a);
    if (byVotes !== 0) return byVotes;

    return Number(b.width) - Number(a.width);
  });

  const best = usable[0];

  return {
    path: best.file_path as string,
    aspectRatio: Number(best.aspect_ratio),
    width: Number(best.width),
  };
}

/** Builds a public image URL, or null when the stored path is not a TMDB file. */
export function logoUrl(path: unknown, size = "w500"): string | null {
  if (typeof path !== "string" || !LOGO_PATH.test(path)) return null;

  const resolvedSize = IMAGE_SIZES.has(size) ? size : "w500";

  return `${TMDB_IMAGE_BASE}/${resolvedSize}${path}`;
}

function authHeaders(): Record<string, string> {
  const token = (process.env.TMDB_READ_ACCESS_TOKEN || "").trim();

  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** v3 keys travel as a query parameter, v4 tokens as a bearer header. */
function imagesUrl(type: "tv" | "movie", tmdbId: number): string {
  const key = (process.env.TMDB_API_KEY || "").trim();
  const query = new URLSearchParams({ include_image_language: "en,null" });

  if (key && !(process.env.TMDB_READ_ACCESS_TOKEN || "").trim()) query.set("api_key", key);

  return `${TMDB_API}/${type}/${tmdbId}/images?${query.toString()}`;
}

function retryAfterMs(headers: Headers): number {
  const value = headers.get("retry-after");

  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60 * 60 * 1000);

    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 60 * 60 * 1000));
  }

  return 5000;
}

async function requestImages(type: "tv" | "movie", tmdbId: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(imagesUrl(type, tmdbId), {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json", ...authHeaders() },
    });

    if (response.status === 404) return { kind: "missing" as const };
    if (response.status === 429) return { kind: "rate_limited" as const, retryAfterMs: retryAfterMs(response.headers) };
    if (!response.ok) return { kind: "error" as const, message: `TMDB responded ${response.status}` };

    const json = (await response.json()) as { logos?: unknown };

    return { kind: "ok" as const, logos: json?.logos };
  } catch (error) {
    // Never surface the raw error: it can quote the request URL (and the key).
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

    return { kind: "error" as const, message: aborted ? "TMDB request timed out" : "TMDB request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Finds the best logo for one TMDB id. Movies try `/movie` first, everything
 *  else `/tv` first, and a 404 falls through to the other type once. */
export async function fetchLogoFor({
  tmdbId,
  format,
}: {
  tmdbId: number | null | undefined;
  format?: string | null;
}): Promise<TmdbLogoResult> {
  if (!tmdbConfigured()) return { status: "disabled" };
  if (!tmdbId || !Number.isInteger(tmdbId) || tmdbId <= 0) return { status: "none" };

  const order: Array<"tv" | "movie"> =
    String(format || "").toUpperCase() === "MOVIE" ? ["movie", "tv"] : ["tv", "movie"];

  for (const type of order) {
    const result = await requestImages(type, tmdbId);

    if (result.kind === "rate_limited") return { status: "rate_limited", retryAfterMs: result.retryAfterMs };
    if (result.kind === "error") return { status: "error", message: result.message };
    if (result.kind === "missing") continue;

    const logo = pickBestLogo(result.logos);

    return logo ? { status: "found", logo } : { status: "none" };
  }

  // Unknown on both endpoints: TMDB has nothing for this id.
  return { status: "none" };
}
