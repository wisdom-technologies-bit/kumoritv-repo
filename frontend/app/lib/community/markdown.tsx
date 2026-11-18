"use client";

// Phase 4, part B1: ONE safe Markdown renderer for announcement bodies.
//
// Choice: react-markdown + remark-gfm, and NO rehype-raw.
//   * react-markdown builds React elements; it does not inject HTML strings, so
//     there is no dangerouslySetInnerHTML anywhere in the path.
//   * rehype-raw is what would turn `raw HTML` into real nodes. It is not
//     installed, which is why `<script>` and `<img onerror>` can only ever be
//     text the parser drops.
//   * remark-gfm gives the two things the owner actually types: autolinks and
//     (incidentally) tables/strikethrough, with no extra renderer.
//   * Links are re-checked here as well as server-side: only https/http/mailto
//     survive, and anything external opens in a new tab with rel hardening.
//
// The component is imported by the announcement page, the feed card, the index,
// the bell and the admin composer, so the renderer is code-split out of the rest
// of the site. `variant="preview"` is the only variant a feed card may use.

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./markdown.module.css";
import { preparePreview } from "./preview";

/** `javascript:`, `data:`, `vbscript:` and friends never become an href. */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const value = href.trim();
  if (!value) return null;
  if (/^(https?:|mailto:)/i.test(value)) return value;
  return null;
}

function isExternal(href: string): boolean {
  return !href.startsWith("mailto:");
}

/** The full renderer: real blocks, real headings, used on the announcement page. */
const components: Components = {
  // The page keeps exactly ONE h1 - the announcement title - so a body `#`
  // becomes an h2 and everything below is demoted with it.
  h1: ({ children }) => <h2>{children}</h2>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    // A refused link keeps its words and loses its destination.
    if (!safe) return <span>{children}</span>;
    if (!isExternal(safe)) return <a href={safe}>{children}</a>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow ugc">
        {children}
      </a>
    );
  },
  // Images in a body are NOT rendered: the announcement has an `image` field.
  img: () => null,
};

/* -------------------------------------------------------------------------- */
/* The preview variant: the SAME safe rules, flattened for a feed card.        */
/* -------------------------------------------------------------------------- */

/** Inline, click-free links: used where the preview sits inside a link. */
const LINK_OFF: Components["a"] = ({ children }) => <span>{children}</span>;

/** Everything becomes an inline level element, so one line-clamp can own it. */
function previewComponents(linksAllowed: boolean): Components {
  const link: Components["a"] = linksAllowed ? components.a : LINK_OFF;
  return {
    p: ({ children }) => <span className={styles.preview_block}>{children}</span>,
    // Headings lose their size and keep their weight.
    h1: ({ children }) => <strong>{children}</strong>,
    h2: ({ children }) => <strong>{children}</strong>,
    h3: ({ children }) => <strong>{children}</strong>,
    h4: ({ children }) => <strong>{children}</strong>,
    h5: ({ children }) => <strong>{children}</strong>,
    h6: ({ children }) => <strong>{children}</strong>,
    // Lists become compact lines with a dot separator, still inline.
    ul: ({ children }) => <span>{children}</span>,
    ol: ({ children }) => <span>{children}</span>,
    li: ({ children }) => <span className={styles.preview_item}>{children}</span>,
    // A quote keeps its words, loses its chrome.
    blockquote: ({ children }) => <span className={styles.preview_block}>{children}</span>,
    // Rules and images have no place in a two-line teaser.
    hr: () => null,
    img: () => null,
    // Code is inline so it wraps instead of scrolling.
    pre: ({ children }) => <span className={styles.preview_block}>{children}</span>,
    code: ({ children }) => <code className={styles.preview_code}>{children}</code>,
    // Tables flatten to words separated by spaces.
    table: ({ children }) => <span>{children}</span>,
    thead: ({ children }) => <span>{children}</span>,
    tbody: ({ children }) => <span>{children}</span>,
    tr: ({ children }) => <span>{children}</span>,
    th: ({ children }) => <span className={styles.preview_cell}>{children}</span>,
    td: ({ children }) => <span className={styles.preview_cell}>{children}</span>,
    br: () => <span> </span>,
    a: link,
  };
}

export default function AnnouncementMarkdown({
  body,
  className,
  variant = "full",
  links = true,
  maxChars,
  maxLines,
}: {
  body: string;
  className?: string;
  /** "preview" flattens blocks, cuts the source and clamps to 4/5 lines. */
  variant?: "full" | "preview";
  /** false where the preview sits inside a link: never an anchor inside one. */
  links?: boolean;
  maxChars?: number;
  maxLines?: number;
}) {
  if (variant === "preview") {
    const preview = preparePreview(body, maxChars, maxLines);
    if (preview.plain) {
      return (
        <p className={`${styles.preview}${className ? ` ${className}` : ""}`} data-markdown-body="true">
          {preview.text}
        </p>
      );
    }
    return (
      <div
        className={`${styles.preview}${className ? ` ${className}` : ""}`}
        data-markdown-body="true"
        data-markdown-variant="preview"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={previewComponents(links)}>
          {preview.text}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className={`${styles.body}${className ? ` ${className}` : ""}`} data-markdown-body="true">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
