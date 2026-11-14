"use client";
// Prompt 38F: a post that carries a clip, in the feed.
//
// The server has already decided what this post may show: `community_feed_page`
// appends `clip_state` and nulls every clip and anime field on a row it masked
// (hidden_adult) or whose clip was deleted (removed). This component draws that
// decision and nothing more. It never looks a clip up, never guesses at a
// poster and never falls back to a title it was not given - so a hidden adult
// clip arrives with no code, no range, no anime name and no poster, and there
// is nothing here that could put them back.

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import styles from "../page.module.css";
import type { FeedItem } from "@/app/lib/community/queries";
import { Avatar, TimeStamp } from "./shared";
import PostActions from "./PostActions";
import {
  ADULT_HIDDEN_TEXT,
  ADULT_LABEL,
  clipDurationLabel,
  clipMetaLabel,
  clipRangeLabel,
  clipThumbPath,
} from "@/app/lib/community/clip-attachment";

export type ClipPostCardProps = {
  item: FeedItem;
  myReaction: 1 | -1 | null;
  isSignedIn: boolean;
  canDelete: boolean;
  onReact: (item: FeedItem, value: 1 | -1) => void;
  onDelete: (item: FeedItem) => Promise<void> | void;
  onReport: (item: FeedItem) => void;
  onGuestWrite: () => void;
};

/** True for a post row that draws as a clip card rather than a text card. */
export function isClipPost(item: Pick<FeedItem, "clip_state">): boolean {
  return item.clip_state === "live" || item.clip_state === "hidden_adult" || item.clip_state === "removed";
}

export default function ClipPostCard({
  item,
  myReaction,
  isSignedIn,
  canDelete,
  onReact,
  onDelete,
  onReport,
  onGuestWrite,
}: ClipPostCardProps) {
  const [revealed, setRevealed] = useState(false);
  const [broken, setBroken] = useState(false);

  const displayName = item.author_display_name || item.author_username || "Someone";
  const isHiddenBody = item.is_spoiler && !revealed && !!item.body;

  const state = item.clip_state ?? "none";
  const thumb = state === "live" ? clipThumbPath(item.anime_id, item.episode_number) : null;
  const meta = [clipMetaLabel(item.anime_title, item.episode_number), clipRangeLabel(item.clip_start, item.clip_end), clipDurationLabel(item.clip_start, item.clip_end)]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className={`${styles.card} ${styles.post_card}`} data-feed-key={item.feed_key}>
      <header className={styles.post_head}>
        <Avatar url={item.author_avatar} name={displayName} />
        <div className={styles.identity}>
          <span className={styles.author_name}>{displayName}</span>
          <span className={styles.author_meta}>
            <TimeStamp iso={item.created_at} />
            {item.is_spoiler && (
              <>
                <span className={styles.dot} aria-hidden="true" />
                <span>Spoiler</span>
              </>
            )}
          </span>
        </div>
      </header>

      {isHiddenBody ? (
        <div className={styles.spoiler} data-revealed="false">
          <div className={styles.spoiler_hidden} aria-hidden="true">
            {item.body}
          </div>
          <button type="button" className={styles.spoiler_overlay} onClick={() => setRevealed(true)}>
            Spoiler
            <span className={styles.spoiler_hint}>Tap to reveal</span>
          </button>
        </div>
      ) : (
        item.body && <p className={styles.post_body}>{item.body}</p>
      )}

      {state === "live" && item.clip_code ? (
        <Link
          className={styles.feed_clip}
          href={`/clip/${item.clip_code}`}
          data-clip-post="live"
          aria-label={`Watch the clip${item.anime_title ? ` from ${item.anime_title}` : ""}`}
        >
          <span className={styles.feed_clip_thumb}>
            {thumb && !broken ? (
              <Image
                src={thumb}
                alt=""
                width={160}
                height={90}
                sizes="160px"
                onError={() => setBroken(true)}
                unoptimized
              />
            ) : (
              <span className={styles.feed_clip_placeholder} aria-hidden="true" data-placeholder="true" />
            )}
          </span>
          <span className={styles.feed_clip_text}>
            <span className={styles.feed_clip_title}>
              {item.title || item.anime_title || "Shared a clip"}
            </span>
            {meta && <span className={styles.feed_clip_meta}>{meta}</span>}
            <span className={styles.feed_clip_cta}>Watch the clip</span>
          </span>
        </Link>
      ) : state === "hidden_adult" ? (
        <div className={styles.adult_card} data-clip-post="hidden_adult" data-adult-hidden="true">
          <span className={styles.adult_label}>{ADULT_LABEL}</span>
          <p className={styles.adult_text}>{ADULT_HIDDEN_TEXT}</p>
        </div>
      ) : (
        <div className={styles.clip_removed} data-clip-post="removed">
          <span className={styles.clip_removed_title}>This clip was removed</span>
          <span className={styles.clip_removed_text}>The post is still here, but the clip is gone.</span>
        </div>
      )}

      <PostActions
        item={item}
        myReaction={myReaction}
        isSignedIn={isSignedIn}
        canDelete={canDelete}
        onReact={onReact}
        onDelete={onDelete}
        onReport={onReport}
        onGuestWrite={onGuestWrite}
      />
    </article>
  );
}
