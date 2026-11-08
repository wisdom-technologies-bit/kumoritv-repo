/**
 * One friendly sentence for every playback failure.
 *
 * The watch page receives errors from four very different places: a failed
 * JSON parse on the stream route (`Unexpected token '<', "<!DOCTYPE "...`),
 * a dead network, an HTTP failure, and HLS giving up after its own retries.
 * Users must never see any of that raw text - it is noise, and on a phone it
 * is wider than the screen. `friendlyWatchError` maps all of it to one
 * sentence, and `watchErrorCode` keeps a short machine code for
 * `console.warn` / `data-error-code` so a report is still debuggable.
 */

export type WatchErrorKind =
  | "json"
  | "network"
  | "http"
  | "hls"
  | "stream"
  | "unknown";

export type WatchErrorContext = {
  audio?: "sub" | "dub";
  hasSubAlternative?: boolean;
};

export const WATCH_ERROR_GENERIC = "This video isn't available right now.";
export const WATCH_ERROR_NETWORK =
  "This video isn't available right now. Check your connection and try again.";

const JSON_PATTERN =
  /unexpected token|not valid json|<!doctype|json\.parse|failed to execute 'json'|invalid json/i;
const NETWORK_PATTERN =
  /failed to fetch|networkerror|network error|load failed|net::|econn|etimedout|timed? ?out|offline|aborted/i;
const HTTP_PATTERN = /\bhttp\b[^\d]{0,4}\d{3}\b|\b(?:4\d\d|5\d\d)\b\s*(?:error|status)?/i;
const HLS_PATTERN =
  /stream_recovery_exhausted|hls|manifestloaderror|level_load_error|buffer_stalled|mediaerror|fatal/i;
const STREAM_PATTERN =
  /invalid_embed_url|unsupported_stream_type|stream_error|no_?source|no_?stream|not_found|episode_not_found/i;

/** Which bucket a raw message falls into. Never rendered. */
export function watchErrorKind(raw: unknown): WatchErrorKind {
  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) return "unknown";
  if (JSON_PATTERN.test(text)) return "json";
  if (NETWORK_PATTERN.test(text)) return "network";
  if (HLS_PATTERN.test(text)) return "hls";
  if (STREAM_PATTERN.test(text)) return "stream";
  if (HTTP_PATTERN.test(text)) return "http";
  return "unknown";
}

/** Short stable code for `data-error-code`, e.g. "json", "network". */
export function watchErrorCode(raw: unknown): string {
  return watchErrorKind(raw);
}

/**
 * The only string the watch page is allowed to show. It never contains any
 * part of `raw`: the text is picked from the bucket, not interpolated.
 */
export function friendlyWatchError(
  raw: unknown,
  _context: WatchErrorContext = {},
): string {
  const kind = watchErrorKind(raw);
  if (kind === "network") return WATCH_ERROR_NETWORK;
  return WATCH_ERROR_GENERIC;
}

export default friendlyWatchError;
