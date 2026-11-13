"use client";
import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import { REPORT_DETAILS_MAX, REPORT_REASONS } from "@/app/lib/community/constants";

const REASON_LABELS: Record<string, string> = {
  spam: "Spam or advertising",
  harassment: "Harassment or hate",
  spoiler: "Untagged spoiler",
  inappropriate: "Inappropriate content",
  copyright: "Copyright",
  other: "Something else",
};

type ReportDialogProps = {
  targetKind: "post" | "comment" | "announcement";
  targetId: string;
  onClose: () => void;
};

/** One small dialog for every reportable thing. Guests may report too. */
export default function ReportDialog({ targetKind, targetId, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState<string>("spam");
  const [details, setDetails] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function send() {
    setIsSending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/community/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_kind: targetKind,
          target_id: targetId,
          reason,
          details: details.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setMessage(payload.message || "We could not send that report.");
        setIsSending(false);
        return;
      }
      setDone(true);
    } catch {
      setMessage("We could not send that report. Check your connection.");
    }
    setIsSending(false);
  }

  return (
    <div className={styles.dialog_backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="community-report-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className={styles.dialog_title} id="community-report-title">
          {done ? "Thanks for the report" : "Report this"}
        </h3>

        {done ? (
          <>
            <p className={styles.dialog_text}>
              A moderator will look at it. You will not get a reply, but every report is read.
            </p>
            <div className={styles.dialog_actions}>
              <button type="button" className={styles.button} onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.field_label} htmlFor="community-report-reason">
                Reason
              </label>
              <select
                id="community-report-reason"
                className={styles.select}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                {REPORT_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {REASON_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.field_label} htmlFor="community-report-details">
                Anything else? (optional)
              </label>
              <textarea
                id="community-report-details"
                className={styles.textarea}
                maxLength={REPORT_DETAILS_MAX}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
            </div>

            {message && (
              <p className={styles.errors} role="alert">
                {message}
              </p>
            )}

            <div className={styles.dialog_actions}>
              <button type="button" className={`${styles.button} ${styles.button_ghost}`} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={styles.button} onClick={() => void send()} disabled={isSending}>
                {isSending ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
