"use client";
// One episode row. Calmer when it already aired, but still a link.
import Link from "next/link";
import styles from "../schedule.module.css";
import {
  COVER_PLACEHOLDER,
  episodeLabel,
  formatChip,
  scheduleTitle,
  studioName,
  topGenres,
  watchHref,
} from "@/app/lib/schedule/format";
import { localTimeLabel, statusOf } from "@/app/lib/schedule/local";
import AddToCalendar from "./AddToCalendar";
import NotifyButton from "./NotifyButton";
import type { ScheduleItem } from "@/app/lib/schedule/types";

const JST = "Asia/Tokyo";

export default function EpisodeCard({
  item,
  now,
  timeZone,
  mounted,
  siteUrl,
  showJst,
  signedIn,
}: {
  item: ScheduleItem;
  now: number;
  timeZone: string;
  mounted: boolean;
  siteUrl: string;
  showJst: boolean;
  signedIn: boolean;
}) {
  const status = statusOf(item.airingAt, now);
  const aired = status.state === "aired";
  const jst = localTimeLabel(item.airingAt, JST);
  const local = localTimeLabel(item.airingAt, timeZone);
  const genres = topGenres(item.media, 2);
  const studio = studioName(item.media);
  const score = Number(item.media.averageScore);

  return (
    <article className={styles.card} data-aired={aired} data-testid="episode-card">
      <Link href={`/media/${item.media.id}`} className={styles.card_cover} aria-hidden="true" tabIndex={-1}>
        <img
          src={item.media.coverImage?.large || item.media.coverImage?.extraLarge || COVER_PLACEHOLDER}
          alt=""
          width={84}
          height={126}
          loading="lazy"
          decoding="async"
        />
      </Link>

      <div className={styles.card_body}>
        <div className={styles.card_head}>
          <Link href={`/media/${item.media.id}`} className={styles.card_title}>
            {scheduleTitle(item.media)}
          </Link>
        </div>

        <div className={styles.card_sub}>
          <span className={styles.time} data-testid="episode-time">
            {mounted ? local : "\u00a0\u00a0:\u00a0\u00a0"}
          </span>
          {showJst ? (
            <span className={styles.time_jst} title="Japan Standard Time">
              {mounted ? `${jst} JST` : ""}
            </span>
          ) : null}
          <span>{episodeLabel(item.episode, item.media)}</span>
          {item.media.format ? <span className={styles.tag}>{formatChip(item.media.format)}</span> : null}
          {Number.isFinite(score) && score > 0 ? (
            <span className={styles.score} title="AniList average score">
              ★ {score}%
            </span>
          ) : null}
          {item.media.status === "NOT_YET_RELEASED" ? <span className={styles.tag}>Upcoming</span> : null}
        </div>

        {genres.length || studio ? (
          <div className={styles.card_sub}>
            {genres.map((genre) => (
              <span key={genre} className={styles.tag}>
                {genre}
              </span>
            ))}
            {studio ? <span>{studio}</span> : null}
          </div>
        ) : null}

        <div className={styles.chips}>
          {item.available ? (
            <span className={styles.status} data-state="available">
              On KumoriTV
            </span>
          ) : (
            <span className={styles.status} data-state={status.state} data-testid={`status-${status.state}`}>
              {status.label}
            </span>
          )}
        </div>

        <div className={styles.actions}>
          {item.available ? (
            <Link
              href={watchHref(item.media.id, item.episode)}
              className={styles.action}
              data-primary="true"
              data-testid="watch-button"
            >
              Watch
            </Link>
          ) : null}
          <Link href={`/media/${item.media.id}`} className={styles.action}>
            Details
          </Link>
          {signedIn ? <NotifyButton media={item.media} /> : null}
          <AddToCalendar item={item} siteUrl={siteUrl} />
        </div>
      </div>
    </article>
  );
}
