"use client";
// Phase 6, part B: the buttons a moderator uses, in context.
//
// One request at a time (every button is disabled while a request is in flight,
// so a double click cannot send two actions), an explicit confirm step for
// anything destructive, an optimistic status that rolls back on failure, and a
// polite live region for the outcome.
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../admin.module.css";

const PRESETS: [string, string][] = [
  ["spam", "Spam"],
  ["harassment", "Harassment"],
  ["spoiler", "Spoiler"],
  ["inappropriate", "Inappropriate"],
  ["copyright", "Copyright"],
  ["other", "Other"],
];

type Props = {
  kind: "post" | "comment" | "announcement" | "clip";
  id: string;
  status: string;
  reportIds?: string[];
  /** For a clip: dismissing targets every open clip report on it. */
  clipId?: string;
  reportsCount?: number;
  compact?: boolean;
};

type Action = "hide" | "unhide" | "remove" | "restore";

const NEXT_STATUS: Record<Action, string> = {
  hide: "hidden",
  unhide: "published",
  remove: "removed",
  restore: "published",
};

export default function ModerationActions({
  kind,
  id,
  status,
  reportIds = [],
  clipId,
  reportsCount = 0,
  compact = false,
}: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("spam");
  const [note, setNote] = useState("");

  async function send(action: Action) {
    if (busy) return;
    if (action === "remove" && reason.trim().length < 3) {
      setError("Pick a reason first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const before = current;
    setCurrent(NEXT_STATUS[action]);

    try {
      const response = await fetch("/api/community/admin/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, action, reason: action === "remove" ? reason.trim() : null }),
      });
      const body = await response.json().catch(() => ({}));

      if (response.status === 409) {
        setCurrent(body.status ?? before);
        setError(`Already ${body.status ?? "in that state"}.`);
        return;
      }
      if (!response.ok) {
        setCurrent(before);
        setError("That did not go through. Try again.");
        return;
      }
      setCurrent(body.status ?? NEXT_STATUS[action]);
      setMessage(action === "remove" ? "Removed." : action === "hide" ? "Hidden." : "Restored.");
      router.refresh();
    } catch {
      setCurrent(before);
      setError("That did not go through. Check your connection and try again.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const dismissCount = reportIds.length > 0 ? reportIds.length : reportsCount;
  const canDismiss = reportIds.length > 0 || (Boolean(clipId) && reportsCount > 0);

  async function dismissReports() {
    if (busy || !canDismiss) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/community/admin/reports/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          clipId ? { clipIds: [clipId], note: note.trim() || null } : { ids: reportIds, note: note.trim() || null },
        ),
      });
      if (!response.ok) {
        setError("The reports were not dismissed. Try again.");
        return;
      }
      setMessage("Reports dismissed.");
      router.refresh();
    } catch {
      setError("The reports were not dismissed. Check your connection.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const isHidden = current === "hidden";
  const isRemoved = current === "removed" || current === "gone";

  return (
    <div className={compact ? styles.actions_compact : styles.actions}>
      {!isRemoved && (
        <button
          type="button"
          className={styles.button}
          disabled={busy || isHidden}
          onClick={() => setPending(pending === "hide" ? null : "hide")}
        >
          {isHidden ? "Hidden" : "Hide"}
        </button>
      )}
      {!isRemoved && pending === "hide" && (
        <span className={styles.confirm_row}>
          <span className={styles.small}>Hide this from everyone but the author?</span>
          <button type="button" className={styles.button_primary} disabled={busy} onClick={() => send("hide")}>
            Yes, hide
          </button>
          <button type="button" className={styles.button} disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </span>
      )}

      {!isRemoved && (
        <button
          type="button"
          className={styles.button_danger}
          disabled={busy}
          onClick={() => setPending(pending === "remove" ? null : "remove")}
        >
          Remove
        </button>
      )}
      {!isRemoved && pending === "remove" && (
        <div className={styles.confirm_block}>
          <label className={styles.field_label} htmlFor={`reason-${kind}-${id}`}>
            Why is this being removed? (shown to the author)
          </label>
          <select
            id={`reason-${kind}-${id}`}
            className={styles.select}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
          >
            {PRESETS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className={styles.confirm_row}>
            <button type="button" className={styles.button_danger} disabled={busy} onClick={() => send("remove")}>
              Yes, remove
            </button>
            <button type="button" className={styles.button} disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {(isHidden || isRemoved) && (
        <>
          <button
            type="button"
            className={styles.button_primary}
            disabled={busy}
            onClick={() => setPending(pending === "restore" ? null : "restore")}
          >
            Restore
          </button>
          {pending === "restore" && (
            <span className={styles.confirm_row}>
              <span className={styles.small}>Publish it again?</span>
              <button type="button" className={styles.button_primary} disabled={busy} onClick={() => send("restore")}>
                Yes, restore
              </button>
              <button type="button" className={styles.button} disabled={busy} onClick={() => setPending(null)}>
                Cancel
              </button>
            </span>
          )}
        </>
      )}

      {canDismiss && (
        <>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => setPending(pending === "unhide" ? null : "unhide")}
          >
            Dismiss {dismissCount} report{dismissCount === 1 ? "" : "s"}
          </button>
          {pending === "unhide" && (
            <div className={styles.confirm_block}>
              <label className={styles.field_label} htmlFor={`note-${kind}-${id}`}>
                Note (optional, kept in the report trail)
              </label>
              <input
                id={`note-${kind}-${id}`}
                className={styles.input}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
              />
              <span className={styles.confirm_row}>
                <button type="button" className={styles.button_primary} disabled={busy} onClick={dismissReports}>
                  Yes, dismiss
                </button>
                <button type="button" className={styles.button} disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </span>
            </div>
          )}
        </>
      )}

      <span className={styles.sr_only} role="status" aria-live="polite">
        {message ?? ""}
      </span>
      {message && <span className={styles.small}>{message}</span>}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
