// Prompt 38F: the composer's server-gated clip preview.
//
// The composer resolves a pasted clip with the public GET /api/clips/[code]
// (Prompt 35's route). That route answers with the clip's own public data, which
// is correct for the clip page - but a community composer must not receive the
// title and anime of an adult clip when the viewer's adult-content setting is
// off, even if it intends not to draw them. So the same response carries a
// `preview` block that has already been gated here, on the server:
//
//   ordinary clip  -> { isAdult: false, hidden: false, animeTitle, anilistId,
//                       episode, start, end, title }
//   adult, off     -> { isAdult: true, hidden: true }        <- and nothing else
//   adult, on      -> the full block, with isAdult: true
//
// `clip` itself is untouched, so Prompt 35's clip page and the rename dialog
// behave exactly as before. The setting is the site's existing preference
// (profile show_adult, else the is_adult_content_enabled cookie, default off).
// It is a display preference, not age verification.

import type { AnimeSummary, ClipRow } from "@/app/lib/clips/server";
import type { AttachedClip } from "./clip-attachment";

export function buildClipPreview(
  row: ClipRow,
  summary: AnimeSummary | null,
  showAdult: boolean,
): AttachedClip {
  const isAdult = summary?.isAdult === true;
  if (isAdult && !showAdult) {
    // The masked shape carries the code (the author needs it to attach the
    // clip) and nothing a viewer could see.
    return {
      code: row.code,
      isAdult: true,
      hidden: true,
      animeTitle: null,
      anilistId: null,
      episode: null,
      start: null,
      end: null,
      title: null,
    };
  }

  const num = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    code: row.code,
    isAdult,
    hidden: false,
    animeTitle: summary?.title ?? null,
    anilistId: num(row.anilist_id),
    episode: num(row.episode_number),
    start: num(row.start_seconds),
    end: num(row.end_seconds),
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : null,
  };
}
