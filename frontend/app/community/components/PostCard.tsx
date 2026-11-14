"use client";
import { useState } from "react";
import styles from "../page.module.css";
import type { FeedItem } from "@/app/lib/community/queries";
import { Avatar, TimeStamp } from "./shared";
import PostActions from "./PostActions";

export type PostCardProps = {
  item: FeedItem;
  myReaction: 1 | -1 | null;
  isSignedIn: boolean;
  canDelete: boolean;
  onReact: (item: FeedItem, value: 1 | -1) => void;
  onDelete: (item: FeedItem) => Promise<void> | void;
  onReport: (item: FeedItem) => void;
  onGuestWrite: () => void;
};

/** One post. Spoiler content is blurred until the reader asks for it. */
export default function PostCard({
  item,
  myReaction,
  isSignedIn,
  canDelete,
  onReact,
  onDelete,
  onReport,
  onGuestWrite,
}: PostCardProps) {
  const [revealed, setRevealed] = useState(false);

  const displayName = item.author_display_name || item.author_username || "Someone";
  const isHiddenBody = item.is_spoiler && !revealed && !!item.body;

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
