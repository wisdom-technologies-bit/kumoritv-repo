import "server-only";

/**
 * Provider configuration, read from the environment on EVERY call.
 *
 * Nothing here is captured at module load or at build time: changing a Railway
 * variable and restarting the service is enough to turn ani on or off, move the
 * rollout percentage, or disable dub - no rebuild and no redeploy of the code.
 *
 * `ANI_PROVIDER_ENABLED` being absent ("0", "", anything but "1") means off, so
 * the default state of a fresh deployment is "Anivexa only", exactly as before.
 */
export type AniConfig = {
  /** Base URL without a trailing slash, or null when unset/invalid. */
  baseUrl: string | null;
  /** Never logged, never returned, never put in a token. */
  apiKey: string | null;
  enabled: boolean;
  /** 0-100. A stable hash of the anilist id decides who is inside the bucket. */
  percent: number;
  /** Off by default: the API only *declares* dub, it never verifies it. */
  dubEnabled: boolean;
  timeoutMs: number;
  maxConcurrency: number;
  ratePerMin: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_RATE_PER_MIN = 40;
/** The API allows 60/min per key; never let a mistyped variable exceed that. */
const MAX_RATE_PER_MIN = 55;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function intValue(name: string, fallback: number) {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentValue() {
  const raw = (process.env.ANI_PROVIDER_PERCENT || "").trim();
  if (!raw) return 100;
  const value = Number(raw);
  return Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 100;
}

function baseUrlValue() {
  const raw = (process.env.ANI_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return /^https?:$/.test(parsed.protocol) ? raw : null;
  } catch {
    return null;
  }
}

export function aniConfig(): AniConfig {
  return {
    baseUrl: baseUrlValue(),
    apiKey: (process.env.ANI_API_KEY || "").trim() || null,
    enabled: (process.env.ANI_PROVIDER_ENABLED || "").trim() === "1",
    percent: percentValue(),
    dubEnabled: (process.env.ANI_DUB_ENABLED || "").trim() === "1",
    timeoutMs: intValue("ANI_API_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxConcurrency: clamp(
      intValue("ANI_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY),
      1,
      16,
    ),
    ratePerMin: clamp(
      intValue("ANI_RATE_PER_MIN", DEFAULT_RATE_PER_MIN),
      1,
      MAX_RATE_PER_MIN,
    ),
  };
}

/** Everything the provider needs to be callable at all. */
export function aniReady(config: AniConfig = aniConfig()) {
  return config.enabled && config.baseUrl !== null && config.apiKey !== null;
}

/**
 * Stable 0-99 bucket for one anime (FNV-1a over the anilist id).
 *
 * Stability is the whole point of a gradual rollout: the same anime always
 * lands in the same bucket, so a viewer never flips between providers on
 * refresh, and raising the percentage only ever adds anime.
 */
export function aniBucket(anilistId: number | string): number {
  const key = String(anilistId);
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function aniRolloutAllows(
  anilistId: number | string,
  config: AniConfig = aniConfig(),
): boolean {
  if (config.percent >= 100) return true;
  if (config.percent <= 0) return false;
  return aniBucket(anilistId) < config.percent;
}
