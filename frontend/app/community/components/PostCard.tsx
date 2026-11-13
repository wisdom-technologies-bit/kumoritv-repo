"use client";
import Link from "next/link";
import { useState } from "react";
import styles from "../page.module.css";
import type { FeedItem } from "@/app/lib/community/queries";
import { Avatar, TimeStamp, useCopyLink } from "./shared";
import { CommentIcon, FlagIcon, HeartIcon, ShareIcon, ThumbDownIcon, TrashIcon } from "./icons";

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
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const { copied, copy } = useCopyLink();

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

      <footer className={styles.post_actions}>
        <button
          type="button"
          className={styles.button_link}
          data-active={myReaction === 1}
          aria-pressed={myReaction === 1}
          aria-label={`Like, ${item.likes} ${item.likes === 1 ? "like" : "likes"}`}
          onClick={() => (isSignedIn ? onReact(item, 1) : onGuestWrite())}
        >
          <HeartIcon />
          {item.likes > 0 ? item.likes : "Like"}
        </button>

        <button
          type="button"
          className={styles.button_link}
          data-active={myReaction === -1}
          aria-pressed={myReaction === -1}
          aria-label={`Dislike, ${item.dislikes}`}
          onClick={() => (isSignedIn ? onReact(item, -1) : onGuestWrite())}
        >
          <ThumbDownIcon />
          {item.dislikes > 0 ? item.dislikes : "Dislike"}
        </button>

        <Link className={styles.button_link} href={item.target_url} aria-label="Open the post and its comments">
          <CommentIcon />
          {item.reply_count > 0 ? item.reply_count : "Comment"}
        </Link>

        <button type="button" className={styles.button_link} onClick={() => void copy(item.target_url)}>
          <ShareIcon />
          {copied ? "Copied" : "Share"}
        </button>

        <div className={styles.post_actions_end}>
          {canDelete ? (
            isConfirmingDelete ? (
              <span className={styles.confirm_row}>
                Delete?
                <button
                  type="button"
                  className={styles.button_link}
                  onClick={async () => {
                    setIsConfirmingDelete(false);
                    await onDelete(item);
                  }}
                >
                  Yes
                </button>
                <button type="button" className={styles.button_link} onClick={() => setIsConfirmingDelete(false)}>
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={styles.button_link}
                aria-label="Delete your post"
                onClick={() => setIsConfirmingDelete(true)}
              >
                <TrashIcon />
              </button>
            )
          ) : (
            <button
              type="button"
              className={styles.button_link}
              aria-label="Report this post"
              onClick={() => onReport(item)}
            >
              <FlagIcon />
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
