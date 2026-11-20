"use client";
// Small toast for AniList login messages. The login helper emits a DOM event so
// the header does not have to thread state through every caller.
//
// The human sentence is the headline; the short code ("code: ANILIST_VIEWER_401")
// is small print, so a phone screenshot is enough to diagnose the failure.
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import { ANILIST_NOTICE_EVENT } from "@/app/lib/user/anilistLogin";

const DISMISS_AFTER_MS = 12000;

type NoticeDetail = { message?: string; code?: string } | string;

export default function AnilistNotice() {
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    function handleNotice(event: Event) {
      const detail = (event as CustomEvent<NoticeDetail>).detail;

      if (typeof detail === "string") {
        if (detail.trim()) {
          setMessage(detail.trim());
          setCode(null);
        }

        return;
      }

      if (detail && typeof detail.message === "string" && detail.message.trim()) {
        setMessage(detail.message.trim());
        setCode(typeof detail.code === "string" ? detail.code : null);
      }
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

      {code && (
        <p className={styles.notice_code} data-anilist-code={code}>
          code: {code}
        </p>
      )}

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
