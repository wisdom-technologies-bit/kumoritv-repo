"use client";
// "Up next": the next six episodes, as big 2:3 posters with a live countdown.
// Horizontal scroll-snap on phones, a plain row on desktop.
import Link from "next/link";
import styles from "../schedule.module.css";
import { COVER_PLACEHOLDER, episodeLabel, scheduleTitle, watchHref } from "@/app/lib/schedule/format";
import { localTimeLabel, statusOf } from "@/app/lib/schedule/local";
import type { ScheduleItem } from "@/app/lib/schedule/types";

export default function UpNextStrip({
  items,
  timeZone,
  now,
  mounted,
}: {
  items: ScheduleItem[];
  timeZone: string;
  now: number;
  mounted: boolean;
}) {
  if (!items.length) return null;

  return (
    <section className={styles.section} aria-labelledby="up-next-heading">
      <div className={styles.section_head}>
        <h2 id="up-next-heading" className={styles.section_title}>
          Up next
        </h2>
        <span className={styles.section_hint}>Next 6 episodes</span>
      </div>

      <ul className={styles.upnext_scroller} data-testid="up-next-strip">
        {items.map((item, index) => {
          const status = statusOf(item.airingAt, now);
          return (
            <li key={`${item.media.id}-${item.episode}`} className={styles.upnext_card}>
              <Link href={`/media/${item.media.id}`} className={styles.upnext_poster}>
                <img
                  src={item.media.coverImage?.large || item.media.coverImage?.extraLarge || COVER_PLACEHOLDER}
                  alt=""
                  width={186}
                  height={279}
                  loading={index === 0 ? "eager" : "lazy"}
                  decoding="async"
                />
                <span className={styles.upnext_badge}>EP {item.episode}</span>
                <span className={styles.upnext_time} data-testid="up-next-countdown">
                  {mounted ? `${localTimeLabel(item.airingAt, timeZone)} - ${status.label}` : "\u00a0"}
                </span>
              </Link>

              <div className={styles.upnext_meta}>
                <Link href={`/media/${item.media.id}`} className={styles.card_title_text}>
                  {scheduleTitle(item.media)}
                </Link>
                <span className={`${styles.muted} ${styles.card_title_text}`}>
                  {episodeLabel(item.episode, item.media)}
                </span>
                {item.available ? (
                  <Link href={watchHref(item.media.id, item.episode)} className={styles.action} data-primary="true">
                    Watch
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
