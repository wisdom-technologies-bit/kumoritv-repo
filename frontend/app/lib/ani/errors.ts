import "server-only";

/**
 * One closed vocabulary of reason codes.
 *
 * These strings are the only thing an ani outcome may ever be described by: in
 * the trace, in the admin status ring and in a log line. No upstream URL, no
 * upstream message, no header and above all no API key is ever part of them, so
 * a reason code can be printed without thinking about it.
 */
export type AniReason =
  // skipped: the provider was never called
  | "disabled"
  | "not_configured"
  | "percent_out"
  | "provider_pinned"
  | "excluded"
  | "audio_unsupported"
  | "no_mal_id"
  | "breaker_open"
  | "paused"
  | "saturated"
  // failed: the provider was called (or its answer was unusable)
  | "auth"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "upstream_error"
  | "http_error"
  | "invalid_body"
  | "mal_not_found"
  | "mal_not_mapped"
  | "mal_ambiguous"
  | "mal_episode_not_found"
  | "mal_episode_mismatch"
  | "mal_title_source"
  | "unverified_stream"
  | "stream_mismatch"
  | "not_hls"
  | "master_host_not_allowed"
  | "no_playable_variant"
  | "probe_failed"
  | "internal_error";

/** Reason codes that mean "this title has no verified mapping", not "we are down". */
export const PERMANENT_MAL_REASONS: AniReason[] = [
  "mal_not_found",
  "mal_not_mapped",
  "mal_ambiguous",
  "mal_episode_not_found",
];

export class AniProviderError extends Error {
  readonly reason: AniReason;
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(
    reason: AniReason,
    options: { status?: number; retryAfterMs?: number | null } = {},
  ) {
    // The message is the reason code. Nothing interpolated, so an upstream body
    // (which could contain anything) can never leak through it.
    super(reason);
    this.name = "AniProviderError";
    this.reason = reason;
    this.status = options.status ?? 0;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/**
 * Read the upstream error code.
 *
 * The prompt says `detail.code`, but the service as implemented returns an
 * RFC-9457-ish body that is FLAT: `{code, title, stage, provider, retryable,
 * retry_after, detail, status, instance, request_id}` (see
 * api/src/ani_api/services/security.py `problem_body`). The nested form is
 * accepted as a fallback so a future change on the API side cannot silently
 * turn every error into "http_error".
 */
export function upstreamErrorCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const flat = (body as { code?: unknown }).code;
  if (typeof flat === "string" && flat) return flat.toUpperCase();
  const nested = (body as { detail?: { code?: unknown } }).detail?.code;
  return typeof nested === "string" ? nested.toUpperCase() : "";
}

const ERROR_CODE_REASONS: Record<string, AniReason> = {
  MAL_NOT_FOUND: "mal_not_found",
  MAL_NOT_MAPPED: "mal_not_mapped",
  MAL_MAPPING_AMBIGUOUS: "mal_ambiguous",
  MAL_EPISODE_NOT_FOUND: "mal_episode_not_found",
  MAL_EPISODE_MISMATCH: "mal_episode_mismatch",
  MAL_TITLE_SOURCE_DISABLED: "mal_title_source",
  MAL_TITLE_SOURCE_UNAVAILABLE: "mal_title_source",
  UNAUTHORIZED: "auth",
  AUTH_NOT_CONFIGURED: "auth",
  BAD_SIGNATURE: "auth",
  RATE_LIMITED: "rate_limited",
};

export function reasonForErrorCode(code: string): AniReason | null {
  return ERROR_CODE_REASONS[code] ?? null;
}
