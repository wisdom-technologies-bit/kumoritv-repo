"use client";

import styles from "./component.module.css";
import { FormEvent, useRef, useState } from "react";
import Image from "next/image";
import ProfileFallbackImg from "@/public/profile_fallback.jpg";
import SvgCheck from "@/public/assets/check-circle-fill.svg";
import { COMMENT_BODY_LIMIT, CommentsFailure, isCommentingTooFast } from "@/app/lib/comments/queries";

export type CommentSubmission = { body: string; isSpoiler: boolean };
export type CommentSubmitResult = { error: CommentsFailure | null };

type WriteCommentFormTypes = {
  isAReply?: boolean;
  isSignedIn: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  onSubmit: (submission: CommentSubmission) => Promise<CommentSubmitResult>;
  onGuestAttempt: () => void;
};

/** The comment box. Same markup and classes as the original section, but the
 *  comment is written through the Supabase data layer instead of Firestore. */
export default function WriteCommentForm({
  isAReply,
  isSignedIn,
  username,
  avatarUrl,
  onSubmit,
  onGuestAttempt,
}: WriteCommentFormTypes) {
  const [currTextLength, setCurrTextLength] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [wasCommentCreatedSuccessfully, setWasCommentCreatedSuccessfully] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const spoilerRef = useRef<HTMLInputElement>(null);

  const inputCharLimit = COMMENT_BODY_LIMIT;
  const displayName = username || "Anonymous";

  function isCommentTextValid(text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > inputCharLimit) return false;
    return true;
  }

  async function handleCreateComment(e: FormEvent) {
    e.preventDefault();

    if (!isSignedIn) {
      onGuestAttempt();
      return;
    }

    const text = textareaRef.current?.value ?? "";
    if (!isCommentTextValid(text)) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await onSubmit({ body: text, isSpoiler: !!spoilerRef.current?.checked });

    if (result.error) {
      // Keep what was typed so nothing is lost; the rate limit message is shown as is.
      setErrorMessage(
        isCommentingTooFast(result.error)
          ? result.error.message
          : "Could not send your comment. Please try again.",
      );
      setIsSubmitting(false);
      return;
    }

    if (textareaRef.current) textareaRef.current.value = "";
    if (spoilerRef.current) spoilerRef.current.checked = false;
    setCurrTextLength(0);
    setWasCommentCreatedSuccessfully(true);
    setIsSubmitting(false);
  }

  return (
    <div id={styles.write_comment_container}>
      <div className={styles.img_container}>
        <Image
          src={avatarUrl || ProfileFallbackImg}
          alt={isSignedIn ? `${displayName} profile picture` : "User Not Logged In Profile Picture"}
          fill
          sizes="60px"
        />
      </div>

      <form onSubmit={handleCreateComment}>
        <label>
          {isSignedIn
            ? `${isAReply ? `Reply as ${displayName}` : `Comment as ${displayName}`}`
            : "Please log in to comment"}

          <textarea
            ref={textareaRef}
            rows={isAReply ? 2 : 3}
            cols={70}
            name="comment"
            onChange={(e) => {
              setCurrTextLength(e.target.value.length);
              if (wasCommentCreatedSuccessfully) setWasCommentCreatedSuccessfully(false);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder={isAReply ? "Reply with..." : "Leave a comment"}
            required
          ></textarea>
        </label>

        <div className={styles.flex_row_justify_between}>
          <div id={styles.is_spoiler_checkbox_container}>
            <label>
              <input
                ref={spoilerRef}
                type="checkbox"
                name="spoiler"
                defaultChecked={false}
                aria-label="Spoiler Checkbox"
              />
              <span />
            </label>

            <p>SPOILER!!!</p>
          </div>

          <small data-over-limit={currTextLength > inputCharLimit}>
            Chars. {currTextLength} / {inputCharLimit}
          </small>
        </div>

        {errorMessage && (
          <p className={styles.form_error} role="alert">
            {errorMessage}
          </p>
        )}

        <button type="submit" disabled={isSubmitting || currTextLength > inputCharLimit}>
          {wasCommentCreatedSuccessfully ? (
            <>
              <SvgCheck width={16} height={16} alt="Check" /> Comment Done
            </>
          ) : (
            "Comment!"
          )}
        </button>
      </form>
    </div>
  );
}
