import "server-only";
import type { AniSubtitleTrack } from "./types";

/**
 * ani-api subtitle tracks -> the shape the watch route and the player already use
 * (`{id, label, lang, kind, default, url}` in app/lib/watch/subtitles.ts).
 *
 * Two sources behave differently and must keep doing so:
 *
 *  - ZokoAnime reports a real `language` per track, so it is used as-is.
 *  - AniKoto reports `language:"en"` on EVERY track, even when the label says
 *    Arabic/French/Thai (measured 2026-11-15: Naruto returned 9 tracks all "en",
 *    AoT returned English + Indonesian + Thai all "en"). For AniKoto the field is
 *    therefore ignored and the language is derived from the LABEL: leading word
 *    first, the variant ("Portuguese (Brazil)", "Spanish (Latin America)") kept.
 *
 * Every playable track is kept; only sprite/metadata tracks are dropped. Nothing
 * is ever marked verified: the API cannot verify a track's language.
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

/**
 * English language names -> ISO 639-1 (or a BCP-47 form for the two variants the
 * provider actually ships). The label is the only trustworthy signal AniKoto
 * gives us, so this table is the whole language detection.
 */
const LANGUAGE_CODES: Record<string, string> = {
  arabic: "ar",
  bengali: "bn",
  burmese: "my",
  chinese: "zh",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  english: "en",
  filipino: "fil",
  finnish: "fi",
  french: "fr",
  german: "de",
  greek: "el",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  indonesian: "id",
  italian: "it",
  japanese: "ja",
  khmer: "km",
  korean: "ko",
  malay: "ms",
  norwegian: "no",
  persian: "fa",
  polish: "pl",
  portuguese: "pt",
  romanian: "ro",
  russian: "ru",
  spanish: "es",
  swedish: "sv",
  tamil: "ta",
  telugu: "te",
  thai: "th",
  turkish: "tr",
  ukrainian: "uk",
  urdu: "ur",
  vietnamese: "vi",
};

function normalise(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * "Portuguese (- Portuguese(Brazil))" -> "pt-BR"
 * "Spanish (- Spanish(Latin America))"  -> "es-419"
 * "English" -> "en"
 * "Thai Signs & Songs" -> "th"
 * "English SDH" -> "en"
 * Anything unrecognised -> "und" (never a guess).
 */
export function languageFromLabel(label: unknown): string {
  const text = normalise(label).replace(/[()[\]{}|/,_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return UNKNOWN;
  const words = text.split(" ").filter(Boolean);
  // Leading language word wins ("english sdh", "arabic full").
  const lead = LANGUAGE_CODES[words[0]];
  if (!lead) return UNKNOWN;
  if (lead === "pt" && /brazil|brasil|br\b/.test(text)) return "pt-BR";
  if (lead === "pt" && /portugal|europe/.test(text)) return "pt-PT";
  if (lead === "es" && /latin america|latinoamerica|latino/.test(text)) return "es-419";
  if (lead === "es" && /spain|castilian|españa/.test(text)) return "es-ES";
  if (lead === "zh" && /traditional|hant/.test(text)) return "zh-Hant";
  if (lead === "zh" && /simplified|hans/.test(text)) return "zh-Hans";
  return lead;
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
  provider?: string,
): PublicSubtitle[] {
  const labelDerived = normalise(provider) === "anikoto";
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

    const label =
      String(track.label ?? "").trim() ||
      String(track.title ?? "").trim() ||
      String(track.language_name ?? "").trim() ||
      UNKNOWN;
    // AniKoto's `language` is a constant "en" on every track: trust the label.
    const lang = labelDerived
      ? languageFromLabel(label) || UNKNOWN
      : normalise(track.language) || UNKNOWN;
    usable.push({ lang, label, kind, url: track.url, isDefault: track.default === true });
  }

  const rank = (item: (typeof usable)[number]) =>
    item.isDefault ? 0 : matchesPreferred(item, preferredLang) ? 1 : item.lang === ENGLISH ? 2 : 3;

  // Array.prototype.sort is stable, so equal ranks keep the provider's order.
  const ordered = usable
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
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
