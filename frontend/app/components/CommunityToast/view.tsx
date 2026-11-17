"use client";

// The toast's markup, with no clocks and no network.
//
// Split from the provider so the layout and accessibility rules can be asserted
// deterministically: mobile one-line truncation with the clip icon OUTSIDE the
// truncating span, the desktop clamp, the megaphone for announcements, the 44 px
// dismiss button, and the single link that wraps the whole bar.

import Link from "next/link";
import { MegaphoneIcon } from "@/app/community/components/icons";
import { toastBody, toastHeadline, toastMobileLine, type LatestItem } from "@/app/lib/community/latest";
import styles from "./component.module.css";

export type CommunityToastViewProps = {
  items: LatestItem[];
  leaving?: boolean;
  onDismiss?: () => void;
  onPause?: () => void;
  onResume?: () => void;
};

function VideoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-testid="community-toast-clip-icon"
    >
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h5A1.5 1.5 0 0 1 10 4.5v7A1.5 1.5 0 0 1 8.5 13h-5A1.5 1.5 0 0 1 2 11.5v-7Zm9.4 2.1 2.1-1.4a.6.6 0 0 1 .9.5v4.6a.6.6 0 0 1-.9.5l-2.1-1.4V6.6Z" />
    </svg>
  );
}

export default function CommunityToastView({
  items,
  leaving = false,
  onDismiss,
  onPause,
  onResume,
}: CommunityToastViewProps) {
  const first = items[0];
  if (!first) return null;

  const isAnnouncement = first.kind === "announcement";
  const showClipThumb = Boolean(first.hasClip && first.clipThumb && !first.adult);

  return (
    <div
      className={`${styles.toast} ${leaving ? styles.toast_leaving : ""}`}
      data-testid="community-toast"
      data-kind={first.kind}
      data-adult={first.adult ? "true" : "false"}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
    >
      <Link href={first.href} className={styles.link} onClick={onDismiss} data-testid="community-toast-link">
        <span className={styles.desktop}>
          <span className={styles.avatar} aria-hidden="true">
            {isAnnouncement ? (
              <MegaphoneIcon size={18} />
            ) : first.authorAvatar ? (
              // Plain img: the avatar is whatever the profile stored, and the toast
              // must not add an image domain to next.config for it.
              <img src={first.authorAvatar} alt="" width={32} height={32} loading="lazy" />
            ) : (
              <span className={styles.avatar_fallback}>
                {(first.authorName || "?").slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>

          <span className={styles.text}>
            <span className={styles.name}>{toastHeadline(items)}</span>
            {/* Desktop: clamped to two lines by CSS, never a scrollbar. */}
            <span className={styles.message}>{toastBody(first)}</span>
          </span>

          {showClipThumb ? (
            <img
              className={styles.thumb}
              src={first.clipThumb as string}
              alt=""
              width={64}
              height={36}
              loading="lazy"
            />
          ) : first.hasClip ? (
            <VideoIcon className={styles.desktop_clip_icon} />
          ) : null}
        </span>

        {/* Mobile: ONE line. The icon is a SIBLING of the truncating span, never
            a child of it, so it survives the ellipsis. */}
        <span className={styles.mobile}>
          <span className={styles.mobile_text} data-testid="community-toast-text">
            {toastMobileLine(items)}
          </span>
          {first.hasClip ? <VideoIcon className={styles.mobile_icon} /> : null}
        </span>
      </Link>

      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss notification"
        data-testid="community-toast-dismiss"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
