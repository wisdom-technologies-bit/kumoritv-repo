"use client";

import React, { useState } from "react";
import Image from "next/image";
import styles from "./component.module.css";
import SvgThumbUp from "@/public/assets/hand-thumbs-up.svg";
import SvgThumbUpFill from "@/public/assets/hand-thumbs-up-fill.svg";
import SvgThumbDown from "@/public/assets/hand-thumbs-down.svg";
import SvgThumbDownFill from "@/public/assets/hand-thumbs-down-fill.svg";
import SvgTrash from "@/public/assets/trash.svg";
import WriteCommentForm, {
  CommentSubmitResult,
  CommentSubmission,
} from "../WriteCommentForm";
import { formatTimeAgo } from "@/app/lib/comments/timeAgo";
import type { CommentFeedRow, ReactionValue } from "@/app/lib/comments/queries";
import { splitMentions } from "@/app/lib/comments/mentions";

export type CommentContainerTypes = {
  comment: CommentFeedRow;
  /** Replies are the same row, rendered smaller and without a reply composer. */
  isReply?: boolean;
  isSignedIn: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  myReaction: ReactionValue | null;
  canDelete: boolean;
  /** How many replies exist (countReplies), so the toggle can say "▾ 3 replies". */
  replyCount?: number;
  isRepliesOpen?: boolean;
  isRepliesLoading?: boolean;
  isSpoilerRevealed?: boolean;
  onToggleSpoiler?: (commentId: string) => void;
  onToggleReplies?: (commentId: string) => void;
  onGuestAttempt: () => void;
  onReact: (comment: CommentFeedRow, value: ReactionValue) => void;
  onDelete: (comment: CommentFeedRow) => void;
  onSubmitReply: (
    parentId: string,
    submission: CommentSubmission,
  ) => Promise<CommentSubmitResult>;
  /** Episode the inline reply composer files under. */
  replyEpisodeNumber?: number | null;
  /** The reply rows (or skeleton), rendered under the toggle by the section. */
  children?: React.ReactNode;
};

/** A comment whose author deleted their account. The row keeps no user id. */
export function isDeletedAuthor(comment: CommentFeedRow) {
  return comment.user_id === null || comment.user_id === undefined;
}

function authorLabel(comment: CommentFeedRow) {
  if (isDeletedAuthor(comment)) return "[deleted]";
  return comment.username || comment.display_name || "Anonymous";
}

/** Stable hue per author so placeholder avatars are not all the same grey. */
function avatarHue(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }
  return hash;
}

/**
 * One comment (or one reply): avatar, @username, time ago, EP pill, body,
 * spoiler bar and the action row. Every behaviour from the previous version is
 * kept: react toggle, own-comment delete, inline reply.
 */
export default function CommentContainer({
  comment,
  isReply = false,
  isSignedIn,
  username,
  avatarUrl,
  myReaction,
  canDelete,
  replyCount = 0,
  isRepliesOpen = false,
  isRepliesLoading = false,
  isSpoilerRevealed = false,
  onToggleSpoiler,
  onToggleReplies,
  onGuestAttempt,
  onReact,
  onDelete,
  onSubmitReply,
  replyEpisodeNumber = null,
  children,
}: CommentContainerTypes) {
  const [isReplying, setIsReplying] = useState<boolean>(false);

  const author = authorLabel(comment);
  const initial = author.trim().charAt(0).toUpperCase() || "?";
  const isLikeActive = myReaction === 1;
  const isDislikeActive = myReaction === -1;
  const isHidden = comment.is_spoiler && !isSpoilerRevealed;

  function handleReplyButton() {
    if (!isSignedIn) {
      onGuestAttempt();
      return;
    }

    setIsReplying((current) => !current);
  }

  return (
    <li
      // Deep-link anchor: notifications and "view comment" links point here.
      id={`comment-${comment.id}`}
      className={styles.comment}
      data-reply={isReply ? "true" : "false"}
      data-comment-id={comment.id}
      data-has-spoiler={isHidden ? "true" : "false"}
      data-testid={`comment-${comment.id}`}
    >
      <div className={styles.comment_avatar} aria-hidden="true">
        {comment.avatar_url && !isReply ? (
          <Image
            src={comment.avatar_url}
            alt=""
            fill
            sizes="36px"
            className={styles.comment_avatar_img}
          />
        ) : (
          <span
            className={styles.comment_avatar_initial}
            style={{ backgroundColor: `hsl(${avatarHue(author)} 55% 32%)` }}
          >
            {initial}
          </span>
        )}
      </div>

      <div className={styles.comment_main}>
        <div className={styles.comment_meta}>
          <span className={styles.comment_author}>@{author}</span>
          <span className={styles.comment_time}>
            {formatTimeAgo(comment.created_at)}
          </span>
          {comment.episode_number !== null &&
            comment.episode_number !== undefined && (
              <span className={styles.episode_pill}>EP {comment.episode_number}</span>
            )}
        </div>

        {isHidden ? (
          <button
            type="button"
            className={styles.spoiler_bar}
            data-testid={`spoiler-${comment.id}`}
            onClick={() => onToggleSpoiler?.(comment.id)}
            aria-label="Reveal spoiler"
          >
            <span aria-hidden="true">⚠</span> Spoiler — tap to reveal
          </button>
        ) : (
          <p className={styles.comment_body}>
            {/* "@username" is highlighted, never linked: there is no public profile page. */}
            {splitMentions(comment.body).map((segment, index) =>
              segment.mention ? (
                <span className={styles.mention} key={`m-${index}`}>
                  {segment.text}
                </span>
              ) : (
                <React.Fragment key={`t-${index}`}>{segment.text}</React.Fragment>
              ),
            )}
          </p>
        )}

        <div className={styles.actions_row}>
          <button
            type="button"
            className={styles.reaction_button}
            data-testid={`like-${comment.id}`}
            data-active={isLikeActive ? "true" : "false"}
            aria-pressed={isLikeActive}
            aria-label={isLikeActive ? "Remove like" : "Like this comment"}
            onClick={() => onReact(comment, 1)}
          >
            {isLikeActive ? (
              <SvgThumbUpFill width={16} height={16} alt="" />
            ) : (
              <SvgThumbUp width={16} height={16} alt="" />
            )}
            <span>{comment.likes > 0 ? comment.likes : ""}</span>
          </button>

          <button
            type="button"
            className={styles.reaction_button}
            data-testid={`dislike-${comment.id}`}
            data-active={isDislikeActive ? "true" : "false"}
            aria-pressed={isDislikeActive}
            aria-label={isDislikeActive ? "Remove dislike" : "Dislike this comment"}
            onClick={() => onReact(comment, -1)}
          >
            {isDislikeActive ? (
              <SvgThumbDownFill width={16} height={16} alt="" />
            ) : (
              <SvgThumbDown width={16} height={16} alt="" />
            )}
            <span>{comment.dislikes > 0 ? comment.dislikes : ""}</span>
          </button>

          {(
            <button
              type="button"
              className={styles.reply_button}
              data-testid={`reply-${comment.id}`}
              onClick={handleReplyButton}
              aria-expanded={isReplying}
            >
              Reply
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              className={styles.delete_button}
              data-testid={`delete-${comment.id}`}
              onClick={() => onDelete(comment)}
              aria-label="Delete your comment"
            >
              <SvgTrash width={15} height={15} alt="" />
            </button>
          )}
        </div>

        {isReplying && (
          <div className={styles.inline_reply_form}>
            <WriteCommentForm
              isAReply
              isSignedIn={isSignedIn}
              username={username}
              avatarUrl={avatarUrl}
              episodeNumber={replyEpisodeNumber ?? undefined}
              onSubmit={(submission) =>
                onSubmitReply(comment.parent_id ?? comment.id, submission)
              }
              onGuestAttempt={onGuestAttempt}
              onCancel={() => setIsReplying(false)}
              autoFocus
            />
          </div>
        )}

        {!isReply && (replyCount > 0 || isRepliesOpen) && (
          <button
            type="button"
            className={styles.replies_toggle}
            data-testid={`replies-${comment.id}`}
            onClick={() => onToggleReplies?.(comment.id)}
            aria-expanded={isRepliesOpen}
          >
            {isRepliesOpen
              ? "Hide replies"
              : `${isRepliesLoading ? "Loading" : "▾"} ${replyCount} ${
                  replyCount === 1 ? "reply" : "replies"
                }`}
          </button>
        )}

        {children}
      </div>
    </li>
  );
}
