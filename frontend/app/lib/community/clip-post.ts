// Prompt 38F: what a clip post shows, decided once and decided on the server.
//
// Three places draw a clip: the feed card, the post page and the metadata that
// goes with them. If each one applied the adult rule itself they would drift,
// and the one that drifted would be the leak. So the rule lives here, in one
// pure function, and every caller hands the result straight to the markup:
//
//   no clip on the post          -> none          (an ordinary text post)
//   clip code, row missing/gone  -> removed       (deleted after posting)
//   adult clip, setting off      -> hidden_adult  (label only, nothing else)
//   anything else                -> live          (the clip's public fields)
//
// The masked shape carries no code. That is deliberate: a hidden adult clip has
// no link to follow and no poster to load, so a reader who is not opted in
// cannot reach the clip through the post at all.

import type { AnimeSummary, ClipRow } from "@/app/lib/clips/server";
import { ADULT_HIDDEN_TEXT, ADULT_LABEL } from "./clip-attachment";

export type ClipCard =
  | { state: "none" }
  | { state: "removed" }
  | { state: "hidden_adult"; label: string; text: string }
  | {
      state: "live";
      code: string;
      title: string | null;
      animeTitle: string | null;
      anilistId: number | null;
      episode: number | null;
      start: number;
      end: number;
      isAdult: boolean;
    };

const num = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The one place the adult rule is applied to a posted clip.
 *
 * `summary` is the anime the clip belongs to; when it is missing the clip is
 * treated as ordinary, which is the same choice Prompt 35's clip page makes -
 * an unknown anime must not silently hide a non-adult clip.
 */
export function buildClipCard(
  row: ClipRow | null,
  summary: AnimeSummary | null,
  showAdult: boolean,
): ClipCard {
  if (!row) return { state: "removed" };

  const isAdult = summary?.isAdult === true;
  if (isAdult && !showAdult) {
    return { state: "hidden_adult", label: ADULT_LABEL, text: ADULT_HIDDEN_TEXT };
  }

  return {
    state: "live",
    code: row.code,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : null,
    animeTitle: summary?.title ?? null,
    anilistId: num(row.anilist_id),
    episode: num(row.episode_number),
    start: num(row.start_seconds) ?? 0,
    end: num(row.end_seconds) ?? 0,
    isAdult,
  };
}

/** A post with no `clip_code` is a text post, whatever else it carries. */
export function clipCardFor(
  clipCode: string | null | undefined,
  row: ClipRow | null,
  summary: AnimeSummary | null,
  showAdult: boolean,
): ClipCard {
  if (!clipCode) return { state: "none" };
  return buildClipCard(row, summary, showAdult);
}

/** The heading a clip post gets when the author wrote no text of their own. */
export function clipPostHeadline(card: ClipCard): string {
  if (card.state === "hidden_adult") return ADULT_LABEL;
  if (card.state !== "live") return "Shared a clip";
  if (card.title) return card.title;
  if (card.animeTitle) return card.animeTitle;
  return "Shared a clip";
}
