"use client";
import Link from "next/link";
import styles from "../page.module.css";
import type { FeedItem } from "@/app/lib/community/queries";
import { TimeStamp } from "./shared";
import { CommentIcon, MegaphoneIcon } from "./icons";

/** Announcements stay in their own table; the feed only reads them. */
export default function AnnouncementCard({ item }: { item: FeedItem }) {
  const hasExternal = Boolean(item.link_url);

  return (
    <article className={`${styles.card} ${styles.announcement_card}`} data-feed-key={item.feed_key}>
      <span className={styles.badge}>
        <MegaphoneIcon />
        Announcement
      </span>

      <h3 className={styles.announcement_title}>
        <Link href={item.target_url} style={{ color: "inherit", textDecoration: "none" }}>
          {item.title || "Announcement"}
        </Link>
      </h3>

      {item.body && <p className={styles.announcement_body}>{item.body}</p>}

      {item.image_url && (
        <div className={styles.announcement_media}>
          {/* Announcement images are whatever the admin pasted; plain img keeps
              the admin's absolute URL working without a next/image allowlist. */}
          <img src={item.image_url} alt="" loading="lazy" />
        </div>
      )}

      <div className={styles.announcement_footer}>
        <TimeStamp iso={item.created_at} className={styles.author_meta} />
        <Link className={styles.button_link} href={item.target_url}>
          <CommentIcon />
          {item.reply_count > 0 ? item.reply_count : "Comment"}
        </Link>
        <Link className={styles.button_link} href={item.target_url}>
          Open
        </Link>
        {hasExternal && (
          <a
            className={styles.button_link}
            href={item.link_url as string}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read more
          </a>
        )}
      </div>
    </article>
  );
}
