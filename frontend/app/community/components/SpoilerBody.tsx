"use client";
import { useState } from "react";
import styles from "../page.module.css";

/** The thread-page twin of the card's blur: same look, same reveal. */
export default function SpoilerBody({ body }: { body: string }) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) return <p className={styles.thread_body}>{body}</p>;

  return (
    <div className={styles.spoiler} data-revealed="false" style={{ marginTop: 14 }}>
      <div className={styles.spoiler_hidden} aria-hidden="true">
        {body}
      </div>
      <button type="button" className={styles.spoiler_overlay} onClick={() => setRevealed(true)}>
        Spoiler
        <span className={styles.spoiler_hint}>Tap to reveal</span>
      </button>
    </div>
  );
}
