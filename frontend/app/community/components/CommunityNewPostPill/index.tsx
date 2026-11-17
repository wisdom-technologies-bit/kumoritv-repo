"use client";

// Phase 4, part A5: "N new posts" on /community itself.
//
// The toast is suppressed on /community, so the same poll reports its count
// here instead. One button, role="status" so a screen reader hears the count
// once, and a click that scrolls up and refreshes the feed through the existing
// load path - never by inserting rows under the reader's place.

import { useCommunityLatest } from "@/app/components/CommunityToast";
import styles from "./component.module.css";

export default function CommunityNewPostPill({ onRefresh }: { onRefresh: () => void }) {
  const { enabled, newCount, resetNewCount } = useCommunityLatest();

  if (!enabled || newCount <= 0) return null;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        role="status"
        className={styles.pill}
        data-testid="community-new-post-pill"
        onClick={() => {
          resetNewCount();
          // Jump, then load: a smooth scroll and a feed refresh fight over the
          // same frames, and the reader ends up watching rows slide past.
          if (typeof window !== "undefined") {
            try {
              window.scrollTo({ top: 0, behavior: "auto" });
            } catch {
              window.scrollTo(0, 0);
            }
          }
          onRefresh();
        }}
      >
        {newCount === 1 ? "1 new post" : `${newCount} new posts`}
      </button>
    </div>
  );
}
