"use client";

// The slim jump bar under the media hero: plain in-page links to the sections
// that exist for this title.
//
// It is deliberately NOT a tab strip: every section stays rendered in the page
// (SEO, comments, deep links all keep working). This component only adds an
// active highlight and smooth scrolling, and degrades to plain anchors without
// JavaScript or IntersectionObserver.

import React, { useEffect, useRef, useState } from "react";
import styles from "./component.module.css";

export type SectionNavItem = {
  /** Anchor target id, also used as the href fragment. */
  id: string;
  label: string;
};

export default function SectionNav({ items }: { items: SectionNavItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id || "");
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => node !== null);

    if (!sections.length) return;

    // Track how much of each section is on screen and keep the closest one to
    // the top of the viewport highlighted.
    const visible = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.set(id, entry.intersectionRatio);
          else visible.delete(id);
        }

        const next = items.map((item) => item.id).find((id) => visible.has(id));

        if (next) setActiveId(next);
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: [0, 0.15, 0.5] },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, [items]);

  // Keep the active pill in view inside the horizontally scrollable bar.
  useEffect(() => {
    const list = listRef.current;
    const pill = list?.querySelector<HTMLElement>(`[data-section="${activeId}"]`);
    if (!list || !pill || typeof list.scrollWidth !== "number") return;
    if (list.scrollWidth <= list.clientWidth) return;

    const target = pill.offsetLeft - list.clientWidth / 2 + pill.clientWidth / 2;

    if (typeof list.scrollTo === "function") {
      list.scrollTo({ left: Math.max(target, 0), behavior: "smooth" });
    }
  }, [activeId]);

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    // Let the browser handle modified clicks (new tab, download, ...).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }

    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, "", `#${id}`);
    }

    setActiveId(id);
  }

  if (!items.length) return null;

  return (
    <nav id={styles.container} aria-label="Jump to a section">
      <ul ref={listRef}>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              data-section={item.id}
              data-active={activeId === item.id}
              aria-current={activeId === item.id ? "true" : undefined}
              onClick={(event) => handleClick(event, item.id)}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
