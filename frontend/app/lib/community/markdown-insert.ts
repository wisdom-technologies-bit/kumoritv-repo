// Phase 4, part B2: the composer toolbar as a pure function.
//
// `insertMarkdown` takes what the textarea has and returns what it should have
// plus where the caret goes, so the toolbar works on desktop and on a phone, and
// can be tested without a browser.

export type MarkdownCommand = "heading" | "bold" | "italic" | "link" | "list" | "quote";

export type InsertResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export function insertMarkdown(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: MarkdownCommand,
): InsertResult {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const atLineStart = start === 0 || value[start - 1] === "\n";

  const wrap = (prefix: string, suffix: string, placeholder: string): InsertResult => {
    const body = selected || placeholder;
    const next = `${before}${prefix}${body}${suffix}${after}`;
    return {
      value: next,
      selectionStart: start + prefix.length,
      selectionEnd: start + prefix.length + body.length,
    };
  };

  switch (command) {
    case "bold":
      return wrap("**", "**", "bold text");
    case "italic":
      return wrap("*", "*", "italic text");
    case "link": {
      const label = selected || "link text";
      // A trailing space keeps typing inside the brackets off the URL.
      const inserted = `[${label}](https://)`;
      const next = `${before}${inserted}${after}`;
      const urlStart = start + 1 + label.length + 2;
      return { value: next, selectionStart: urlStart, selectionEnd: urlStart + 8 };
    }
    case "heading": {
      const prefix = atLineStart ? "## " : "\n\n## ";
      const inserted = `${prefix}${selected || "Heading"}`;
      const next = `${before}${inserted}${after}`;
      return {
        value: next,
        selectionStart: start + prefix.length,
        selectionEnd: start + prefix.length + (selected || "Heading").length,
      };
    }
    case "list": {
      const prefix = atLineStart ? "- " : "\n\n- ";
      const inserted = `${prefix}${selected || "List item"}`;
      const next = `${before}${inserted}${after}`;
      return {
        value: next,
        selectionStart: start + prefix.length,
        selectionEnd: start + prefix.length + (selected || "List item").length,
      };
    }
    case "quote": {
      const prefix = atLineStart ? "> " : "\n\n> ";
      const inserted = `${prefix}${selected || "Quote"}`;
      const next = `${before}${inserted}${after}`;
      return {
        value: next,
        selectionStart: start + prefix.length,
        selectionEnd: start + prefix.length + (selected || "Quote").length,
      };
    }
    default:
      return { value, selectionStart: start, selectionEnd: end };
  }
}
