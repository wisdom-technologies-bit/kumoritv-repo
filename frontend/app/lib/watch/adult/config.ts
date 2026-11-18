/**
 * When the adult provider is allowed to answer.
 *
 * Everything here is cheap and local: no database, no network. `readAdultConfig`
 * returns null unless the deployment opted in, so a request that never names a
 * variant cannot reach any of this code at all.
 */

export const ADULT_PROVIDER = "wh";
export const ADULT_SERVER_LABEL = "WatchHentai";

export type AdultVariant = "censored" | "uncensored";

export type AdultConfig = {
  baseUrl: string;
  apiKey: string;
  cacheTtlSeconds: number;
  /** Preferred source label, e.g. "1080p". Falls back to the first source. */
  preferredQuality: string;
  /**
   * How good a title match must be before it is trusted without a human having
   * approved it. The service scores 1 for an exact title, so anything below this
   * is left unmapped rather than guessed.
   */
  matchMinScore: number;
  /** How many candidate series a single discovery may inspect. */
  matchCandidates: number;
};

const DEFAULT_TTL_SECONDS = 900;
const MAX_TTL_SECONDS = 3600;

export function normalizeVariant(value: unknown): AdultVariant | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "censored" || text === "uncensored" ? text : null;
}

/** Both variants, in the order the chooser shows them. */
export function orderedVariants(variants: readonly string[]): AdultVariant[] {
  const set = new Set(variants.map((value) => value.trim().toLowerCase()));
  return (["uncensored", "censored"] as AdultVariant[]).filter((variant) =>
    set.has(variant),
  );
}

function num(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function positiveInt(raw: string | undefined, fallback: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

export function readAdultConfig(
  env: Record<string, string | undefined> = process.env,
): AdultConfig | null {
  if ((env.ADULT_PROVIDER_ENABLED || "").trim() !== "1") return null;
  const baseUrl = (env.WATCHHENTAI_API_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (env.WATCHHENTAI_API_KEY || "").trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    cacheTtlSeconds: positiveInt(
      env.ADULT_CACHE_TTL_SECONDS,
      DEFAULT_TTL_SECONDS,
      MAX_TTL_SECONDS,
    ),
    preferredQuality: (env.ADULT_PREFERRED_QUALITY || "1080p").trim(),
    matchMinScore: clamp(num(env.ADULT_MATCH_MIN_SCORE, 0.7), 0.3, 1),
    matchCandidates: Math.round(clamp(num(env.ADULT_MATCH_MAX_CANDIDATES, 4), 1, 8)),
  };
}
