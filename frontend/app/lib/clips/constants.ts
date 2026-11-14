// Prompt 35: link-based clips.
//
// A clip is a POINTER to a time range of an episode (`/clip/{code}` or
// `/watch/{id}?ep={n}&t={start}&end={end}`). No video file is cut, downloaded
// or re-uploaded: playing a clip plays that range of the normal stream.
//
// Every limit lives here so the player panel, the API routes and the tests read
// the same numbers.

/** Shortest clip we accept (seconds). */
export const CLIP_MIN_SECONDS = 3;
/** Longest clip a guest may create (seconds). */
export const CLIP_MAX_SECONDS_GUEST = 60;
/** Longest clip a signed-in user may create (seconds). */
export const CLIP_MAX_SECONDS_USER = 120;
/** Quick mode's default length: start captured, end = start + 15 s. */
export const CLIP_DEFAULT_SECONDS = 15;
/** Optional clip title, plain text. */
export const CLIP_TITLE_MAX_LENGTH = 80;

/** URL-safe, unambiguous: no 0/o/1/i/l to misread when typed by hand. */
export const CLIP_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const CLIP_CODE_LENGTH = 7;
/** Insert attempts before giving up on finding a free code. */
export const CLIP_CODE_ATTEMPTS = 8;

/** Guests prove ownership of their clips with this first-party cookie. */
export const CLIP_OWNER_COOKIE = "kumori_clip_owner";
export const CLIP_OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
/** Session cookie listing the clips this browser already counted a view for. */
export const CLIP_SEEN_COOKIE = "kumori_clip_seen";
export const CLIP_SEEN_MAX_CODES = 20;

/** Sliding-window limits for clip creation. */
export const CLIP_RATE_WINDOW_MS = 60 * 60 * 1000;
export const CLIP_RATE_GUEST = 10;
export const CLIP_RATE_USER = 60;
/** Reporting a clip is cheap, so it gets its own small budget. */
export const CLIP_REPORT_RATE = 5;

/** Hosting paths, built in one place. */
export const clipPath = (code: string) => `/clip/${code}`;
export const watchPath = (anilistId: number, episode: number) =>
  `/watch/${anilistId}?ep=${episode}`;

/** `?t=&end=` on a watch URL is validated against the same ceiling. */
export const WATCH_RANGE_MAX_SECONDS = CLIP_MAX_SECONDS_USER;

/** How many clips `/clips` shows in one page. */
export const CLIPS_PAGE_SIZE = 50;
/** How many clips the community composer's picker offers. */
export const CLIP_MINE_LIMIT = 20;
