// Synopses arrive as AniList HTML with editorial tails glued on:
//   "<p>...</p><p>(Source: GeyeG Pictures)</p>"  /  "Note: ..."
// A card cannot render 2000 characters, so every synopsis goes through here
// first (tags stripped, tails removed) and is then clamped by CSS.

const TAG = /<[^>]*>/g;
const BLOCK_BREAK = /<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi;

/** HTML -> one plain-text paragraph. Never returns tags, never returns null. */
export function stripHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(BLOCK_BREAK, " ")
    .replace(TAG, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "(Source: MAL Rewrite)" / "(Sources: AniList, TMDB)" - including a variant in
 * brackets inside the tail - and a trailing "Note: ..." sentence.
 * Only tails are removed: a "Note:" in the middle of a synopsis is content.
 */
export function stripDescriptionTails(text: string): string {
  let output = text;

  // Anywhere: a parenthesised Source tail (it is never part of the plot).
  output = output.replace(/\s*\(\s*sources?\s*:[^()]*(?:\([^()]*\)[^()]*)*\)/gi, " ");

  // Trailing "Note: ..." (one or more sentences) up to the end. It has to start
  // a sentence, otherwise a "Note:" inside the synopsis is real content.
  output = output.replace(/(^|\.\s+)note\s*:[^]*$/i, "$1");

  // AniList's own credit line.
  output = output.replace(/\s*\[\s*written by[^\]]*\]\s*$/i, " ");

  return output.replace(/\s+/g, " ").trim();
}

/** The one function every synopsis render calls. */
export function cleanDescription(value: unknown): string {
  return stripDescriptionTails(stripHtml(value));
}
