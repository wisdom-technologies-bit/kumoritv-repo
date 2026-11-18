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
  };
}
