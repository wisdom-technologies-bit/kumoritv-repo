"use client";

// Prompt 35: the My clips list.
//
// Copy, rename and delete only. A clip is a link, so there is nothing to
// download or export here.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import styles from "./component.module.css";
import { formatTime } from "@/app/lib/clips/time";

export type MyClipItem = {
  code: string;
  anilistId: number;
  episode: number;
  start: number;
  end: number;
  title: string | null;
  audio: "sub" | "dub" | null;
  views: number;
  createdAt: string;
  animeTitle: string;
  thumbnail: string;
};

const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export default function MyClipsList({ items }: { items: MyClipItem[] }) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const clipUrl = (code: string) =>
    typeof window === "undefined" ? `/clip/${code}` : new URL(`/clip/${code}`, window.location.origin).toString();

  const copy = async (code: string) => {
    const url = clipUrl(code);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
      } catch {
        /* the field below still shows the link */
      }
      input.remove();
    }
    setCopied(code);
    setTimeout(() => setCopied((current) => (current === code ? null : current)), 2000);
  };

  const rename = async (code: string) => {
    setBusy(code);
    setError("");
    try {
      const response = await fetch(`/api/clips/${code}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draft.trim() ? draft.trim() : null }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.message || "Could not rename that clip.");
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError("Could not rename that clip.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (code: string) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this clip link?")) return;
    setBusy(code);
    setError("");
    try {
      const response = await fetch(`/api/clips/${code}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.message || "Could not delete that clip.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not delete that clip.");
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) {
    return (
      <p className={styles.empty} data-testid="clips-empty">
        No clips yet. Press <strong>Clip</strong> under any episode to make one.
      </p>
    );
  }

  return (
    <div className={styles.wrapper} data-testid="clips-list">
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.code} className={styles.item} data-testid="clip-row" data-code={item.code}>
            <Link href={`/clip/${item.code}`} className={styles.thumb} aria-label={`Open clip ${item.code}`}>
              <Image src={item.thumbnail} alt="" fill sizes="120px" />
            </Link>

            <div className={styles.body}>
              {editing === item.code ? (
                <div className={styles.rename}>
                  <label className="sr-only" htmlFor={`rename-${item.code}`}>
                    Clip title
                  </label>
                  <input
                    id={`rename-${item.code}`}
                    className={styles.input}
                    value={draft}
                    maxLength={80}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => rename(item.code)}
                    disabled={busy === item.code}
                  >
                    Save
                  </button>
                  <button type="button" className={styles.quiet} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <p className={styles.title}>
                  <Link href={`/clip/${item.code}`}>
                    {item.title || `${item.animeTitle} clip`}
                  </Link>
                </p>
              )}

              <p className={styles.meta}>
                {item.animeTitle} · Ep {item.episode} · {formatTime(item.start)}-{formatTime(item.end)}
                {item.audio ? ` · ${item.audio.toUpperCase()}` : ""}
              </p>

              <p className={styles.sub}>
                {dateLabel(item.createdAt)} · {item.views} {item.views === 1 ? "view" : "views"}
              </p>

              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={() => copy(item.code)}>
                  {copied === item.code ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setEditing(item.code);
                    setDraft(item.title ?? "");
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => remove(item.code)}
                  disabled={busy === item.code}
                >
                  Delete
                </button>
                <Link className={styles.quiet} href={`/watch/${item.anilistId}?ep=${item.episode}`}>
                  Full episode
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
