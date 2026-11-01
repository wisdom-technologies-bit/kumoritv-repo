// Pure rules the push cron (and the tests) rely on. No Supabase, no fetch.

export type OutboxKind = "episode" | "digest" | "reply" | "like" | "mention" | "announcement";

/** At most one digest per user in this window. */
export const DIGEST_WINDOW_MS = 3 * 60 * 60 * 1000;
/** At most one like push per comment in this window (matches the SQL key). */
export const LIKE_WINDOW = "hour" as const;
/** Titles named in a digest body before it says "and N more". */
export const DIGEST_TITLE_LIMIT = 3;

export type PreferenceFlags = {
  enabled: boolean;
  replies: boolean;
  likes: boolean;
  mentions: boolean;
  announcements: boolean;
  newEpisodesAll: boolean;
  newEpisodesSubscribed: boolean;
};

/**
 * Mirrors `public.push_allowed(user, kind)`: is this kind of push wanted right
 * now? The cron re-checks it at send time, because a row can wait in the outbox
 * while the user turns the toggle off.
 */
export function preferenceAllows(kind: OutboxKind, prefs: PreferenceFlags | null | undefined): boolean {
  if (!prefs || prefs.enabled !== true) return false;

  switch (kind) {
    case "reply":
      return prefs.replies === true;
    case "like":
      return prefs.likes === true;
    case "mention":
      return prefs.mentions === true;
    case "announcement":
      return prefs.announcements === true;
    case "episode":
      return prefs.newEpisodesSubscribed === true;
    case "digest":
      return prefs.newEpisodesAll === true;
    default:
      return false;
  }
}

/** One web push topic per kind, so repeats replace each other on the device. */
export const PUSH_TOPICS: Record<OutboxKind, string> = {
  episode: "kumori-episode",
  digest: "kumori-digest",
  reply: "kumori-replies",
  like: "kumori-likes",
  mention: "kumori-mentions",
  announcement: "kumori-announcement",
};

/** `YYYYMMDDHH` in UTC, the same bucket the SQL trigger uses. */
export function hourBucket(at: number): string {
  const date = new Date(at);

  return [
    date.getUTCFullYear(),
    `${date.getUTCMonth() + 1}`.padStart(2, "0"),
    `${date.getUTCDate()}`.padStart(2, "0"),
    `${date.getUTCHours()}`.padStart(2, "0"),
  ].join("");
}

/** Same key for every like on one comment inside the same hour. */
export function likePushDedupeKey(commentId: string, at: number): string {
  return `like:${commentId}:${hourBucket(at)}`;
}

/** True when the user may get another digest now. */
export function digestAllowed(lastSentAt: string | null | undefined, now: number): boolean {
  if (!lastSentAt) return true;

  const last = Date.parse(lastSentAt);
  if (!Number.isFinite(last)) return true;

  return now - last >= DIGEST_WINDOW_MS;
}

/** Stable per user per digest window, so a retried run cannot send twice. */
export function digestDedupeKey(userId: string, at: number): string {
  return `digest:${userId}:${hourBucket(at)}`;
}

export function digestTitle(count: number): string {
  return count === 1 ? "1 new episode on KumoriTV" : `${count} new episodes on KumoriTV`;
}

/** "A, B, C and 4 more" — at most three titles, per the prompt. */
export function digestBody(titles: string[], count: number): string {
  const named = (titles ?? []).filter((title) => typeof title === "string" && title.trim().length > 0);
  const shown = named.slice(0, DIGEST_TITLE_LIMIT);
  const remaining = Math.max(0, count - shown.length);

  if (!shown.length) return digestTitle(count);
  if (!remaining) return shown.join(", ");

  return `${shown.join(", ")} and ${remaining} more`;
}

/** Never push adult-flagged anime to a user who hides adult content. */
export function isAdultPushAllowed(input: { isAdult: boolean | null | undefined; showAdult: boolean | null | undefined }): boolean {
  return input.isAdult !== true || input.showAdult === true;
}

/** An announcement is pushed once, and only while it is still visible. */
export function shouldPushAnnouncement(
  row: { push_sent_at?: string | null; expires_at?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!row) return false;
  if (row.push_sent_at) return false;
  if (!row.expires_at) return true;

  const expires = Date.parse(row.expires_at);
  return !Number.isFinite(expires) ? true : expires > now;
}

/** `/watch/1234?ep=5` -> 1234. Used to re-check the adult flag at send time. */
export function episodeAnilistIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;

  const match = /^\/watch\/(\d+)/.exec(url) ?? /\/watch\/(\d+)/.exec(url);
  if (!match) return null;

  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}
