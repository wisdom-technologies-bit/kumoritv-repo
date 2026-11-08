"use client";

// Clamps long rich text to a few lines and reveals the rest behind a
// "Read more" toggle.
//
// The full copy always stays in the DOM: the clamp is a CSS
// `-webkit-line-clamp`, never a shortened string, so crawlers and screen
// readers still get every paragraph. The toggle only renders when the text
// really overflows, which is measured (never guessed) and re-measured on
// resize.

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./component.module.css";

export default function ExpandableText({
  children,
  id,
  className,
}: {
  children: React.ReactNode;
  /** Optional id for the clamped box; generated when omitted. */
  id?: string;
  className?: string;
}) {
  const generatedId = useId();
  const contentId = `expandable-${id || generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Only measure while collapsed: an expanded box has no clamp left to compare
  // `scrollHeight` with.
  const measure = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;

    setOverflows(node.scrollHeight - node.clientHeight > 1);
  }, []);

  useLayoutEffect(() => {
    if (expanded) return;
    measure();
  }, [children, expanded, measure]);

  useEffect(() => {
    const node = contentRef.current;
    if (!node || expanded) return;

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(() => measure());
    observer.observe(node);

    return () => observer.disconnect();
  }, [expanded, measure]);

  const canExpand = expanded || overflows;

  return (
    <div
      className={[styles.container, className].filter(Boolean).join(" ")}
      data-expanded={expanded}
      data-clamped={canExpand && !expanded}
    >
      <div id={contentId} ref={contentRef} className={styles.content}>
        {children}
      </div>

      {canExpand && !expanded ? <span className={styles.fade} aria-hidden="true" /> : null}

      {canExpand ? (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
