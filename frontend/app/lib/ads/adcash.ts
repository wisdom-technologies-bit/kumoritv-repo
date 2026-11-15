/**
 * Adcash Autotag: the site's only ad integration (Prompt 39B, 2026-11-15).
 *
 * Everything here is pure and testable. The env is never read at module scope,
 * so nothing is baked in at build time and no server-only value can leak into a
 * client bundle: the root layout reads `process.env` per render and passes the
 * three values to <AdcashTag> as props.
 *
 * The official snippet is two steps in order (verbatim copy in docs/ads-adcash.md):
 *   1. <script id="aclib" src="//acscdn.com/script/aclib.js"></script>
 *   2. aclib.runAutoTag({ zoneId: 'wdslld7xas' });
 * This module provides the constants and the guard that keeps step 2 to exactly
 * one call per full page load.
 */

/** The owner's Autotag zone for https://kumoritv.top. */
export const ADCASH_DEFAULT_ZONE_ID = "wdslld7xas";

/** https, never the protocol-relative `//acscdn.com/...` form from the snippet. */
export const ADCASH_SCRIPT_SRC = "https://acscdn.com/script/aclib.js";

/** Step 1's element id, which is also what the browser check looks for. */
export const ADCASH_SCRIPT_ID = "aclib";

/**
 * Pages that never load the tag. `/api` is not a page (nothing renders there),
 * `/admin` is the owner's dashboard, `/community-off` is the 404 the community
 * gate rewrites to and `/notifications/welcome` is the post-signup prompt.
 */
export const ADCASH_DEFAULT_EXCLUDE_PATHS = [
  "/admin",
  "/api",
  "/community-off",
  "/notifications/welcome",
];

export type AdcashConfig = {
  enabled: boolean;
  zoneId: string;
  excludePaths: string[];
};

/** `ADCASH_ENABLED` is opt-in: anything but 1/true/yes/on keeps ads off. */
export function adcashEnabledFrom(raw: string | undefined): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** `ADCASH_ZONE_ID`, or the owner's zone when the variable is empty. */
export function adcashZoneIdFrom(raw: string | undefined): string {
  const value = String(raw ?? "").trim();
  return value || ADCASH_DEFAULT_ZONE_ID;
}

/** `ADCASH_EXCLUDE_PATHS` (comma list); empty falls back to the defaults. */
export function adcashExcludePathsFrom(raw: string | undefined): string[] {
  const list = String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [...ADCASH_DEFAULT_EXCLUDE_PATHS];
}

/**
 * `/admin` excludes `/admin` and everything under it, but never `/admin-tools`
 * by accident, and a trailing slash in either list or URL makes no difference.
 */
export function isAdcashExcludedPath(
  pathname: string | null | undefined,
  excludePaths: string[] = ADCASH_DEFAULT_EXCLUDE_PATHS,
): boolean {
  if (typeof pathname !== "string" || pathname === "") return false;
  const path = normalizePath(pathname);
  return excludePaths.some((entry) => {
    const prefix = normalizePath(entry);
    if (!prefix) return false;
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

function normalizePath(value: string): string {
  const withSlash = value.trim().toLowerCase();
  if (!withSlash) return "";
  const trimmed = withSlash.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Reads the three variables through a getter so the caller decides when (the
 * layout reads `process.env` per render, the tests read a fixed map).
 */
export function readAdcashConfig(
  get: (name: string) => string | undefined,
): AdcashConfig {
  return {
    enabled: adcashEnabledFrom(get("ADCASH_ENABLED")),
    zoneId: adcashZoneIdFrom(get("ADCASH_ZONE_ID")),
    excludePaths: adcashExcludePathsFrom(get("ADCASH_EXCLUDE_PATHS")),
  };
}

type AdcashLibrary = { runAutoTag?: (options: { zoneId: string }) => unknown };
type AdcashWindow = { aclib?: AdcashLibrary };

/**
 * One Autotag per full page load, whatever fires it.
 *
 * next/script can call both `onReady` and `onLoad` for the same element, React
 * strict mode can run effects twice, and a client-side navigation can remount
 * the component. This flag is module state, so the second call is a no-op
 * instead of a second ad request. A missing or broken library returns false and
 * never throws into the page.
 */
let autoTagStarted = false;

export function resetAdcashForTests(): void {
  autoTagStarted = false;
}

export function adcashAutoTagStarted(): boolean {
  return autoTagStarted;
}

/** Step 2 of the official snippet, made safe to call from anywhere. */
export function runAdcashAutoTag(
  zoneId: string,
  win: AdcashWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as unknown as AdcashWindow),
): boolean {
  if (autoTagStarted) return false;
  const library = win?.aclib;
  if (!library || typeof library.runAutoTag !== "function") return false;
  if (!zoneId) return false;
  // Set first: two synchronous callers in the same tick must not both run it.
  autoTagStarted = true;
  try {
    library.runAutoTag({ zoneId });
    return true;
  } catch {
    // A broken ad library is not a page error: swallow it and carry on.
    return false;
  }
}
