// Parsing rules for "@username" mentions in comment bodies.
//
// Kept free of React and Supabase: the composer uses the query helpers, the
// comment renderer uses `splitMentions`, and the tests use all of them.
//
// The character set matches the database trigger
// (`@[A-Za-z0-9_.-]{3,30}` in prompt 21's migration) so what the picker inserts
// is exactly what `notify_comment_mentions()` will resolve.

/** Characters that may follow an "@" (same class as the SQL trigger). */
export const MENTION_CHAR = /[A-Za-z0-9_.-]/;
/** Longest token the trigger will resolve. */
export const MENTION_MAX_LENGTH = 30;
/** The search endpoint wants at least one character. */
export const MENTION_MIN_QUERY = 1;
/** The trigger never resolves more than ten people per comment. */
export const MENTION_MAX_RESULTS = 10;

export const MENTION_TOKEN_PATTERN = /@([A-Za-z0-9_.-]{1,30})/g;

export type MentionQuery = {
  /** What the user has typed after the "@" (may be empty). */
  query: string;
  /** Index of the "@" itself: the insertion start. */
  start: number;
  /** Index just past the caret, i.e. the end of the token being replaced. */
  end: number;
};

function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  return /\s/.test(text[index - 1]);
}

/**
 * The mention the caret is inside, or null.
 *
 * An "@" only opens a mention at the start of a word, so an email address or a
 * "@" in the middle of a word never triggers the picker.
 */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  if (typeof text !== "string") return null;

  const cursor = Math.max(0, Math.min(caret ?? text.length, text.length));

  let start = cursor;
  while (start > 0 && MENTION_CHAR.test(text[start - 1])) start -= 1;

  if (start === 0) return null;
  if (text[start - 1] !== "@") return null;
  if (!isWordBoundary(text, start - 1)) return null;

  const query = text.slice(start, cursor);
  if (query.length > MENTION_MAX_LENGTH) return null;

  return { query, start: start - 1, end: cursor };
}

/** Replaces the token under the caret with "@username " and returns the new caret. */
export function insertMention(
  text: string,
  mention: MentionQuery,
  username: string,
): { text: string; caret: number } {
  const handle = String(username ?? "").replace(/^@+/, "");
  const inserted = `@${handle} `;
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.end);

  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/** Every handle the trigger would resolve, trailing punctuation trimmed. */
export function mentionTokens(body: string): string[] {
  if (typeof body !== "string" || !body.includes("@")) return [];

  const found = new Set<string>();

  for (const match of body.matchAll(MENTION_TOKEN_PATTERN)) {
    const token = match[1];
    // The trigger skips the token when it does not start a word.
    const at = match.index ?? 0;
    if (!isWordBoundary(body, at)) continue;

    const trimmed = token.replace(/[._-]+$/, "");
    if (trimmed.length >= 1) found.add(trimmed);
    if (token.length >= 1) found.add(token);
  }

  return [...found];
}

export type MentionSegment = { text: string; mention: boolean };

/**
 * Splits a comment body so the renderer can highlight "@username" tokens.
 * Everything else is returned verbatim, in order.
 */
export function splitMentions(body: string): MentionSegment[] {
  if (typeof body !== "string" || body.length === 0) return [];

  const segments: MentionSegment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(MENTION_TOKEN_PATTERN)) {
    const at = match.index ?? 0;
    const token = match[0];

    // A mid-word "@" (an email, a URL) is plain text.
    if (!isWordBoundary(body, at)) continue;

    const trailing = /[._-]+$/.exec(token)?.[0] ?? "";
    const handle = trailing ? token.slice(0, token.length - trailing.length) : token;

    if (at > cursor) segments.push({ text: body.slice(cursor, at), mention: false });
    segments.push({ text: handle, mention: true });
    if (trailing) segments.push({ text: trailing, mention: false });
    cursor = at + token.length;
  }

  if (cursor < body.length) segments.push({ text: body.slice(cursor), mention: false });

  return segments;
}

/** The picker shows at most six rows. */
export const MENTION_PICKER_LIMIT = 6;
