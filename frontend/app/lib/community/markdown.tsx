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
// The component is imported ONLY by the announcement page, the index preview and
// the admin composer, so the renderer is code-split out of the rest of the site.

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./markdown.module.css";

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

export default function AnnouncementMarkdown({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  return (
    <div className={`${styles.body}${className ? ` ${className}` : ""}`} data-markdown-body="true">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
