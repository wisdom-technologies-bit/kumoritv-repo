"use client";

import React, { useState } from "react";
import Image from "next/image";
import styles from "./component.module.css";
import { convertFromUnix } from "@/app/lib/formatDateUnix";
import SvgThumbUp from "@/public/assets/hand-thumbs-up.svg";
import SvgThumbUpFill from "@/public/assets/hand-thumbs-up-fill.svg";
import SvgThumbDown from "@/public/assets/hand-thumbs-down.svg";
import SvgThumbDownFill from "@/public/assets/hand-thumbs-down-fill.svg";
import SvgReply from "@/public/assets/reply.svg";
import SvgReplyFill from "@/public/assets/reply-fill.svg";
import SvgTrash from "@/public/assets/trash.svg";
import ProfileFallbackImg from "@/public/profile_fallback.jpg";
import WriteCommentForm, { CommentSubmitResult, CommentSubmission } from "../WriteCommentForm";
import type { CommentFeedRow, ReactionValue } from "@/app/lib/comments/queries";

export type CommentLookups = {
  /** The signed-in user's own reaction for a comment, if any. */
  reactionFor: (comment: CommentFeedRow) => ReactionValue | null;
  /** Only the author may delete their own comment. */
  canDeleteFor: (comment: CommentFeedRow) => boolean;
  /** Replies of a top-level comment, oldest first. */
  repliesFor: (comment: CommentFeedRow) => CommentFeedRow[];
};

export type CommentContainerTypes = {
  comment: CommentFeedRow;
  lookups: CommentLookups;
  isSignedIn: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  onGuestAttempt: () => void;
  onReact: (comment: CommentFeedRow, value: ReactionValue) => void;
  onDelete: (comment: CommentFeedRow) => void;
  onSubmitReply: (parentId: string, submission: CommentSubmission) => Promise<CommentSubmitResult>;
};

function formatCommentDate(createdAt: string) {
  const seconds = Math.floor(new Date(createdAt).getTime() / 1000);
  if (!Number.isFinite(seconds)) return "";
  return convertFromUnix(seconds, { month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** One comment (or one reply). Same look as the original component; the data now
 *  comes from `comment_feed` and the reactions from `comment_reactions`. */
export default function CommentContainer({
  comment,
  lookups,
  isSignedIn,
  username,
  avatarUrl,
  onGuestAttempt,
  onReact,
  onDelete,
  onSubmitReply,
}: CommentContainerTypes) {
  const [isGettingAReply, setIsGettingAReply] = useState<boolean>(false);
  const [isSpoilerRevealed, setIsSpoilerRevealed] = useState<boolean>(false);

  const isAReply = comment.parent_id !== null;
  const replyTargetId = comment.parent_id ?? comment.id;

  const replies = lookups.repliesFor(comment);
  const myReaction = lookups.reactionFor(comment);

  const authorName = comment.username || comment.display_name || "Anonymous";
  const isLikeActive = myReaction === 1;
  const isDislikeActive = myReaction === -1;
  const replyCount = replies.length;
  const canDelete = lookups.canDeleteFor(comment);

  function handleReplyButton() {
    if (!isSignedIn) {
      onGuestAttempt();
      return;
    }
    setIsGettingAReply(!isGettingAReply);
  }

  function handleSpoilerClick() {
    if (comment.is_spoiler && !isSpoilerRevealed) setIsSpoilerRevealed(true);
  }

  return (
    <li
      className={styles.comment_container}
      data-has-spoiler={comment.is_spoiler && !isSpoilerRevealed}
      data-testid={`comment-${comment.id}`}
    >
      <div className={styles.user_img_container}>
        <Image
          src={comment.avatar_url || ProfileFallbackImg}
          alt={authorName}
          fill
          sizes="72px"
        />
      </div>

      <div className={styles.comment_data}>
        <div className={styles.heading_container}>
          <h5>{authorName.length > 25 ? `${authorName.slice(0, 25)}...` : authorName}</h5>

          <p>{formatCommentDate(comment.created_at)}</p>
        </div>

        <div className={styles.comment_text_container} onClick={handleSpoilerClick}>
          <p>{comment.body}</p>
        </div>

        <div className={`${styles.flex} display_flex_row space_beetween align_items_center`}>
          <div className={styles.buttons_container}>
            <button
              type="button"
              aria-pressed={isLikeActive}
              data-testid={`like-${comment.id}`}
              onClick={() => onReact(comment, 1)}
            >
              <SvgIcons
                type={"like"}
                isBtnActive={isLikeActive}
                likes={comment.likes}
                dislikes={comment.dislikes}
                replyCount={replyCount}
              />
            </button>

            <button
              type="button"
              aria-pressed={isDislikeActive}
              data-testid={`dislike-${comment.id}`}
              onClick={() => onReact(comment, -1)}
            >
              <SvgIcons
                type={"dislike"}
                isBtnActive={isDislikeActive}
                likes={comment.likes}
                dislikes={comment.dislikes}
                replyCount={replyCount}
              />
            </button>

            <button type="button" data-testid={`reply-${comment.id}`} onClick={handleReplyButton}>
              <SvgIcons
                type={"reply"}
                isBtnActive={isGettingAReply}
                likes={comment.likes}
                dislikes={comment.dislikes}
                replyCount={replyCount}
              />
            </button>

            {canDelete && (
              <button
                type="button"
                className={styles.delete_btn}
                data-testid={`delete-${comment.id}`}
                onClick={() => onDelete(comment)}
              >
                <SvgTrash width={16} height={16} alt="Delete Icon" />
                Delete
              </button>
            )}
          </div>

          {comment.episode_number != null && <small>EP {comment.episode_number}</small>}
        </div>

        {isGettingAReply && (
          <div className={styles.reply_form_container} aria-expanded={isGettingAReply}>
            <WriteCommentForm
              isAReply
              isSignedIn={isSignedIn}
              username={username}
              avatarUrl={avatarUrl}
              onGuestAttempt={onGuestAttempt}
              onSubmit={(submission) => onSubmitReply(replyTargetId, submission)}
            />
          </div>
        )}

        {!isAReply && replyCount > 0 && (
          <ul className={styles.reply_form_container}>
            {replies.map((reply) => (
              <CommentContainer
                key={reply.id}
                comment={reply}
                lookups={lookups}
                isSignedIn={isSignedIn}
                username={username}
                avatarUrl={avatarUrl}
                onGuestAttempt={onGuestAttempt}
                onReact={onReact}
                onDelete={onDelete}
                onSubmitReply={onSubmitReply}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function SvgIcons({
  type,
  isBtnActive,
  likes,
  dislikes,
  replyCount,
}: {
  type: "like" | "dislike" | "reply";
  isBtnActive: boolean;
  likes: number;
  dislikes: number;
  replyCount: number;
}) {
  switch (type) {
    case "like":
      if (isBtnActive) {
        return (
          <>
            <SvgThumbUpFill width={16} height={16} alt="Thumbs Up" /> {likes != 0 && likes} &#x2022; Likes
          </>
        );
      }

      return (
        <>
          <SvgThumbUp width={16} height={16} alt="Thumbs Up" /> {likes != 0 && likes} &#x2022; Like
        </>
      );

    case "dislike":
      if (isBtnActive) {
        return (
          <>
            <SvgThumbDownFill width={16} height={16} alt="Thumbs Down" /> {dislikes != 0 && dislikes} &#x2022;
            Dislikes
          </>
        );
      }

      return (
        <>
          <SvgThumbDown width={16} height={16} alt="Thumbs Down" /> {dislikes != 0 && dislikes} &#x2022; Dislike
        </>
      );

    case "reply":
      if (isBtnActive) {
        return (
          <>
            <SvgReplyFill width={16} height={16} alt="Reply" /> {replyCount != 0 && replyCount} &#x2022; Reply
          </>
        );
      }

      return (
        <>
          <SvgReply width={16} height={16} alt="Reply" /> {replyCount != 0 && replyCount} &#x2022; Reply
        </>
      );

    default:
      return null;
  }
}
