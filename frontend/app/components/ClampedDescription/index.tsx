"use client";
// ONE clamped synopsis for every card that shows one: the header drop-downs
// (Anime/Manga of the Day), the home featured blocks and "Newest Anime
// Episodes". Copies of this markup are how the drop-downs once grew taller than
// a phone screen.

import React from "react";
import styles from "./component.module.css";
import { cleanDescription } from "@/app/lib/text/description";

export type ClampedDescriptionProps = {
  text: unknown;
  /** Rendered when there is nothing to say. */
  fallback?: string;
  className?: string;
  /** Mobile is always 4 lines; this only changes wider screens. */
  desktopLines?: 4 | 5;
};

export default function ClampedDescription({
  text,
  fallback = "Description not available.",
  className,
  desktopLines = 5,
}: ClampedDescriptionProps) {
  const clean = cleanDescription(text);
  return (
    <div
      className={`${styles.clamp} ${desktopLines === 4 ? styles.four : ""} ${className || ""}`}
      data-clamped-description="true"
      title={clean || undefined}
    >
      {clean || fallback}
    </div>
  );
}
