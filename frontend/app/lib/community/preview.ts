// Part B: the feed preview of an announcement body.
//
// One pure function decides what a card shows, so the renderer and the "Read
// more" affordance can never disagree:
//
//   * the SOURCE is cut at a word boundary at ~320 characters and at most 6
//     lines BEFORE Markdown is parsed, so no truncation can leave half a tag;
//   * a cut that would leave a dangling link or an unclosed `**` is repaired,
//     never rendered as raw punctuation;
//   * a body that is one enormous URL (nothing to cut at) falls back to a plain,
//     unlinked snippet instead of a broken link.
//
// The full page keeps the untouched body; only the preview is cut.

import { stripMarkdown } from "./latest";

export const PREVIEW_MAX_CHARS = 320;
export const PREVIEW_MAX_LINES = 6;

export type MarkdownPreview = { text: string; cut: boolean; plain: boolean };

/** Remove a half-written link, unclosed emphasis or a truncated bare URL. */
export function repairMarkdown(source: string): string {
  let out = source;
  // "[label](https://exa" -> drop the whole dangling link.
  out = out.replace(/\[[^\]\n]*\]\([^)\s]*$/, "");
  // "[label" -> drop it.
  out = out.replace(/\[[^\]\n]*$/, "");
  // An odd number of `**`, `__` or backticks is one unclosed marker: drop the
  // last one so the raw punctuation never reaches the screen.
  for (const marker of ["**", "__", "`"]) {
    const parts = out.split(marker).length - 1;
    if (parts % 2 === 1) {
      const index = out.lastIndexOf(marker);
      out = out.slice(0, index) + out.slice(index + marker.length);
    }
  }
  // A truncated BARE URL at the very end is not a destination any more - but a
  // complete `[label](url)` link must keep its target.
  out = out.replace(/(https?:\/\/\S*)$/, (match: string, _url: string, offset: number) => {
    const before = out.slice(Math.max(0, offset - 2), offset);
    return before === "](" ? match : "";
  });
  out = out.replace(/[*_]+$/, "");
  return out.replace(/[ \t]+$/gm, "").trimEnd();
}

export function preparePreview(
  body: string | null | undefined,
  maxChars = PREVIEW_MAX_CHARS,
  maxLines = PREVIEW_MAX_LINES,
): MarkdownPreview {
  const source = String(body ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return { text: "", cut: false, plain: false };

  const allLines = source.split("\n");
  let kept = allLines.slice(0, maxLines).join("\n");
  let cut = allLines.length > maxLines;

  if (kept.length > maxChars) {
    const slice = kept.slice(0, maxChars);
    const space = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
    if (space > maxChars * 0.5) {
      kept = slice.slice(0, space);
    } else {
      // One long word / URL: extend to its end if that is close, else cut.
      const nextBreak = kept.indexOf(" ", maxChars);
      kept = nextBreak !== -1 && nextBreak < maxChars + 600 ? kept.slice(0, nextBreak) : slice;
    }
    cut = true;
  }

  kept = repairMarkdown(kept);

  // Everything was one un-cuttable token (a giant URL): show plain text.
  if (!kept.trim() && source.trim()) {
    const plain = stripMarkdown(source);
    const text = plain.length > maxChars ? `${plain.slice(0, maxChars - 1).trimEnd()}…` : plain;
    return { text, cut: true, plain: true };
  }

  return { text: kept, cut: cut || kept.length < source.trim().length, plain: false };
}
