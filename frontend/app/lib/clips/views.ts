// Prompt 35: "one view per session per clip".
//
// The session is a first-party cookie that lists the codes this browser already
// counted. It holds no identifier and is dropped when the browser closes.

import { CLIP_SEEN_MAX_CODES } from "./constants";
import { isClipCode } from "./code";

/** Cookie value -> codes. Anything that is not a 7-character code is dropped. */
export function readSeenCodes(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => isClipCode(item));
}

/** Adds a code, keeping the list short (the oldest drop off the front). */
export function rememberSeenCode(codes: string[], code: string): string[] {
  const next = codes.filter((item) => item !== code);
  next.push(code);
  return next.slice(-CLIP_SEEN_MAX_CODES);
}
