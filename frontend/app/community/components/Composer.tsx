"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import { Avatar } from "./shared";
import { POST_BODY_MAX } from "@/app/lib/community/constants";

const DRAFT_KEY = "kumori:community:draft";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Draft = { body: string; isSpoiler: boolean; savedAt: number };

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (typeof parsed?.body !== "string") return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    return { body: parsed.body.slice(0, POST_BODY_MAX), isSpoiler: parsed.isSpoiler === true, savedAt: parsed.savedAt };
  } catch {
    // Private mode, quota, corrupted JSON: a draft is a convenience, never a
    // reason to break the composer.
    return null;
  }
}

function writeDraft(body: string, isSpoiler: boolean) {
  try {
    if (!body.trim()) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ body, isSpoiler, savedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export type ComposeResult = { ok: boolean; message?: string };

type ComposerProps = {
  isSignedIn: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
  onSubmit: (input: { body: string; isSpoiler: boolean }) => Promise<ComposeResult>;
  onGuestWrite: () => void;
  /** "sheet" is the full-screen mobile composer: same body, different chrome. */
  variant?: "inline" | "sheet";
  autoFocus?: boolean;
  onRequestClose?: () => void;
};

/** Text + spoiler toggle + counter + draft. The only Phase 1 composer. */
export default function Composer({
  isSignedIn,
  displayName,
  avatarUrl,
  onSubmit,
  onGuestWrite,
  variant = "inline",
  autoFocus = false,
  onRequestClose,
}: ComposerProps) {
  const [body, setBody] = useState("");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setBody(draft.body);
      setIsSpoiler(draft.isSpoiler);
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    writeDraft(body, isSpoiler);
  }, [body, isSpoiler, isHydrated]);

  // Grow with the text, up to the CSS max-height.
  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 320)}px`;
  }, [body]);

  const remaining = POST_BODY_MAX - body.trim().length;
  const isOver = remaining < 0;
  const canSubmit = isSignedIn && !isSubmitting && !isOver && body.trim().length > 0;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    const result = await onSubmit({ body, isSpoiler });
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.message || "We could not post that. Please try again.");
      return;
    }
    setBody("");
    setIsSpoiler(false);
    clearDraft();
  }, [body, canSubmit, isSpoiler, onSubmit]);

  if (!isSignedIn) {
    return (
      <div className={`${styles.card} ${styles.signin_card}`}>
        <div className={styles.signin_copy}>
          <span className={styles.signin_title}>Sign in to post</span>
          <span className={styles.signin_text}>
            Anyone can read the community. Posting and commenting need an account.
          </span>
        </div>
        <button type="button" className={styles.button} onClick={onGuestWrite}>
          Sign in
        </button>
      </div>
    );
  }

  const form = (
    <div className={styles.composer}>
      <Avatar url={avatarUrl} name={displayName} />
      <div className={styles.composer_body}>
        <textarea
          ref={textareaRef}
          className={styles.composer_textarea}
          placeholder="What are you watching? Spoilers go behind the toggle."
          value={body}
          maxLength={POST_BODY_MAX + 200}
          autoFocus={autoFocus}
          aria-label="Write a post"
          aria-describedby="community-composer-count"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />

        {variant === "inline" && (
        <div className={styles.composer_footer}>
          <div className={styles.composer_tools}>
            <span className={styles.counter} id="community-composer-count" data-over={isOver}>
              {body.length}/{POST_BODY_MAX}
            </span>
            <button
              type="button"
              className={styles.chip}
              data-active={isSpoiler}
              aria-pressed={isSpoiler}
              onClick={() => setIsSpoiler((current) => !current)}
            >
              Spoiler
            </button>
          </div>

          <button type="button" className={styles.button} onClick={() => void submit()} disabled={!canSubmit}>
            {isSubmitting ? "Posting…" : "Post"}
          </button>
        </div>
        )}

        {error && (
          <p className={styles.errors} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );

  if (variant === "sheet") {
    return (
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="New post">
        <div className={styles.sheet_head}>
          <span className={styles.sheet_title}>New post</span>
          <button type="button" className={styles.button_link} onClick={onRequestClose}>
            Cancel
          </button>
        </div>
        <div className={styles.sheet_body}>{form}</div>
        <div className={styles.sheet_footer}>
          <div className={styles.composer_tools}>
            <span className={styles.counter} data-over={isOver}>
              {body.length}/{POST_BODY_MAX}
            </span>
            <button
              type="button"
              className={styles.chip}
              data-active={isSpoiler}
              aria-pressed={isSpoiler}
              onClick={() => setIsSpoiler((current) => !current)}
            >
              Spoiler
            </button>
          </div>
          <button type="button" className={styles.button} onClick={() => void submit()} disabled={!canSubmit}>
            {isSubmitting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    );
  }

  return <div className={styles.card}>{form}</div>;
}
