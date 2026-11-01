"use client";
// The heading used by every settings card (title + one-line description).

import React from "react";
import styles from "./component.module.css";

export default function SectionHeading({
  title,
  description,
  headingId,
}: {
  title: string;
  description: string;
  headingId?: string;
}) {
  return (
    <div className={styles.card_heading}>
      <h3 id={headingId}>{title}</h3>
      <p className={styles.card_description}>{description}</p>
    </div>
  );
}
