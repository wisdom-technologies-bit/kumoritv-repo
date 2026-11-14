"use client";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import { Avatar } from "./shared";
import { POST_BODY_MAX } from "@/app/lib/community/constants";
import { extractClipUrl } from "@/app/lib/community/clip-url";
import { readAttachmentFromPreview, type AttachedClip } from "@/app/lib/community/clip-attachment";
import ClipAttachmentCard from "./ClipAttachmentCard";
import ClipPicker, { type ClipPickerAnchor } from "./ClipPicker";

const DRAFT_KEY = "kumori:community:draft";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A draft keeps its attachment: the CODE only, then the clip is resolved again
 * on the next visit, so a title that changed (or a clip that was deleted) is
 * never shown from stale storage - and a masked adult clip is masked again by
 * the server rather than remembered as visible.
 */
type Draft = { body: string; isSpoiler: boolean; clipCode?: string | null; savedAt: number };

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (typeof parsed?.body !== "string") return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    return {
      body: parsed.body.slice(0, POST_BODY_MAX),
      isSpoiler: parsed.isSpoiler === true,
      clipCode: typeof parsed.clipCode === "string" && parsed.clipCode ? parsed.clipCode : null,
      savedAt: parsed.savedAt,
    };
  } catch {
    // Private mode, quota, corrupted JSON: a draft is a convenience, never a
    // reason to break the composer.
    return null;
  }
}

function writeDraft(body: string, isSpoiler: boolean, clipCode: string | null) {
  try {
    // An empty box with a clip attached is still a draft: the attachment is the
    // post, and losing it on a refresh would be worse than losing text.
    if (!body.trim() && !clipCode) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ body, isSpoiler, clipCode, savedAt: Date.now() }),
    );
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
  onSubmit: (input: { body: string; isSpoiler: boolean; clip: AttachedClip | null }) => Promise<ComposeResult>;
  onGuestWrite: () => void;
  /** "sheet" is the full-screen mobile composer: same body, different chrome. */
  variant?: "inline" | "sheet";
  autoFocus?: boolean;
  onRequestClose?: () => void;
  /** The viewer's adult setting: wording only, the server decides what is sent. */
  showAdult?: boolean;
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
  showAdult = false,
}: ComposerProps) {
  const [body, setBody] = useState("");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [canPortal, setCanPortal] = useState(false);
  const [clip, setClip] = useState<AttachedClip | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<ClipPickerAnchor | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addClipRef = useRef<HTMLButtonElement>(null);

  // The sheet has to escape .page (position: relative; z-index: 1), otherwise it
  // paints under the site header and the header eats the clicks on its controls.
  useEffect(() => setCanPortal(true), []);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setBody(draft.body);
      setIsSpoiler(draft.isSpoiler);
      if (draft.clipCode) {
        // Resolved through the public clip route, so an adult clip is masked by
        // the server again rather than trusted from localStorage.
        void (async () => {
          try {
            const response = await fetch(`/api/clips/${encodeURIComponent(draft.clipCode as string)}`, {
              headers: { accept: "application/json" },
            });
            if (!response.ok) return;
            const payload = (await response.json().catch(() => ({}))) as { preview?: unknown };
            if (payload.preview) {
              setClip(readAttachmentFromPreview({ ...(payload.preview as object), code: draft.clipCode }));
            }
          } catch {
            /* a draft clip that will not resolve is simply dropped */
          }
        })();
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    writeDraft(body, isSpoiler, clip?.code ?? null);
  }, [body, isSpoiler, clip, isHydrated]);

  // Grow with the text, up to the CSS max-height.
  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 320)}px`;
  }, [body]);

  const remaining = POST_BODY_MAX - body.trim().length;
  const isOver = remaining < 0;
  // A clip on its own is a post: the server fills in a default body.
  const canSubmit = isSignedIn && !isSubmitting && !isOver && (body.trim().length > 0 || Boolean(clip));

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    const result = await onSubmit({ body, isSpoiler, clip });
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.message || "We could not post that. Please try again.");
      return;
    }
    setBody("");
    setIsSpoiler(false);
    setClip(null);
    setPasteNote(null);
    clearDraft();
  }, [body, canSubmit, clip, isSpoiler, onSubmit]);

  // A guest sees the invitation, never a form: the API and RLS refuse writes
  // anyway, so the copy explains that instead of pretending.
  if (!isSignedIn) {
    const guest = (
      <>
        <div className={styles.signin_copy}>
          <span className={styles.signin_title}>Sign in to post</span>
          <span className={styles.signin_text}>
            Anyone can read the community. Posting and commenting need an account.
          </span>
        </div>
        <button type="button" className={styles.button} onClick={onGuestWrite}>
          Sign in
        </button>
      </>
    );

    // The mobile sheet has to open for a guest too (it is the only composer on
    // a phone). It used to return the inline card here, so tapping "+" produced
    // no dialog at all while the body scroll stayed locked.
    if (variant === "sheet") {
      const guestSheet = (
        <div className={`${styles.sheet} ${styles.sheet_guest}`} role="dialog" aria-modal="true" aria-label="New post">
          <div className={styles.sheet_head}>
            <span className={styles.sheet_title}>New post</span>
            <button type="button" className={styles.button_link} onClick={onRequestClose}>
              Close
            </button>
          </div>
          <div className={`${styles.sheet_body} ${styles.signin_card}`}>{guest}</div>
        </div>
      );
      return canPortal && typeof document !== "undefined" ? createPortal(guestSheet, document.body) : guestSheet;
    }

    return <div className={`${styles.card} ${styles.signin_card}`}>{guest}</div>;
  }

  // ------------------------------------------------------- clip attachment ---
  // Resolve a code through the public clip route and attach it. One attachment
  // per post, so an existing one is replaced only after a successful resolve.
  const attachCode = useCallback(async (code: string) => {
    try {
      const response = await fetch(`/api/clips/${encodeURIComponent(code)}`, {
        headers: { accept: "application/json" },
      });
      if (response.status === 404) {
        setPasteNote("That clip is no longer available.");
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { preview?: unknown };
      if (!response.ok || !payload.preview) {
        setPasteNote("We could not attach that clip. Try again.");
        return;
      }
      setClip(readAttachmentFromPreview({ ...(payload.preview as object), code }));
      setPasteNote(null);
    } catch {
      setPasteNote("We could not attach that clip. Check your connection.");
    }
  }, []);

  /**
   * A clip link typed or pasted anywhere in the box becomes the attachment and
   * is removed from the text; every other URL stays exactly where it is and is
   * linkified later by the feed. Returns true when something was attached.
   */
  const handleTextWithClip = useCallback(
    (value: string): string => {
      const found = extractClipUrl(value);
      if (!found) return value;
      void attachCode(found.code);
      return found.text;
    },
    [attachCode],
  );

  const openPicker = useCallback(() => {
    const rect = addClipRef.current?.getBoundingClientRect();
    setPickerAnchor(
      rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
    );
    setPickerOpen(true);
  }, []);

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
          aria-describedby="community-composer-count community-composer-attach"
          onChange={(event) => setBody(handleTextWithClip(event.target.value))}
          onPaste={(event) => {
            const text = event.clipboardData?.getData("text") ?? "";
            if (!extractClipUrl(text)) return; // an ordinary paste stays ordinary
            event.preventDefault();
            const area = event.currentTarget;
            const start = area.selectionStart ?? body.length;
            const end = area.selectionEnd ?? body.length;
            const merged = `${body.slice(0, start)}${text}${body.slice(end)}`;
            const stripped = handleTextWithClip(merged);
            setBody(stripped);
            window.requestAnimationFrame(() => {
              const caret = Math.max(0, stripped.length);
              area.setSelectionRange(caret, caret);
            });
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />

        <div id="community-composer-attach" className={styles.attach_area}>
          {clip ? (
            <>
              <ClipAttachmentCard clip={clip} onRemove={() => setClip(null)} />
              <p className={styles.attach_note}>Clip attached</p>
            </>
          ) : (
            pasteNote && <p className={styles.attach_note} role="status">{pasteNote}</p>
          )}
        </div>

        {variant === "inline" && (
        <div className={styles.composer_footer}>
          <div className={styles.composer_tools}>
            <span className={styles.counter} id="community-composer-count" data-over={isOver}>
              {body.length}/{POST_BODY_MAX}
            </span>
            <button
              ref={addClipRef}
              type="button"
              className={styles.chip}
              data-active={Boolean(clip)}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={openPicker}
              disabled={isSubmitting}
            >
              {clip ? "Clip attached" : "Add clip"}
            </button>
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
    const sheet = (
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
              ref={addClipRef}
              type="button"
              className={styles.chip}
              data-active={Boolean(clip)}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={openPicker}
              disabled={isSubmitting}
            >
              {clip ? "Clip attached" : "Add clip"}
            </button>
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

    if (!(canPortal && typeof document !== "undefined")) return sheet;
    return createPortal(
      <>
        {sheet}
        <ClipPicker
          open={pickerOpen}
          anchor={pickerAnchor}
          onClose={() => {
            setPickerOpen(false);
            addClipRef.current?.focus({ preventScroll: true });
          }}
          onPick={(picked) => setClip(picked)}
          showAdult={showAdult}
        />
      </>,
      document.body,
    );
  }

  return (
    <div className={styles.card}>
      {form}
      <ClipPicker
        open={pickerOpen}
        anchor={pickerAnchor}
        onClose={() => {
          setPickerOpen(false);
          addClipRef.current?.focus({ preventScroll: true });
        }}
        onPick={(picked) => setClip(picked)}
        showAdult={showAdult}
      />
    </div>
  );
}
