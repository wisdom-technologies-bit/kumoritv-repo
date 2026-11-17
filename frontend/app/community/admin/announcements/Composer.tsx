"use client";

// Phase 4, part B2: the composer.
//
// Write on the left, the real renderer on the right (tabs on a phone), a confirm
// step that shows the exact preview and says plainly whether a push goes out,
// and a recent-announcements list with Edit / Expire now / Delete. Drafts live in
// localStorage so a closed tab does not lose the text.
//
// Idempotency: ONE client-generated UUID per compose attempt. A double click
// sends the same key, the unique index rejects the second insert, and the API
// returns the first row's id - so the only thing a double click can do is
// nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AnnouncementMarkdown from "@/app/lib/community/markdown";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementStatus,
  validateAnnouncementInput,
} from "@/app/lib/community/announcement-form";
import { insertMarkdown, type MarkdownCommand } from "@/app/lib/community/markdown-insert";
import styles from "./Composer.module.css";

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  image: string | null;
  url: string | null;
  createdAt: string;
  expiresAt: string | null;
  pushed: boolean;
};

const DRAFT_KEY = "kumori.announcement.draft";

type Draft = {
  title: string;
  body: string;
  image: string;
  url: string;
  expiresAt: string;
  sendPush: boolean;
};

const EMPTY: Draft = { title: "", body: "", image: "", url: "", expiresAt: "", sendPush: true };

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed?.body !== "string" && typeof parsed?.title !== "string") return null;
    return {
      title: String(parsed.title ?? ""),
      body: String(parsed.body ?? ""),
      image: String(parsed.image ?? ""),
      url: String(parsed.url ?? ""),
      expiresAt: String(parsed.expiresAt ?? ""),
      sendPush: parsed.sendPush !== false,
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* private mode: the form still works, it just will not survive a reload */
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the VIEWER's timezone. */
function localInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(local: string): string | null {
  if (!local) return null;
  const parsed = Date.parse(local);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

const TOOLBAR: Array<{ command: MarkdownCommand; label: string; hint: string }> = [
  { command: "heading", label: "H", hint: "Heading" },
  { command: "bold", label: "B", hint: "Bold" },
  { command: "italic", label: "I", hint: "Italic" },
  { command: "link", label: "Link", hint: "Link" },
  { command: "list", label: "List", hint: "List" },
  { command: "quote", label: "Quote", hint: "Quote" },
];

export default function Composer({ initialRows }: { initialRows: AdminAnnouncement[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const keyRef = useRef<string | null>(null);

  // A draft only fills an empty, new form - never an edit.
  useEffect(() => {
    const stored = readDraft();
    if (stored) setDraft(stored);
  }, []);

  const payload = useMemo(
    () => ({
      title: draft.title,
      body: draft.body,
      image: draft.image || null,
      url: draft.url || null,
      expiresAt: toIso(draft.expiresAt),
      sendPush: draft.sendPush,
    }),
    [draft],
  );

  const validation = useMemo(() => validateAnnouncementInput(payload), [payload]);
  const fieldError = !validation.ok ? validation.field : "";
  const message = !validation.ok ? validation.message : "";

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (!editingId) writeDraft(next);
      return next;
    });
    setError("");
    setNotice("");
  }, [editingId]);

  function applyCommand(command: MarkdownCommand) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = insertMarkdown(
      draft.body,
      textarea.selectionStart ?? draft.body.length,
      textarea.selectionEnd ?? draft.body.length,
      command,
    );
    update({ body: result.value });
    // Put the caret back after React has written the new value.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  function beginEdit(row: AdminAnnouncement) {
    setEditingId(row.id);
    setStage("form");
    setError("");
    setNotice("");
    setDraft({
      title: row.title,
      body: row.body,
      image: row.image ?? "",
      url: row.url ?? "",
      expiresAt: localInputValue(row.expiresAt),
      sendPush: false,
    });
  }

  function resetForm() {
    setEditingId(null);
    setStage("form");
    setDraft(EMPTY);
    keyRef.current = null;
    clearDraft();
  }

  async function publish() {
    if (!validation.ok || busy) return;
    setBusy(true);
    setError("");
    try {
      const key = keyRef.current ?? (keyRef.current = crypto.randomUUID());
      const url = editingId
        ? `/api/community/admin/announcements/${editingId}`
        : "/api/community/admin/announcements";
      const response = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingId ? payload : { ...payload, idempotencyKey: key }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        message?: string;
        field?: string;
      };
      if (!response.ok || !result.ok) {
        setError(result.message || "That could not be saved. Please try again.");
        return;
      }
      setNotice(editingId ? "Saved. The push was not re-sent." : "Published.");
      resetForm();
      router.refresh();
    } catch {
      setError("That could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function expireNow(row: AdminAnnouncement) {
    setBusy(true);
    setError("");
    try {
      // Two seconds ahead: the validator only accepts a future instant, and two
      // seconds is the smallest honest "now" that satisfies it.
      const expiresAt = new Date(Date.now() + 2_000).toISOString();
      const response = await fetch(`/api/community/admin/announcements/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: row.title,
          body: row.body,
          image: row.image,
          url: row.url,
          expiresAt,
          sendPush: false,
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        setError(result.message || "That announcement could not be expired.");
        return;
      }
      setNotice("Expired.");
      router.refresh();
    } catch {
      setError("That announcement could not be expired.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AdminAnnouncement) {
    if (!window.confirm(`Delete “${row.title}”? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/community/admin/announcements/${row.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        setError(result.message || "That announcement could not be deleted.");
        return;
      }
      setNotice("Deleted.");
      if (editingId === row.id) resetForm();
      router.refresh();
    } catch {
      setError("That announcement could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const pushLine = draft.sendPush
    ? "A push notification will be sent to everyone who has announcements turned on."
    : "No push will be sent. The announcement still appears on the site and in the bell.";

  return (
    <div className={styles.wrap}>
      {notice ? (
        <p className={styles.notice} role="status" data-testid="composer-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert" data-testid="composer-error">
          {error}
        </p>
      ) : null}

      {stage === "confirm" ? (
        <section className={styles.confirm} data-testid="composer-confirm" aria-labelledby="confirm-heading">
          <h2 className={styles.confirm_title} id="confirm-heading">
            {editingId ? "Save these changes?" : "Publish this announcement?"}
          </h2>
          <p className={styles.confirm_push}>{editingId ? "Editing never re-sends a push." : pushLine}</p>
          <div className={styles.confirm_preview}>
            <h3 className={styles.confirm_announcement_title}>{draft.title || "Untitled"}</h3>
            <AnnouncementMarkdown body={draft.body} />
          </div>
          <div className={styles.confirm_actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void publish()}
              disabled={busy}
              data-testid="composer-confirm-publish"
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Publish now"}
            </button>
            <button type="button" className={styles.ghost} onClick={() => setStage("form")} disabled={busy}>
              Back to editing
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className={styles.mobile_tabs} role="tablist" aria-label="Composer view">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "write"}
              className={`${styles.tab} ${tab === "write" ? styles.tab_active : ""}`}
              onClick={() => setTab("write")}
            >
              Write
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "preview"}
              className={`${styles.tab} ${tab === "preview" ? styles.tab_active : ""}`}
              onClick={() => setTab("preview")}
            >
              Preview
            </button>
          </div>

          <div className={styles.grid}>
            <section className={`${styles.pane} ${tab === "preview" ? styles.pane_hidden_mobile : ""}`}>
              <label className={styles.label} htmlFor="announcement-title">
                Title
                <span className={styles.counter}>
                  {draft.title.length}/{ANNOUNCEMENT_TITLE_MAX}
                </span>
              </label>
              <input
                id="announcement-title"
                className={styles.input}
                value={draft.title}
                onChange={(event) => update({ title: event.target.value })}
                maxLength={ANNOUNCEMENT_TITLE_MAX}
                placeholder="Service Update: KumoriTV Is Back Online!"
                aria-invalid={fieldError === "title"}
                data-testid="composer-title"
              />

              <label className={styles.label} htmlFor="announcement-body">
                Body (Markdown)
                <span className={styles.counter}>
                  {draft.body.length}/{ANNOUNCEMENT_BODY_MAX}
                </span>
              </label>
              <div className={styles.toolbar} role="toolbar" aria-label="Markdown">
                {TOOLBAR.map((item) => (
                  <button
                    key={item.command}
                    type="button"
                    className={styles.tool}
                    onClick={() => applyCommand(item.command)}
                    title={item.hint}
                    aria-label={item.hint}
                    data-testid={`toolbar-${item.command}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <textarea
                id="announcement-body"
                ref={textareaRef}
                className={styles.textarea}
                value={draft.body}
                onChange={(event) => update({ body: event.target.value })}
                maxLength={ANNOUNCEMENT_BODY_MAX}
                rows={16}
                placeholder={"# Heading\n\nSome **bold** text, a [link](https://kumoritv.top) and a list:\n\n- one\n- two"}
                aria-invalid={fieldError === "body"}
                data-testid="composer-body"
              />

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="announcement-image">
                    Image URL (optional)
                  </label>
                  <input
                    id="announcement-image"
                    className={styles.input}
                    value={draft.image}
                    onChange={(event) => update({ image: event.target.value })}
                    placeholder="https://…"
                    inputMode="url"
                    aria-invalid={fieldError === "image"}
                    data-testid="composer-image"
                  />
                  <span className={styles.helper}>https only. Shown under the body.</span>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="announcement-url">
                    “Read more” link (optional)
                  </label>
                  <input
                    id="announcement-url"
                    className={styles.input}
                    value={draft.url}
                    onChange={(event) => update({ url: event.target.value })}
                    placeholder="https://…"
                    inputMode="url"
                    aria-invalid={fieldError === "url"}
                    data-testid="composer-url"
                  />
                  <span className={styles.helper}>https only. Opens in a new tab.</span>
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="announcement-expiry">
                    Expiry (optional)
                  </label>
                  <input
                    id="announcement-expiry"
                    className={styles.input}
                    type="datetime-local"
                    value={draft.expiresAt}
                    onChange={(event) => update({ expiresAt: event.target.value })}
                    aria-invalid={fieldError === "expiresAt"}
                    data-testid="composer-expiry"
                  />
                  <span className={styles.helper}>
                    Your local time. Stored in UTC. Empty means it never expires.
                  </span>
                </div>

                <label className={styles.checkbox_row}>
                  <input
                    type="checkbox"
                    checked={draft.sendPush}
                    onChange={(event) => update({ sendPush: event.target.checked })}
                    disabled={Boolean(editingId)}
                    data-testid="composer-send-push"
                  />
                  <span>
                    Send push notification
                    <span className={styles.helper}>
                      {editingId ? "Editing an announcement never re-sends its push." : "Defaults to on. Honours each reader's own announcement preference."}
                    </span>
                  </span>
                </label>
              </div>

              {message ? (
                <p className={styles.field_error} role="alert">
                  {message}
                </p>
              ) : null}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => setStage("confirm")}
                  disabled={!validation.ok || busy}
                  data-testid="composer-publish"
                >
                  {editingId ? "Review changes" : "Publish"}
                </button>
                {editingId ? (
                  <button type="button" className={styles.ghost} onClick={resetForm} disabled={busy}>
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </section>

            <section
              className={`${styles.pane} ${styles.preview_pane} ${tab === "write" ? styles.pane_hidden_mobile : ""}`}
              aria-label="Preview"
            >
              <p className={styles.preview_label}>Preview</p>
              <h2 className={styles.preview_title}>{draft.title || "Untitled announcement"}</h2>
              <AnnouncementMarkdown body={draft.body || "_Nothing written yet._"} />
            </section>
          </div>
        </>
      )}

      <section className={styles.recent} aria-labelledby="recent-heading">
        <h2 className={styles.recent_title} id="recent-heading">
          Recent announcements
        </h2>
        {initialRows.length === 0 ? (
          <p className={styles.helper}>Nothing yet. The first one you publish lands here.</p>
        ) : (
          <ul className={styles.recent_list}>
            {initialRows.map((row) => {
              const status = announcementStatus(row.expiresAt);
              return (
                <li key={row.id} className={styles.recent_item}>
                  <div className={styles.recent_main}>
                    <p className={styles.recent_row_title}>{row.title}</p>
                    <p className={styles.recent_meta}>
                      {new Date(row.createdAt).toLocaleString()} ·{" "}
                      <span data-status={status}>{status}</span> · {row.pushed ? "push sent" : "no push"}
                    </p>
                  </div>
                  <div className={styles.recent_actions}>
                    <button type="button" className={styles.small} onClick={() => beginEdit(row)} disabled={busy}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.small}
                      onClick={() => void expireNow(row)}
                      disabled={busy || status === "expired"}
                    >
                      Expire now
                    </button>
                    <button
                      type="button"
                      className={`${styles.small} ${styles.danger}`}
                      onClick={() => void remove(row)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
