"use client";

import styles from "./component.module.css";
import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import ProfileFallbackImg from "@/public/profile_fallback.jpg";
import { COMMENT_BODY_LIMIT, CommentsFailure, isCommentingTooFast } from "@/app/lib/comments/queries";
import MentionPicker, { useMentionPicker, type MentionUser } from "../MentionPicker";

export type CommentSubmission = { body: string; isSpoiler: boolean };

/** What the parent passes on: the submission plus the episode the comment belongs to. */
export type CommentSubmitResult = { error: CommentsFailure | null };

type WriteCommentFormTypes = {
  isAReply?: boolean;
  isSignedIn: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  onSubmit: (submission: CommentSubmission) => Promise<CommentSubmitResult>;
  onGuestAttempt: () => void;
  /** Episode the comment is filed under (watch page); null = the anime itself. */
  episodeNumber?: number | null;
  /** When given, the composer offers an episode picker with these numbers. */
  episodeOptions?: number[];
  onEpisodeChange?: (episode: number | null) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Test seam for the @ picker's lookup; production uses /api/users/search. */
  mentionFetcher?: (query: string) => Promise<MentionUser[]>;
};

function initialOf(name: string | null | undefined) {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "";
}

/**
 * ani.pm style composer: a round avatar, a single underlined line that expands
 * into a textarea with a counter, the spoiler toggle and the episode picker.
 * Expectations from the old form are unchanged (rate-limit text, submit state).
 */
export default function WriteCommentForm({
  isAReply,
  isSignedIn,
  username,
  avatarUrl,
  onSubmit,
  onGuestAttempt,
  episodeNumber = null,
  episodeOptions,
  onEpisodeChange,
  onCancel,
  autoFocus,
  mentionFetcher,
}: WriteCommentFormTypes) {
  const [isOpen, setIsOpen] = useState<boolean>(!!isAReply || !!autoFocus);
  const [body, setBody] = useState<string>("");
  const [isSpoiler, setIsSpoiler] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Caret position, so the @ picker knows which token is being typed. */
  const [caret, setCaret] = useState<number>(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Caret to restore after a pick (React owns the value, so it re-applies). */
  const pendingCaret = useRef<number | null>(null);

  const mentions = useMentionPicker({
    text: body,
    caret,
    fetcher: mentionFetcher,
    onInsert: ({ text, caret: nextCaret }) => {
      pendingCaret.current = nextCaret;
      setBody(text);
      setCaret(nextCaret);
    },
  });

  useEffect(() => {
    if (pendingCaret.current === null) return;

    const node = textareaRef.current;
    const position = pendingCaret.current;
    pendingCaret.current = null;

    if (node) {
      node.focus();
      try {
        node.setSelectionRange(position, position);
      } catch {
        /* older browsers do not support it on every input type */
      }
    }
  }, [body]);

  const displayName = username || "Anonymous";
  const trimmed = body.trim();
  const isOverLimit = body.length > COMMENT_BODY_LIMIT;
  const canSubmit = !!trimmed && !isOverLimit && !isSubmitting;

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus();
  }, [isOpen]);

  // Grow with the text, up to a comfortable height. Runs after render.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, [body, isOpen]);

  function startWriting() {
    if (!isSignedIn) {
      onGuestAttempt();
      return;
    }
    setIsOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!isSignedIn) {
      onGuestAttempt();
      return;
    }
    if (!canSubmit) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await onSubmit({ body, isSpoiler });

    if (result.error) {
      // The text stays so nothing is lost; the rate-limit sentence is shown as is.
      setErrorMessage(
        isCommentingTooFast(result.error)
          ? result.error.message
          : "Could not send your comment. Please try again.",
      );
      setIsSubmitting(false);
      return;
    }

    setBody("");
    setIsSpoiler(false);
    setSuccess(true);
    setIsSubmitting(false);
    if (isAReply) onCancel?.();
  }

  function handleCancel() {
    mentions.close();
    setBody("");
    setIsSpoiler(false);
    setErrorMessage(null);
    if (isAReply) onCancel?.();
    else setIsOpen(false);
  }

  return (
    <div
      id={styles.write_comment_container}
      data-open={isOpen}
      data-reply={isAReply ? "true" : "false"}
    >
      <div className={styles.avatar} aria-hidden="true">
        {avatarUrl ? (
          <Image src={avatarUrl} alt="" fill sizes="40px" className={styles.avatar_img} />
        ) : isSignedIn ? (
          <Image src={ProfileFallbackImg} alt="" fill sizes="40px" className={styles.avatar_img} />
        ) : (
          <span className={styles.avatar_initial}>{initialOf(displayName) || "?"}</span>
        )}
      </div>

      <form onSubmit={handleSubmit} className={styles.form} style={{ position: "relative" }}>
        {!isOpen ? (
          <button
            type="button"
            className={styles.collapsed_input}
            onClick={startWriting}
            onFocus={startWriting}
            data-testid="composer-collapsed"
          >
            Add a comment…
          </button>
        ) : (
          <>
            <label className={styles.sr_only} htmlFor={`comment-body-${isAReply ? "reply" : "top"}`}>
              {isAReply ? `Reply as ${displayName}` : `Comment as ${displayName}`}
            </label>

            <textarea
              id={`comment-body-${isAReply ? "reply" : "top"}`}
              ref={textareaRef}
              className={styles.textarea}
              rows={isAReply ? 2 : 3}
              name="comment"
              value={body}
              maxLength={COMMENT_BODY_LIMIT * 2}
              placeholder={isAReply ? "Write a reply…" : "Add a comment…"}
              onChange={(event) => {
                setBody(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
                if (success) setSuccess(false);
                if (errorMessage) setErrorMessage(null);
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onKeyUp={(event) => {
                if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
                setCaret(event.currentTarget.selectionStart ?? 0);
              }}
              onKeyDown={(event) => {
                // The @ picker gets first refusal: Escape closes the list, not the
                // whole comment.
                if (mentions.handleKeyDown(event)) return;
                if (event.key === "Escape") handleCancel();
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  void handleSubmit(event);
                }
              }}
            />

            {mentions.isOpen && (
              <MentionPicker
                results={mentions.results}
                activeIndex={mentions.activeIndex}
                onHover={mentions.setActiveIndex}
                onSelect={mentions.select}
              />
            )}

            <div className={styles.toolbar}>
              <label className={styles.spoiler_toggle}>
                <input
                  type="checkbox"
                  checked={isSpoiler}
                  onChange={(event) => setIsSpoiler(event.target.checked)}
                  aria-label="Mark as spoiler"
                />
                <span>Spoiler</span>
              </label>

              {episodeOptions && episodeOptions.length > 0 && (
                <label className={styles.episode_picker}>
                  <span className={styles.sr_only}>Episode</span>
                  <select
                    value={episodeNumber ?? ""}
                    onChange={(event) =>
                      onEpisodeChange?.(event.target.value ? Number(event.target.value) : null)
                    }
                  >
                    <option value="">Whole series</option>
                    {episodeOptions.map((episode) => (
                      <option key={episode} value={episode}>
                        EP {episode}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <small
                className={styles.counter}
                data-over-limit={isOverLimit}
                aria-live="polite"
              >
                {body.length} / {COMMENT_BODY_LIMIT}
              </small>
            </div>

            {errorMessage && (
              <p className={styles.form_error} role="alert">
                {errorMessage}
              </p>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.cancel_button} onClick={handleCancel}>
                Cancel
              </button>
              <button
                type="submit"
                className={styles.submit_button}
                disabled={!canSubmit}
                aria-label="Post comment"
              >
                {isSubmitting ? "Sending…" : "Comment"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
