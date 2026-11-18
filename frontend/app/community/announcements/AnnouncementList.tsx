"use client";

// "Load more" for the announcements index: keyset on the cursor the server sent,
// appended never replaced, and a closing line when the cursor runs out.

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import AnnouncementMarkdown from "@/app/lib/community/markdown";

export type AnnouncementListItem = {
  id: string;
  title: string;
  /** Part B: the source, so the card can render the same marked-up preview. */
  body?: string | null;
  excerpt: string;
  image: string | null;
  createdAt: string;
};

export default function AnnouncementList({
  initialItems,
  initialNextBefore,
}: {
  initialItems: AnnouncementListItem[];
  initialNextBefore: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextBefore, setNextBefore] = useState(initialNextBefore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadMore() {
    if (!nextBefore || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/community/announcements?limit=10&before=${encodeURIComponent(nextBefore)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as {
        items?: AnnouncementListItem[];
        nextBefore?: string | null;
      };
      const incoming = (payload.items ?? []).filter(
        (item) => !items.some((existing) => existing.id === item.id),
      );
      setItems((current) => [...current, ...incoming]);
      setNextBefore(payload.nextBefore ?? null);
    } catch {
      setError("We could not load more announcements. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <article className={styles.card}>
              <span className={styles.badge}>Announcement</span>
              <h2 className={styles.card_title}>
                <Link href={`/community/announcements/${item.id}`} className={styles.card_link}>
                  {item.title}
                </Link>
              </h2>
              <time className={styles.date} dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </time>
              {item.body ? (
                <div className={styles.excerpt}>
                  <AnnouncementMarkdown
                    body={item.body}
                    variant="preview"
                    maxChars={240}
                    maxLines={4}
                    links={false}
                  />
                </div>
              ) : item.excerpt ? (
                <p className={styles.excerpt}>{item.excerpt}</p>
              ) : null}
              <Link className={styles.read_more} href={`/community/announcements/${item.id}`}>
                Read more
              </Link>
            </article>
          </li>
        ))}
      </ul>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.more_row}>
        {nextBefore ? (
          <button type="button" className={styles.more} onClick={() => void loadMore()} disabled={busy}>
            {busy ? "Loading…" : "Load more"}
          </button>
        ) : (
          <p className={styles.caught_up}>You are all caught up.</p>
        )}
      </div>
    </>
  );
}
