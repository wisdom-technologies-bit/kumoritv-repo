"use client";

// Prompt 35: "Report clip".
//
// The repo had no report form to reuse for clips, so this posts to the small
// `clip_reports` route and always offers the contact address as a fallback.

import { useState } from "react";
import { LEGAL_CONTACT_EMAIL } from "@/app/lib/legal/content";
import styles from "./component.module.css";

const REASONS = [
  { value: "copyright", label: "Copyright" },
  { value: "broken", label: "The clip does not play" },
  { value: "inappropriate", label: "Inappropriate" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

export default function ReportClip({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("copyright");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const mailto = `mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(
    `Report clip ${code}`,
  )}&body=${encodeURIComponent(`Clip: ${code}\nReason: ${reason}\n\n`)}`;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    try {
      const response = await fetch(`/api/clips/${encodeURIComponent(code)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, details: details.trim() || null }),
      });
      setStatus(response.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        data-testid="clip-report-open"
      >
        Report clip
      </button>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} data-testid="clip-report-form">
      <label className={styles.label} htmlFor="clip-report-reason">
        Why are you reporting this clip?
      </label>
      <select
        id="clip-report-reason"
        className={styles.select}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={status === "sending" || status === "sent"}
      >
        {REASONS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>

      <label className={styles.label} htmlFor="clip-report-details">
        Anything else? <span className={styles.muted}>(optional)</span>
      </label>
      <textarea
        id="clip-report-details"
        className={styles.textarea}
        value={details}
        maxLength={500}
        rows={2}
        onChange={(event) => setDetails(event.target.value)}
        disabled={status === "sending" || status === "sent"}
      />

      {status === "sent" ? (
        <p className={styles.note} role="status">
          Thanks, we have your report.
        </p>
      ) : null}
      {status === "error" ? (
        <p className={styles.error} role="alert">
          Could not send that. Email{" "}
          <a href={mailto}>{LEGAL_CONTACT_EMAIL}</a> instead.
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled={status === "sending" || status === "sent"}>
          {status === "sending" ? "Sending…" : "Send report"}
        </button>
        <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <a className={styles.mail} href={mailto}>
          Email us
        </a>
      </div>
    </form>
  );
}
