"use client";
// Small toast for AniList login messages (cancelled login, failed account sync).
// The login helper emits a DOM event so the header does not have to thread state
// through every caller.
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import { ANILIST_NOTICE_EVENT } from "@/app/lib/user/anilistLogin";

const DISMISS_AFTER_MS = 12000;

export default function AnilistNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function handleNotice(event: Event) {
      const detail = (event as CustomEvent<string>).detail;

      if (typeof detail === "string" && detail.trim()) setMessage(detail.trim());
    }

    window.addEventListener(ANILIST_NOTICE_EVENT, handleNotice as EventListener);

    return () => window.removeEventListener(ANILIST_NOTICE_EVENT, handleNotice as EventListener);
  }, []);

  useEffect(() => {
    if (!message) return;

    const timer = window.setTimeout(() => setMessage(null), DISMISS_AFTER_MS);

    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div
      className={styles.notice}
      role="status"
      aria-live="polite"
      data-anilist-notice="true"
    >
      <p>{message}</p>

      <button
        type="button"
        onClick={() => setMessage(null)}
        aria-label="Dismiss notification"
        className={styles.notice_close}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
