// Prompt 35: the optional clip title.
//
// Same profanity handling the comment composer already uses (bad-words), plus
// the two checks a free-text field always needs: control characters out, length
// capped. The result is plain text - the UI renders it as text, never as HTML.

import Filter from "bad-words";
import { CLIP_TITLE_MAX_LENGTH } from "./constants";

let filter: Filter | null = null;

function swearFilter(): Filter | null {
  try {
    filter ??= new Filter();
    return filter;
  } catch {
    return null;
  }
}

// C0/C1 controls (newlines and tabs included: a title is one line).
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]+/g;

export type ClipTitleResult =
  | { ok: true; title: string | null }
  | { ok: false; error: "title_invalid" | "title_too_long"; message: string };

/** Returns null for "no title" instead of an error: the field is optional. */
export function normaliseClipTitle(input: unknown): ClipTitleResult {
  if (input === null || input === undefined) return { ok: true, title: null };
  if (typeof input !== "string") {
    return { ok: false, error: "title_invalid", message: "That title is not valid text." };
  }

  const cleaned = input.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return { ok: true, title: null };

  let safe = cleaned;
  const bad = swearFilter();
  if (bad) {
    try {
      safe = bad.clean(cleaned).replace(/\s+/g, " ").trim();
    } catch {
      safe = cleaned;
    }
  }

  if (safe.length > CLIP_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      error: "title_too_long",
      message: `Titles can be up to ${CLIP_TITLE_MAX_LENGTH} characters.`,
    };
  }

  return { ok: true, title: safe || null };
}
