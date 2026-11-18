/**
 * Working without a hand-made mapping.
 *
 * A curated row in adult_sources is authoritative, but requiring one before
 * anything plays makes the provider useless on a fresh catalogue. So an episode
 * is discovered instead: search the service by the title the database holds,
 * keep only candidates above the configured score, open each candidate series,
 * and take the episode whose number matches. What survives is written back as a
 * normal mapping row, so the next request is one indexed read.
 *
 * Nothing is guessed. A weak score, a missing episode number or an unclear
 * variant means no row, and the request falls through to the usual providers.
 */

import type { AdultConfig, AdultVariant } from "./config";
import { normalizeVariant } from "./config";
import { episodeNumberFrom, videoSlugFrom } from "./mapping";
import { fetchAdultMatch, fetchAdultSeries } from "./watchhentai";

export type DiscoveredSource = {
  variant: AdultVariant;
  seriesSlug: string;
  videoSlug: string;
  title: string;
  score: number;
};

export type AnimeTitles = {
  title?: unknown;
  title_english?: unknown;
  title_romaji?: unknown;
};

/** The titles worth searching, most specific last: deduped, non-empty, max 3. */
export function titlesForDiscovery(row: AnimeTitles | null | undefined): string[] {
  const raw = [row?.title, row?.title_english, row?.title_romaji];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const title = value.trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length === 3) break;
  }
  return out;
}

/** The variant a series represents, when the source says so clearly. */
export function variantFromSeries(input: {
  title?: string | null;
  slug?: string | null;
  censored?: string | null;
}): AdultVariant | null {
  const explicit = normalizeVariant(input.censored);
  if (explicit) return explicit;
  const text = `${input.slug || ""} ${input.title || ""}`.toLowerCase();
  if (/\buncensored\b/.test(text)) return "uncensored";
  if (/\bcensored\b/.test(text)) return "censored";
  return null;
}

export type DiscoverInput = {
  config: AdultConfig;
  titles: string[];
  episode: number;
  fetchImpl?: typeof fetch;
};

/**
 * Mapped sources for one episode, best candidate per variant.
 *
 * Cost is capped on purpose: one search per title, then at most
 * `config.matchCandidates` series pages.
 */
export async function discoverAdultSources(
  input: DiscoverInput,
): Promise<DiscoveredSource[]> {
  const titles = input.titles.filter((title) => typeof title === "string" && title.trim());
  if (titles.length === 0) return [];

  const best = new Map<string, { score: number; title: string; slug: string }>();
  for (const title of titles) {
    const match = await fetchAdultMatch(input.config, title, 10, input.fetchImpl);
    if (!match.ok) continue;
    for (const candidate of match.candidates) {
      if (candidate.score < input.config.matchMinScore) continue;
      const known = best.get(candidate.slug);
      if (!known || candidate.score > known.score) {
        best.set(candidate.slug, {
          score: candidate.score,
          title: candidate.title,
          slug: candidate.slug,
        });
      }
    }
  }

  const candidates = [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, input.config.matchCandidates);

  const found = new Map<AdultVariant, DiscoveredSource>();
  for (const candidate of candidates) {
    const series = await fetchAdultSeries(input.config, candidate.slug, input.fetchImpl);
    if (!series.ok) continue;
    const variant = variantFromSeries({
      title: series.title || candidate.title,
      slug: candidate.slug,
      censored: series.censored,
    });
    if (!variant) continue;

    const match = series.episodes.find((item) => {
      const number =
        typeof item.number === "number" ? item.number : episodeNumberFrom(item.title, item.url);
      return number === input.episode;
    });
    if (!match) continue;
    const videoSlug = videoSlugFrom(match.url);
    if (!videoSlug) continue;

    const known = found.get(variant);
    if (known && known.score >= candidate.score) continue;
    found.set(variant, {
      variant,
      seriesSlug: candidate.slug,
      videoSlug,
      title: series.title || candidate.title,
      score: candidate.score,
    });
  }

  return [...found.values()];
}
