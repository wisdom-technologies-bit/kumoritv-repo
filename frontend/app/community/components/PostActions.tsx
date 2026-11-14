"use client";
// Prompt 38F: the action footer, extracted so the clip card and the text card
// cannot disagree about it. The markup and the labels are exactly what
// PostCard rendered before it was pulled out - same classes, same aria labels,
// same order - so a reader sees no change on a text post.
import Link from "next/link";
import { useState } from "react";
import styles from "../page.module.css";
import type { FeedItem } from "@/app/lib/community/queries";
import { useCopyLink } from "./shared";
import { CommentIcon, FlagIcon, HeartIcon, ShareIcon, ThumbDownIcon, TrashIcon } from "./icons";

export type PostActionsProps = {
  item: FeedItem;
  myReaction: 1 | -1 | null;
  isSignedIn: boolean;
  canDelete: boolean;
  onReact: (item: FeedItem, value: 1 | -1) => void;
  onDelete: (item: FeedItem) => Promise<void> | void;
  onReport: (item: FeedItem) => void;
  onGuestWrite: () => void;
};

export default function PostActions({
  item,
  myReaction,
  isSignedIn,
  canDelete,
  onReact,
  onDelete,
  onReport,
  onGuestWrite,
}: PostActionsProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const { copied, copy } = useCopyLink();

  return (
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
  );
}
