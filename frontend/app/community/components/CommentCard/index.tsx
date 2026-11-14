"use client";
// A comment in the feed: where it was made, who wrote it, and a link straight
// back to the thread. The whole card is the link, so the counts are read-only:
// reacting happens in the thread where the comment actually lives.
import Image from "next/image";
import { useState } from "react";
import page from "../../page.module.css";
import styles from "./styles.module.css";
import { Avatar, TimeStamp } from "../shared";
import type { FeedItem } from "@/app/lib/community/queries";

export default function CommentCard({ item }: { item: FeedItem }) {
  const [coverBroken, setCoverBroken] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const anime = item.anime_title ?? "KumoriTV";
  const place = item.episode_number === null || item.episode_number === undefined
    ? "Anime page"
    : `Episode ${item.episode_number}`;
  const replies = item.reply_count ?? 0;
  const author = item.author_display_name || item.author_username || "KumoriTV member";
  const showCover = Boolean(item.anime_cover) && !coverBroken;

  return (
    <a
      className={`${page.card} ${styles.card}`}
      href={item.target_url}
      data-community-card="comment"
      data-adult={item.is_adult ? "true" : undefined}
    >
      <header className={styles.where}>
        <span className={styles.cover}>
          {showCover ? (
            <Image
              src={item.anime_cover as string}
              alt=""
              width={40}
              height={56}
              sizes="40px"
              unoptimized
              onError={() => setCoverBroken(true)}
            />
          ) : (
            <span className={styles.cover_empty} aria-hidden="true">
              {anime.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
        </span>
        <span className={styles.where_text}>
          <span className={styles.anime_title}>{anime}</span>
          <span className={styles.meta}>
            <span className={styles.chip}>{place}</span>
            <TimeStamp iso={item.created_at} className={styles.time} />
          </span>
        </span>
        {/* Only ever visible when the viewer's own adult setting returned the row. */}
        {item.is_adult && <span className={styles.adult}>18+</span>}
      </header>

      <div className={styles.author}>
        <Avatar url={item.author_avatar} name={author} size={24} />
        <span className={styles.author_name}>{author}</span>
      </div>

      {item.is_spoiler || item.body === null ? (
        revealed ? (
          <p className={styles.body}>{item.body ?? ""}</p>
        ) : (
          <div className={page.spoiler} data-revealed="false">
            <div className={page.spoiler_hidden} aria-hidden="true">
              {item.body ?? ""}
            </div>
            <button
              type="button"
              className={page.spoiler_overlay}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRevealed(true);
              }}
            >
              Spoiler
              <span className={page.spoiler_hint}>Tap to reveal</span>
            </button>
          </div>
        )
      ) : (
        <p className={styles.body}>{item.body}</p>
      )}

      <footer className={styles.footer}>
        <span className={styles.count} aria-label={`${item.likes} likes`}>
          <span aria-hidden="true">▲</span> {item.likes}
        </span>
        <span className={styles.count} aria-label={`${item.dislikes} dislikes`}>
          <span aria-hidden="true">▼</span> {item.dislikes}
        </span>
        <span className={styles.replies}>
          {replies === 1 ? "1 reply" : replies > 1 ? `${replies} replies` : "Reply"}
        </span>
        <span className={styles.read_in_thread}>Read in thread</span>
      </footer>
    </a>
  );
}
