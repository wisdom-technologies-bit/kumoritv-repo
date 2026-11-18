/**
 * Turning a source series into mapping rows.
 *
 * The service lists episodes as "Episode 3" with a URL ending
 * `/videos/<slug>/`, so the number comes from the title and the slug comes from
 * the URL. Anything unparseable is skipped rather than guessed: a wrong mapping
 * is worse than a missing one.
 */

export type PendingMapping = {
  episode: number;
  videoSlug: string;
  title: string;
};

/** "Episode 3 Uncensored" -> 3, "Ep. 12" -> 12, otherwise null. */
export function episodeNumberFrom(title: string, url: string): number | null {
  const fromTitle = /\b(?:episode|ep)\.?\s*(\d{1,4})\b/i.exec(title || "");
  if (fromTitle) {
    const value = Number(fromTitle[1]);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  const fromUrl = /-episode-(\d{1,4})(?:-|$)/i.exec(url || "");
  if (fromUrl) {
    const value = Number(fromUrl[1]);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  return null;
}

/** `/videos/hitori-tsuma-episode-1-id-01/` -> `hitori-tsuma-episode-1-id-01`. */
export function videoSlugFrom(url: string): string | null {
  const match = /\/videos\/([^/?#]+)/i.exec(url || "");
  return match ? match[1] : null;
}

export function planSeriesMapping(
  episodes: Array<{ title?: string; url?: string }>,
): PendingMapping[] {
  const planned: PendingMapping[] = [];
  const seen = new Set<number>();
  for (const episode of episodes) {
    const videoSlug = videoSlugFrom(episode.url || "");
    if (!videoSlug) continue;
    const number = episodeNumberFrom(episode.title || "", episode.url || "");
    if (number === null || seen.has(number)) continue;
    seen.add(number);
    planned.push({ episode: number, videoSlug, title: (episode.title || "").trim() });
  }
  return planned.sort((a, b) => a.episode - b.episode);
}
