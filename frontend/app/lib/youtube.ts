// Shared YouTube embed helpers. Every trailer surface (home hero, home banner,
// /media/[id] and the home carousel) builds its iframe from here, so the
// attributes and query parameters cannot drift apart again.
//
// Pure functions only: the embedding origin is always passed in by the caller
// (`window.location.origin` on the client, the request headers on the server),
// never read from `window` at module scope, so this file is safe during SSR and
// unit testable without a DOM.

export type TrailerRef =
  | { id?: string | null; site?: string | null }
  | null
  | undefined;

/** AniList trailer ids for YouTube are 11 characters today; be tolerant. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,15}$/;

/**
 * True only for a real YouTube trailer. AniList also returns `dailymotion`
 * trailers and sometimes a stale id, and neither can be played by the YouTube
 * player, so callers must gate the iframe on this instead of `trailer` alone.
 */
export function isYoutubeTrailer(trailer: TrailerRef): boolean {
  if (!trailer) return false;

  const site = typeof trailer.site === "string" ? trailer.site.trim().toLowerCase() : "";
  const id = typeof trailer.id === "string" ? trailer.id.trim() : "";

  return site === "youtube" && YOUTUBE_ID.test(id);
}

/** The usable YouTube id, or null when the trailer is missing or not YouTube. */
export function youtubeTrailerId(trailer: TrailerRef): string | null {
  if (!isYoutubeTrailer(trailer)) return null;

  return String(trailer && trailer.id).trim();
}

export type YoutubeEmbedOptions = {
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
  /** The embedding page's origin, e.g. `https://kumoritv.top`. */
  origin?: string | null;
};

/**
 * Builds an embed URL with the parameters YouTube requires today:
 * - `playsinline=1` so phones do not switch to the native player
 * - `rel=0` + `modestbranding=1` so no unrelated videos are offered
 * - `iv_load_policy=3` so annotations stay off
 * - `enablejsapi=1` so the page can hear `onReady` / `onError` and hide a
 *   broken player instead of leaving a black box over the artwork
 * - `origin` matching the page exactly. YouTube answers error 153 ("video
 *   player configuration error") when this is missing *and* the request has no
 *   Referer, and also when it is present but does not match the page.
 *
 * Returns an empty string for an id that cannot be a YouTube id.
 */
export function buildYoutubeEmbedSrc(
  id: string,
  options: YoutubeEmbedOptions = {}
): string {
  const videoId = typeof id === "string" ? id.trim() : "";
  if (!YOUTUBE_ID.test(videoId)) return "";

  const { autoplay = false, loop = false, controls = false, origin } = options;

  const params = [
    "rel=0",
    "modestbranding=1",
    "playsinline=1",
    "iv_load_policy=3",
    "enablejsapi=1",
    `controls=${controls ? 1 : 0}`,
  ];

  // Autoplay on current Chrome/Android only works muted, inside a frame that is
  // also granted the `autoplay` permission.
  if (autoplay) params.push("autoplay=1", "mute=1");

  // A single video loops through the player queue, hence `playlist=<id>`.
  if (loop) params.push("loop=1", `playlist=${videoId}`);

  const cleanOrigin =
    typeof origin === "string" ? origin.trim().replace(/\/+$/, "") : "";
  if (cleanOrigin) params.push(`origin=${encodeURIComponent(cleanOrigin)}`);

  return `https://www.youtube.com/embed/${videoId}?${params.join("&")}`;
}

/**
 * The iframe permission list. A cross-origin frame needs `autoplay` granted
 * explicitly or muted autoplay is still blocked on Android Chrome; `mute=1` in
 * the URL is not enough on its own.
 */
export const YOUTUBE_IFRAME_ALLOW =
  "autoplay; encrypted-media; picture-in-picture; fullscreen";

/** Send the origin only, never the full URL, to YouTube. */
export const YOUTUBE_REFERRER_POLICY = "strict-origin-when-cross-origin" as const;

/** The origin of the page we are rendering into, or "" during SSR. */
export function browserOrigin(): string {
  if (typeof window === "undefined") return "";

  return window.location?.origin || "";
}

export type PlaybackEnvironment = {
  prefersReducedMotion: boolean;
  saveData: boolean;
};

/**
 * Reads the two user settings that mean "do not start a video for me":
 * reduced motion, and the browser's data saver. Defaults to "play" so a browser
 * without either API keeps the trailers.
 */
export function readPlaybackEnvironment(): PlaybackEnvironment {
  if (typeof window === "undefined") {
    return { prefersReducedMotion: false, saveData: false };
  }

  let prefersReducedMotion = false;
  try {
    prefersReducedMotion = !!window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
  } catch {
    prefersReducedMotion = false;
  }

  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  )?.connection;
  const saveData = connection?.saveData === true;

  return { prefersReducedMotion, saveData };
}

/** Autoplay is skipped for reduced motion and data saver; the art stays. */
export function autoplayAllowed(environment: PlaybackEnvironment): boolean {
  return !environment.prefersReducedMotion && !environment.saveData;
}

export type YoutubePlayerMessage =
  | { kind: "ready"; playerState: number | null }
  | { kind: "heartbeat"; playerState: number | null }
  | { kind: "error"; code: number | null };

/**
 * YouTube player states that mean the video itself is playable: 1 playing,
 * 2 paused (autoplay blocked but the media is there) and 3 buffering. An
 * unavailable / embedding-disabled video never reaches one of these, which is
 * how a "Video unavailable" screen is told apart from a slow but healthy
 * player.
 */
export function isPlayablePlayerState(state: number | null): boolean {
  return state === 1 || state === 2 || state === 3;
}

function readPlayerState(info: unknown): number | null {
  if (!info || typeof info !== "object") return null;

  const value = (info as { playerState?: unknown }).playerState;
  if (typeof value === "number") return value;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses a message posted by the YouTube player. Only messages from
 * `https://www.youtube.com` are ever passed here (the caller checks the origin),
 * and anything unrecognised returns null.
 */
export function parseYoutubePlayerMessage(
  data: unknown
): YoutubePlayerMessage | null {
  let payload: unknown = data;

  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== "object") return null;

  const message = payload as { event?: unknown; info?: unknown };
  const event = typeof message.event === "string" ? message.event : "";

  if (event === "onError") {
    const info = message.info;
    const code =
      typeof info === "number"
        ? info
        : Number.isFinite(Number(info))
          ? Number(info)
          : null;

    return { kind: "error", code };
  }

  if (event === "onReady") {
    return { kind: "ready", playerState: readPlayerState(message.info) };
  }
  // The player only speaks after the `listening` handshake, so any of these
  // means a live player answered us (and not the error-153 configuration page).
  // Their `info.playerState` is what says whether the video is really playable:
  // the "Video unavailable" screen happily sends these with state -1.
  if (event === "initialDelivery" || event === "infoDelivery") {
    return { kind: "heartbeat", playerState: readPlayerState(message.info) };
  }

  return null;
}
