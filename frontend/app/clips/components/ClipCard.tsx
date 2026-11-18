"use client";

// Phase 5: one clip card, used by the public grid and by the single-column
// mobile list. Pure presentation plus two small actions (copy link, report),
// so the same card can be rendered by the server on first paint.
//
// The whole card is ONE link to /clip/{code} (the route is singular in this
// repo), and the actions live outside that link so no anchor nests in another.
// An adult clip whose viewer setting is off is a non-link placeholder: the
// server already stripped its title, thumbnail, episode and author, so there is
// nothing to draw and nothing to leak.

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import styles from "../page.module.css";
import ReportClip from "@/app/clip/[code]/components/ReportClip";
import {
  clipHref,
  episodeLine,
  formatViews,
  relativeAge,
  type BrowseItem,
} from "@/app/lib/clips/browse";

const durationLabel = (seconds: number | null) =>
  seconds == null ? "" : `${Math.round(seconds * 10) / 10}s`;

export default function ClipCard({
  item,
  showAdult,
  priority = false,
  from = "",
}: {
  item: BrowseItem;
  /** The viewer's adult-content setting; adult rows are placeholders when off. */
  showAdult: boolean;
  /** The first row above the fold loads eagerly; everything else is lazy. */
  priority?: boolean;
  /** The filters to restore when the reader comes back ("?sort=views&q=..." ). */
  from?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const path = new URL(clipHref(item.code), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (item.adult && !showAdult) {
    return (
      <article className={styles.card} data-clip-code={item.code} data-adult="placeholder">
        <div className={`${styles.thumb} ${styles.thumb_adult}`} aria-hidden="true">
          <span className={styles.adult_badge}>18+</span>
        </div>
        <div className={styles.card_body}>
          <p className={styles.card_title}>Adult content 18+</p>
          <p className={styles.card_meta}>
            Hidden by your current setting.
            <Link href="/settings" className={styles.inline_link}>
              Turn it on in settings
            </Link>
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className={styles.card} data-clip-code={item.code} data-adult={item.adult ? "true" : "false"}>
      <Link href={clipHref(item.code, from)} className={styles.card_link} aria-label={cardLabel(item)}>
        <div className={styles.thumb}>
          {item.thumb ? (
            <Image
              src={item.thumb}
              alt=""
              width={480}
              height={270}
              sizes="(max-width: 767px) 96px, (max-width: 1200px) 45vw, 320px"
              className={styles.thumb_image}
              loading={priority ? "eager" : "lazy"}
              priority={priority}
            />
          ) : (
            <span className={styles.thumb_blank} aria-hidden="true" />
          )}
          <span className={styles.play_badge} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </span>
          {item.durationSec != null ? (
            <span className={styles.duration_chip}>{durationLabel(item.durationSec)}</span>
          ) : null}
        </div>
        <div className={styles.card_body}>
          <p className={styles.card_title}>{item.animeTitle ?? "Clip"}</p>
          {item.adult ? (
            <p className={styles.card_sub}>Adult clip</p>
          ) : (
            <p className={styles.card_sub}>{episodeLine(item)}</p>
          )}
          <p className={styles.card_meta}>
            {formatViews(item.views)} views · {relativeAge(item.createdAt)}
            {item.authorName ? <span className={styles.card_author}> · {item.authorName}</span> : <span className={styles.card_author}> · Guest</span>}
          </p>
        </div>
      </Link>

      <div className={styles.card_actions}>
        <button type="button" className={styles.action} onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy link"}
        </button>
        <ReportClip code={item.code} variant="text" />
      </div>
    </article>
  );
}

/** The accessible name of the card link: never the stripped adult fields. */
function cardLabel(item: BrowseItem): string {
  if (item.adult) return "Adult clip, 18 and over";
  const parts = [item.animeTitle ?? "Clip"];
  if (item.episode != null) parts.push(`episode ${item.episode}`);
  return parts.join(", ");
}
