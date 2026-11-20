// Renders a title as three spans, one per language, and lets CSS show the one the
// visitor picked.
//
// Why not render only the chosen title? Cards and rails sit on pages that Next or
// Cloudflare may cache, and a per-user cookie cannot change cached HTML. All three
// strings are in the HTML; an inline script sets `data-title-lang` on <html>
// before paint, and CSS reveals the matching span. No flash, no per-user cache
// key, no hydration cost (this component has no state and no "use client").

import React from "react";
import { TITLE_LANGUAGES, titleVariants, type TitleInput } from "./index";

type AnimeTitleProps = {
  titles: TitleInput;
  /** The element that wraps the spans. Defaults to a span. */
  as?: "span" | "h1" | "h2" | "h3" | "h4" | "p" | "strong";
  className?: string;
  id?: string;
  /** Adds the secondary name (native by default) after the main one. */
  secondary?: boolean;
  secondaryClassName?: string;
};

export default function AnimeTitle({
  titles,
  as: Tag = "span",
  className,
  id,
  secondary = false,
  secondaryClassName,
}: AnimeTitleProps) {
  const variants = titleVariants(titles);

  return (
    <Tag className={className} id={id} data-anime-title="">
      {TITLE_LANGUAGES.map((language) => (
        <span
          key={language}
          data-title-lang={language}
          lang={language === "native" ? "ja" : undefined}
        >
          {variants[language]}
        </span>
      ))}
      {/* The secondary line is the "other" name: native when the main title is
          romaji or English, romaji when the main title is native. CSS picks. */}
      {secondary &&
        (["native", "romaji"] as const).map((language) => (
          <span
            key={`secondary-${language}`}
            className={secondaryClassName}
            data-anime-title-secondary=""
            data-title-lang={language}
            lang={language === "native" ? "ja" : undefined}
          >
            {variants[language]}
          </span>
        ))}
    </Tag>
  );
}
