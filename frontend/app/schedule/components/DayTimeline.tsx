"use client";
// The day's releases, grouped by the viewer's local hour slots, with a time
// rail on desktop and compact rows on phones.
import Link from "next/link";
import styles from "../schedule.module.css";
import EpisodeCard from "./EpisodeCard";
import {
  COVER_PLACEHOLDER,
  episodeLabel,
  scheduleTitle,
  watchHref,
} from "@/app/lib/schedule/format";
import { groupByHourSlot, localTimeLabel, statusOf } from "@/app/lib/schedule/local";
import type { ScheduleItem } from "@/app/lib/schedule/types";

export type TimelineProps = {
  items: ScheduleItem[];
  day: string;
  now: number;
  timeZone: string;
  mounted: boolean;
  siteUrl: string;
  showJst: boolean;
  signedIn: boolean;
  view: "list" | "grid";
  nextDayWithReleases?: { day: string; count: number } | null;
  onPickDay?: (day: string) => void;
  emptyReason?: "filtered" | "none";
};

function PosterTile({ item, now, timeZone, mounted }: { item: ScheduleItem; now: number; timeZone: string; mounted: boolean }) {
  return (
    <li className={styles.grid_card}>
      <Link href={`/media/${item.media.id}`} className={styles.grid_poster}>
        <img
          src={item.media.coverImage?.large || item.media.coverImage?.extraLarge || COVER_PLACEHOLDER}
          alt=""
          width={150}
          height={225}
          loading="lazy"
          decoding="async"
        />
        <span className={styles.upnext_badge}>EP {item.episode}</span>
      </Link>
      <Link href={`/media/${item.media.id}`} className={styles.card_title_text}>
        {scheduleTitle(item.media)}
      </Link>
      <span className={styles.card_sub}>
        <span className={styles.time}>{mounted ? localTimeLabel(item.airingAt, timeZone) : "--:--"}</span>
        <span className={styles.muted}>{statusOf(item.airingAt, now).label}</span>
      </span>
      {item.available ? (
        <Link href={watchHref(item.media.id, item.episode)} className={styles.action} data-primary="true">
          Watch
        </Link>
      ) : null}
    </li>
  );
}

export default function DayTimeline(props: TimelineProps) {
  const { items, day, now, timeZone, mounted, siteUrl, showJst, signedIn, view } = props;

  if (!items.length) {
    return (
      <div className={styles.empty} id={`day-panel-${day}`} role="tabpanel" aria-labelledby={`day-tab-${day}`} data-testid="empty-day">
        <p className={styles.empty_title}>Nothing airing on this day</p>
        {props.emptyReason === "filtered" ? (
          <p className={styles.muted}>No releases match the filters on this day.</p>
        ) : props.nextDayWithReleases ? (
          <p className={styles.muted}>
            Next up:{" "}
            <button
              type="button"
              className={styles.chip}
              onClick={() => props.onPickDay?.(props.nextDayWithReleases!.day)}
            >
              {props.nextDayWithReleases.day} ({props.nextDayWithReleases.count})
            </button>
          </p>
        ) : (
          <p className={styles.muted}>No releases in this week either.</p>
        )}
      </div>
    );
  }

  if (view === "grid") {
    return (
      <ul
        className={styles.grid}
        id={`day-panel-${day}`}
        role="tabpanel"
        aria-labelledby={`day-tab-${day}`}
        data-testid="schedule-grid"
      >
        {items.map((item) => (
          <PosterTile key={`${item.media.id}-${item.episode}`} item={item} now={now} timeZone={timeZone} mounted={mounted} />
        ))}
      </ul>
    );
  }

  const slots = groupByHourSlot(items, timeZone, (item) => item.airingAt);

  return (
    <div
      className={styles.timeline}
      id={`day-panel-${day}`}
      role="tabpanel"
      aria-labelledby={`day-tab-${day}`}
      data-testid="day-timeline"
    >
      {slots.map((slot) => (
        <div className={styles.slot} key={slot.slot}>
          <div className={styles.slot_rail} aria-hidden="true">
            {mounted ? slot.slot : "--:--"}
          </div>
          <div className={styles.slot_body}>
            {slot.items.map((item) => (
              <EpisodeCard
                key={`${item.media.id}-${item.episode}`}
                item={item}
                now={now}
                timeZone={timeZone}
                mounted={mounted}
                siteUrl={siteUrl}
                showJst={showJst}
                signedIn={signedIn}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
