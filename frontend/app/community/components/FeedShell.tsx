"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../page.module.css";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { useAppDispatch } from "@/app/lib/redux/hooks";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import {
  FEED_PAGE_SIZE,
  listFeedPage,
  listMyPostReactions,
  reactToPost,
  type FeedFilter,
  type FeedItem,
} from "@/app/lib/community/queries";
import Composer, { type ComposeResult } from "./Composer";
import FeedFilters from "./FeedFilters";
import PostCard from "./PostCard";
import AnnouncementCard from "./AnnouncementCard";
import ReportDialog from "./ReportDialog";

export type FeedShellProps = {
  initialItems: FeedItem[];
  initialCursor: { createdAt: string; key: string } | null;
  initialFailed: boolean;
  /** Server-rendered right rail (announcements + airing this week). */
  rightRail?: React.ReactNode;
};

type Cursor = { createdAt: string; key: string } | null;

/** The whole client side of /community: filters, feed, composer, reactions. */
export default function FeedShell({ initialItems, initialCursor, initialFailed, rightRail }: FeedShellProps) {
  const [client, setClient] = useState<ReturnType<typeof createBrowserSupabaseClient>>(null);
  const { user } = useUser();
  const dispatch = useAppDispatch();

  const isSignedIn = Boolean(user?.id) && user?.is_anonymous !== true;
  const userId = isSignedIn ? (user?.id ?? null) : null;
  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    (user?.user_metadata?.username as string | undefined) ||
    null;
  const avatarUrl = (user?.user_metadata?.avatar_url as string | undefined) || null;

  const [filter, setFilter] = useState<FeedFilter>("all");
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [cursor, setCursor] = useState<Cursor>(initialCursor);
  const [isLoading, setIsLoading] = useState(initialItems.length === 0 && !initialFailed);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(
    initialFailed ? "We could not load the community feed." : null,
  );
  const [myReactions, setMyReactions] = useState<Record<string, 1 | -1>>({});
  const [liveMessage, setLiveMessage] = useState("");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const [isComposerFocused, setIsComposerFocused] = useState(false);

  const requestId = useRef(0);
  const isFirstRun = useRef(true);
  const composerRef = useRef<HTMLDivElement>(null);

  const openLoginModal = useCallback(() => dispatch(toggleShowLoginModalValue()), [dispatch]);

  useEffect(() => {
    setClient(createBrowserSupabaseClient());
  }, []);

  const loadPage = useCallback(
    async (mode: "reset" | "more", filterOverride?: FeedFilter, cursorOverride?: Cursor) => {
      if (!client) return;
      const activeFilter = filterOverride ?? filter;
      const activeCursor = cursorOverride === undefined ? (mode === "more" ? cursor : null) : cursorOverride;

      const ticket = ++requestId.current;
      if (mode === "reset") {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const result = await listFeedPage(client, {
        filter: activeFilter,
        limit: FEED_PAGE_SIZE,
        cursor: mode === "more" ? activeCursor : null,
      });

      if (ticket !== requestId.current) return;

      if (result.error) {
        setError(
          mode === "more"
            ? "We could not load more posts."
            : "We could not load the community feed.",
        );
        setIsLoading(false);
        setIsLoadingMore(false);
        return;
      }

      const page = result.data;
      setItems((previous) => {
        if (mode === "reset") return page.items;
        const seen = new Set(previous.map((item) => item.feed_key));
        return [...previous, ...page.items.filter((item) => !seen.has(item.feed_key))];
      });
      setCursor(page.cursor);
      setIsLoading(false);
      setIsLoadingMore(false);
      if (mode === "more" && page.items.length > 0) {
        setLiveMessage(`Loaded ${page.items.length} more ${page.items.length === 1 ? "post" : "items"}.`);
      }
    },
    [client, cursor, filter],
  );

  // The server rendered the first "all" page; any other first load is a fetch.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      if (filter === "all" && initialItems.length > 0) return;
    }
    void loadPage("reset", filter, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, client]);

  // My own reactions, for the visible posts only.
  const postIdsKey = useMemo(
    () => items.filter((item) => item.kind === "post").map((item) => item.feed_key.slice(5)).join(","),
    [items],
  );

  useEffect(() => {
    if (!client || !userId || !postIdsKey) {
      setMyReactions({});
      return;
    }
    let active = true;
    (async () => {
      const result = await listMyPostReactions(client, userId, postIdsKey.split(","));
      if (active && !result.error) setMyReactions(result.data);
    })();
    return () => {
      active = false;
    };
  }, [client, userId, postIdsKey]);

  const handleReact = useCallback(
    async (item: FeedItem, value: 1 | -1) => {
      if (!client) return;
      const postId = item.feed_key.slice(5);
      const current = myReactions[postId] ?? null;
      const next: 1 | -1 | null = current === value ? null : value;

      const apply = (likes: number, dislikes: number, mine: 1 | -1 | null) => {
        setItems((previous) =>
          previous.map((row) =>
            row.feed_key === item.feed_key ? { ...row, likes, dislikes } : row,
          ),
        );
        setMyReactions((previous) => {
          const copy = { ...previous };
          if (mine === null) delete copy[postId];
          else copy[postId] = mine;
          return copy;
        });
      };

      // Optimistic, then corrected by the database's own counts.
      apply(
        Math.max(0, item.likes + (next === 1 ? 1 : 0) - (current === 1 ? 1 : 0)),
        Math.max(0, item.dislikes + (next === -1 ? 1 : 0) - (current === -1 ? 1 : 0)),
        next,
      );

      const result = await reactToPost(client, postId, next);
      if (result.error) {
        apply(item.likes, item.dislikes, current);
        setLiveMessage("That reaction did not save.");
        return;
      }
      apply(result.data.likes, result.data.dislikes, result.data.mine);
    },
    [client, myReactions],
  );

  const handleDelete = useCallback(
    async (item: FeedItem) => {
      const postId = item.feed_key.slice(5);
      try {
        const response = await fetch(`/api/community/posts/${postId}`, { method: "DELETE" });
        if (!response.ok) {
          setLiveMessage("We could not delete that post.");
          return;
        }
        setItems((previous) => previous.filter((row) => row.feed_key !== item.feed_key));
        setLiveMessage("Post deleted.");
      } catch {
        setLiveMessage("We could not delete that post.");
      }
    },
    [],
  );

  const handleCompose = useCallback(
    async ({ body, isSpoiler }: { body: string; isSpoiler: boolean }): Promise<ComposeResult> => {
      try {
        const response = await fetch("/api/community/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, isSpoiler }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          post?: { id: string; author_id: string; body: string; is_spoiler: boolean; created_at: string };
        };

        if (!response.ok || !payload.post) {
          return { ok: false, message: payload.message || "We could not post that." };
        }

        const created: FeedItem = {
          feed_key: `post:${payload.post.id}`,
          kind: "post",
          created_at: payload.post.created_at,
          author_id: payload.post.author_id,
          author_username: (user?.user_metadata?.username as string | undefined) ?? null,
          author_display_name: displayName,
          author_avatar: avatarUrl,
          body: payload.post.body,
          is_spoiler: payload.post.is_spoiler,
          title: null,
          image_url: null,
          link_url: null,
          clip_code: null,
          clip_start: null,
          clip_end: null,
          anime_id: null,
          anime_title: null,
          anime_cover: null,
          episode_number: null,
          target_url: `/community/post/${payload.post.id}`,
          reply_count: 0,
          likes: 0,
          dislikes: 0,
        };

        if (filter === "announcement") {
          void loadPage("reset", filter, null);
        } else {
          setItems((previous) => [created, ...previous.filter((row) => row.feed_key !== created.feed_key)]);
        }
        setLiveMessage("Your post is live.");
        setIsSheetOpen(false);
        return { ok: true };
      } catch {
        return { ok: false, message: "We could not post that. Check your connection." };
      }
    },
    [avatarUrl, displayName, filter, loadPage, user?.user_metadata?.username],
  );

  // Escape closes the mobile sheet.
  useEffect(() => {
    if (!isSheetOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsSheetOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isSheetOpen]);

  const hasMore = Boolean(cursor) && items.length > 0;

  const filtersProps = { value: filter, onChange: setFilter };

  return (
    <div className={styles.page}>
      {isSheetOpen && <span data-disabled-scroll="true" />}
      <div className={styles.shell}>
        <div className={styles.page_head}>
          <div>
            <p className={styles.eyebrow}>KumoriTV</p>
            <h1 className={styles.title}>Community</h1>
            <p className={styles.subtitle}>
              Talk about what you are watching, spoiler-tag the big moments, and hear from the team.
            </p>
          </div>
        </div>

        <div className={styles.grid}>
          <aside className={styles.left_column}>
            <FeedFilters {...filtersProps} variant="nav" ariaLabel="Filter the feed" />
            <div className={`${styles.card} ${styles.guidelines}`}>
              <p className={styles.panel_heading}>House rules</p>
              <ul>
                <li>Tag spoilers. Untagged ones get hidden.</li>
                <li>Be decent to people, not just to characters.</li>
                <li>No piracy links. Clips stay on KumoriTV.</li>
              </ul>
            </div>
          </aside>

          <div className={styles.center_column}>
            <div className={styles.filters_inline}>
              <FeedFilters {...filtersProps} variant="chips" ariaLabel="Filter the feed" />
            </div>

            <div
              ref={composerRef}
              data-composer="inline"
              className={styles.composer_desktop}
              onFocusCapture={() => setIsComposerFocused(true)}
              onBlurCapture={() => setIsComposerFocused(false)}
            >
              <Composer
                isSignedIn={isSignedIn}
                displayName={displayName}
                avatarUrl={avatarUrl}
                onSubmit={handleCompose}
                onGuestWrite={openLoginModal}
                autoFocus={isComposerFocused}
              />
            </div>

            <div className={styles.center_inner}>
              <p className={styles.sr_only} role="status" aria-live="polite">
                {liveMessage}
              </p>

              {isLoading && (
                <div aria-hidden="true" style={{ display: "grid", gap: 12 }}>
                  <div className={styles.skeleton} />
                  <div className={styles.skeleton} />
                  <div className={styles.skeleton} />
                </div>
              )}

              {!isLoading && error && (
                <div className={styles.empty} role="alert">
                  <p className={styles.empty_title}>{error}</p>
                  <p className={styles.empty_text}>The feed may be busy. Try again in a moment.</p>
                  <button type="button" className={styles.button} onClick={() => void loadPage("reset", filter, null)}>
                    Try again
                  </button>
                </div>
              )}

              {!isLoading && !error && items.length === 0 && (
                <div className={styles.empty}>
                  <p className={styles.empty_title}>
                    {filter === "announcement" ? "No announcements right now" : "No posts yet"}
                  </p>
                  <p className={styles.empty_text}>
                    {filter === "announcement"
                      ? "When the team has something to say, it lands here first."
                      : isSignedIn
                        ? "You have the whole feed to yourself. Say hello."
                        : "Sign in and start the conversation."}
                  </p>
                </div>
              )}

              {!isLoading && items.length > 0 && (
                <ul className={styles.feed_list}>
                  {items.map((item) =>
                    item.kind === "post" ? (
                      <li key={item.feed_key}>
                        <PostCard
                          item={item}
                          myReaction={myReactions[item.feed_key.slice(5)] ?? null}
                          isSignedIn={isSignedIn}
                          canDelete={Boolean(userId) && item.author_id === userId}
                          onReact={handleReact}
                          onDelete={handleDelete}
                          onReport={(target) => setReportTarget(target)}
                          onGuestWrite={openLoginModal}
                        />
                      </li>
                    ) : (
                      <li key={item.feed_key}>
                        <AnnouncementCard item={item} />
                      </li>
                    ),
                  )}
                </ul>
              )}

              {hasMore && !error && (
                <button
                  type="button"
                  className={`${styles.button} ${styles.button_ghost} ${styles.load_more}`}
                  onClick={() => void loadPage("more", filter)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          </div>

          <aside className={styles.rail_column}>{rightRail}</aside>
        </div>
      </div>

      <div className={styles.mobile_bar}>
        <FeedFilters {...filtersProps} variant="chips" ariaLabel="Filter the feed" />
      </div>

      <button
        type="button"
        className={styles.fab}
        aria-label="Write a post"
        aria-haspopup="dialog"
        onClick={() => setIsSheetOpen(true)}
      >
        +
      </button>

      {isSheetOpen && (
        <Composer
          isSignedIn={isSignedIn}
          displayName={displayName}
          avatarUrl={avatarUrl}
          onSubmit={handleCompose}
          onGuestWrite={() => {
            setIsSheetOpen(false);
            openLoginModal();
          }}
          variant="sheet"
          autoFocus
          onRequestClose={() => setIsSheetOpen(false)}
        />
      )}

      {reportTarget && (
        <ReportDialog
          targetKind={reportTarget.kind}
          targetId={reportTarget.feed_key.slice(reportTarget.kind === "post" ? 5 : 13)}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
