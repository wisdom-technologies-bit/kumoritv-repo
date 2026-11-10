"use client";
// Two rows under the timeline: what just landed here, and what has not started
// yet. Both are plain poster rows, no horizontal page overflow.
import Link from "next/link";
import styles from "../schedule.module.css";
import { COVER_PLACEHOLDER, episodeLabel, scheduleTitle } from "@/app/lib/schedule/format";
import { localTimeLabel } from "@/app/lib/schedule/local";
import type { ScheduleItem, ScheduleMedia } from "@/app/lib/schedule/types";

export function JustReleasedRow({
  items,
  timeZone,
  mounted,
}: {
  items: ScheduleItem[];
  timeZone: string;
  mounted: boolean;
}) {
  if (!items.length) return null;
  return (
    <section className={styles.section} aria-labelledby="just-released-heading">
      <div className={styles.section_head}>
        <h2 id="just-released-heading" className={styles.section_title}>
          Just released - watch now
        </h2>
        <span className={styles.section_hint}>Aired in the last 24 hours</span>
      </div>
      <ul className={styles.poster_row}>
        {items.map((item) => (
          <li className={styles.poster_tile} key={`${item.media.id}-${item.episode}`}>
            <Link href={`/media/${item.media.id}`} className={styles.upnext_poster}>
              <img
                src={item.media.coverImage?.large || COVER_PLACEHOLDER}
                alt=""
                width={112}
                height={168}
                loading="lazy"
                decoding="async"
              />
            </Link>
            <Link href={`/media/${item.media.id}`} className={styles.card_title_text}>
              {scheduleTitle(item.media)}
            </Link>
            <span className={styles.card_sub}>
              {episodeLabel(item.episode, item.media)}
              {mounted ? ` · ${localTimeLabel(item.airingAt, timeZone)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PremieringRow({ items }: { items: ScheduleMedia[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.section} aria-labelledby="premiering-heading">
      <div className={styles.section_head}>
        <h2 id="premiering-heading" className={styles.section_title}>
          Premiering soon
        </h2>
        <span className={styles.section_hint}>Next 30 days</span>
      </div>
      <ul className={styles.poster_row}>
        {items.map((media) => (
          <li className={styles.poster_tile} key={media.id}>
            <Link href={`/media/${media.id}`} className={styles.upnext_poster}>
              <img
                src={media.coverImage?.large || COVER_PLACEHOLDER}
                alt=""
                width={112}
                height={168}
                loading="lazy"
                decoding="async"
              />
            </Link>
            <Link href={`/media/${media.id}`} className={styles.card_title_text}>
              {scheduleTitle(media)}
            </Link>
            <span className={styles.card_sub}>{media.format ?? "Anime"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
