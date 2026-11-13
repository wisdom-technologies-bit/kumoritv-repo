import "server-only";
import type { AniSubtitleTrack } from "./types";

/**
 * ani-api subtitle tracks -> the shape the watch route and the player already use
 * (`{id, label, lang, kind, default, url}` in app/lib/watch/subtitles.ts).
 *
 * Differences from the Anivexa normaliser, on purpose:
 *  - `lang` is the API's own `language` (a label-derived code, "und" when the
 *    label names no language). It is NOT re-derived from the label here: the API
 *    already did that work, and it reports "und" honestly.
 *  - `label` is the provider's label verbatim, so the CC menu reads "English",
 *    "Arabic", "Portuguese - Brazil" exactly as the source lists them.
 *  - Only tracks the API marks `playable` are shown. A sprite/metadata track is
 *    never playable, so thumbnails cannot leak into the menu as subtitles.
 *  - Nothing is marked verified, ever: the API states `language_verified:false`
 *    on every track and the audio language is likewise unverified.
 *
 * Ordering: the provider's default first, then the viewer's `sublang`, then
 * English, then everything else in the provider's own order.
 */

export type PublicSubtitle = {
  id: string;
  label: string;
  lang: string;
  kind: string;
  default: boolean;
  url: string;
};

const KINDS = new Set(["full", "signs", "forced", "dubtitle"]);
const ENGLISH = "en";
const UNKNOWN = "und";

function normalise(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function matchesPreferred(
  track: { lang: string; label: string },
  preferred: string,
) {
  const wanted = normalise(preferred);
  if (!wanted) return false;
  const lang = normalise(track.lang);
  const label = normalise(track.label);
  return (
    lang === wanted ||
    lang.startsWith(`${wanted}-`) ||
    wanted.startsWith(`${lang}-`) ||
    label === wanted ||
    label.startsWith(`${wanted} `) ||
    label.startsWith(`${wanted}(`) ||
    label.startsWith(`${wanted} -`)
  );
}

export function mapAniSubtitles(
  tracks: AniSubtitleTrack[] | undefined,
  preferredLang: string,
): PublicSubtitle[] {
  const usable: { lang: string; label: string; kind: string; url: string; isDefault: boolean }[] =
    [];
  const seen = new Set<string>();

  for (const track of Array.isArray(tracks) ? tracks : []) {
    if (!track || typeof track.url !== "string" || !track.url.trim()) continue;
    if (track.playable !== true) continue;
    // The API's own default for `kind` is "full", so a missing value is a normal
    // subtitle; an explicit unknown/metadata kind is a thumbnail or worse.
    const kind = normalise(track.kind) || "full";
    if (!KINDS.has(kind)) continue;
    if (seen.has(track.url)) continue;
    seen.add(track.url);

    const lang = normalise(track.language) || UNKNOWN;
    const label =
      String(track.label ?? "").trim() ||
      String(track.title ?? "").trim() ||
      String(track.language_name ?? "").trim() ||
      lang;
    usable.push({ lang, label, kind, url: track.url, isDefault: track.default === true });
  }

  const rank = (item: (typeof usable)[number]) =>
    item.isDefault ? 0 : matchesPreferred(item, preferredLang) ? 1 : item.lang === ENGLISH ? 2 : 3;

  // Array.prototype.sort is stable, so equal ranks keep the provider's order.
  const ordered = usable
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);

  const defaultItem =
    ordered.find((item) => item.isDefault) ||
    ordered.find((item) => matchesPreferred(item, preferredLang) && item.kind === "full") ||
    ordered.find((item) => item.lang === ENGLISH && item.kind === "full") ||
    ordered[0];

  return ordered.map((item, index) => ({
    id: `sub-${index + 1}`,
    label: item.label,
    lang: item.lang,
    kind: item.kind,
    default: item === defaultItem,
    url: item.url,
  }));
}
