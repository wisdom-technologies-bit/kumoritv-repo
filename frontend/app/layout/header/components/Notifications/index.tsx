"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useCallback, useEffect, useRef, useState } from "react";
import BellFillSvg from "@/public/assets/bell-fill.svg";
import BellSvg from "@/public/assets/bell.svg";
import styles from "./component.module.css";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { convertFromUnix } from "@/app/lib/formatDateUnix";
import { useAppSelector } from "@/app/lib/redux/hooks";
import {
  listNotifications,
  markAllNotificationsRead,
  type NotificationView,
} from "@/app/lib/user-data/notifications";
import { displayTitle } from "@/app/lib/titles";

// Below this width the panel is a sheet pinned under the header instead of a
// dropdown hanging off the bell. Kept in one place so the stylesheet and the
// component agree (the stylesheet repeats the number in its media query).
export const NOTIFICATIONS_SHEET_QUERY = "(max-width: 640px)";

function useIsSheetViewport() {
  const [isSheet, setIsSheet] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia(NOTIFICATIONS_SHEET_QUERY);
    const sync = () => setIsSheet(Boolean(query.matches));

    sync();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", sync);

      return () => query.removeEventListener("change", sync);
    }

    query.addListener?.(sync);

    return () => query.removeListener?.(sync);
  }, []);

  return isSheet;
}

function releaseLine(notification: NotificationView) {
  const episode = notification.episodes[notification.episodes.length - 1];
  const timestamp = notification.nextReleaseDate ?? episode?.releaseDate ?? null;

  if (!timestamp) return "Release date unavailable";

  return `Released ${convertFromUnix(timestamp, {
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function NotificationItem({ notification }: { notification: NotificationView }) {
  const episode = notification.episodes[notification.episodes.length - 1];
  const episodeNumber = episode?.number ?? 1;
  const title = displayTitle(notification.title);
  const cover = notification.coverImage?.large || notification.coverImage?.extraLarge || "";
  const isFinale = notification.status != "RELEASING";
  // The cover is never an empty box: a skeleton while it loads, then either the
  // image or a block with the title's first letter.
  const [coverState, setCoverState] = useState<"loading" | "loaded" | "error">(
    cover ? "loading" : "error"
  );

  return (
    <li
      className={styles.notification_item_container}
      data-unread={notification.isRead ? "false" : "true"}
      aria-label={`${title}, episode ${episodeNumber} released`}
    >
      <div
        className={styles.img_container}
        data-cover-state={coverState}
      >
        {coverState === "error" ? (
          <span className={styles.img_fallback} data-cover-fallback="true">
            {title.trim().charAt(0).toUpperCase() || "?"}
          </span>
        ) : (
          <Image
            src={cover}
            alt=""
            fill
            sizes="56px"
            onLoad={() => setCoverState("loaded")}
            onError={() => setCoverState("error")}
          />
        )}

        {coverState === "loading" && (
          <span
            className={styles.img_skeleton}
            data-cover-skeleton="true"
            aria-hidden="true"
          />
        )}
      </div>

      <div className={styles.notification_item_info}>
        <div className={styles.item_heading}>
          <p className={styles.item_title}>Episode {episodeNumber} released</p>

          {!notification.isRead && (
            <span
              className={styles.unread_dot}
              data-unread-dot="true"
              role="img"
              aria-label="Unread"
            />
          )}
        </div>

        <p className={styles.item_show}>{title}</p>

        {isFinale && <span className={styles.finale_tag}>Season finale</span>}

        <p className={styles.item_meta}>{releaseLine(notification)}</p>

        <Link
          className={styles.watch_link}
          href={`/watch/${notification.mediaId}?ep=${episodeNumber}`}
        >
          Watch now
        </Link>
      </div>
    </li>
  );
}

function NotificationsContainer() {
  //
  // HOW IT WORKS
  //
  // Notifications live in Supabase now. The fanout_episode_notifications trigger
  // creates a row for every subscribed user when a new aired episode is stored, so
  // this component only reads them: on mount, on window focus and every 5 minutes.
  // Unread rows (read_at is null) drive the badge; opening the panel marks them read.
  //
  const [notificationsList, setNotificationsList] = useState<NotificationView[]>(
    []
  );
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const isSheet = useIsSheetViewport();
  const pathname = usePathname();

  const anilistUser = useAppSelector((state) => state.UserInfo?.value);

  const { user } = useUser();

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotificationsList([]);
      setUnreadCount(0);

      return;
    }

    const result = await listNotifications();

    setNotificationsList(result.items);
    setUnreadCount(result.unreadCount);
  }, [user]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!user) return;

    function handleWindowFocus() {
      refreshNotifications();
    }

    window.addEventListener("focus", handleWindowFocus);

    const refreshInterval = window.setInterval(
      () => refreshNotifications(),
      5 * 60 * 1000
    );

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      window.clearInterval(refreshInterval);
    };
  }, [user, refreshNotifications]);

  // A route change closes the panel: links inside it navigate away.
  useEffect(() => {
    setIsPanelOpen(false);
  }, [pathname]);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  // Escape, outside click and focus handling live here so desktop and the mobile
  // sheet behave the same way. Focus returns to the bell when the panel closes.
  useEffect(() => {
    if (!isPanelOpen) return;

    // The dialog itself is the focus target (tabIndex -1), the standard pattern
    // for a panel that has no obvious first field.
    containerRef.current
      ?.querySelector<HTMLElement>('[role="dialog"]')
      ?.focus?.();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.stopPropagation();
      setIsPanelOpen(false);
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;

      if (target && containerRef.current?.contains(target)) return;

      setIsPanelOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);

      bellRef.current?.focus?.();
    };
  }, [isPanelOpen]);

  const hasNewNotifications = unreadCount > 0;

  async function toggleOpenNotificationsPanel() {
    if (isPanelOpen) {
      setIsPanelOpen(false);

      return;
    }

    setIsPanelOpen(true);
    setUnreadCount(0);

    await markAllNotificationsRead();
  }

  if (user || anilistUser) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          id={styles.notification_container}
          ref={containerRef}
        >
          <button
            id={styles.notification_btn}
            ref={bellRef}
            onClick={() => toggleOpenNotificationsPanel()}
            title={isPanelOpen ? "Close Notifications" : "Open Notifications"}
            aria-label={isPanelOpen ? "Close notifications" : "Open notifications"}
            aria-controls={styles.results_container}
            aria-expanded={isPanelOpen}
            aria-haspopup="dialog"
            data-active={isPanelOpen}
          >
            {hasNewNotifications ? (
              <BellFillSvg fill="white" width={22} height={22} />
            ) : (
              <BellSvg fill="white" width={22} height={22} />
            )}
          </button>

          {/* Always rendered so the bell is never remounted when the count
              changes (a remount would drop focus and its handlers). */}
          <span
            id={styles.notifications_badge}
            data-hidden={hasNewNotifications ? "false" : "true"}
            aria-hidden={hasNewNotifications ? undefined : true}
          >
            {unreadCount}
          </span>

          <AnimatePresence>
            {isPanelOpen && (
              <>
                {isSheet && (
                  <div
                    className={styles.sheet_backdrop}
                    data-notifications-backdrop="true"
                    onClick={() => closePanel()}
                    aria-hidden="true"
                  />
                )}

                <motion.div
                  initial={{ y: "-16px", opacity: 0 }}
                  animate={{ y: "0px", opacity: 1 }}
                  exit={{ y: "-16px", opacity: 0 }}
                  id={styles.results_container}
                  role="dialog"
                  aria-label="Notifications"
                  aria-modal={isSheet || undefined}
                  data-layout={isSheet ? "sheet" : "dropdown"}
                  tabIndex={-1}
                >
                  <div className={styles.panel_heading}>
                    <h4 id={styles.panel_title}>Notifications</h4>

                    <button
                      type="button"
                      className={styles.panel_close_btn}
                      onClick={() => closePanel()}
                      aria-label="Close notifications"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>

                  {notificationsList.length == 0 && (
                    <div className={styles.empty_state}>
                      <BellSvg
                        fill="currentColor"
                        width={28}
                        height={28}
                        aria-hidden="true"
                      />

                      <p className={styles.empty_title}>{"You're all caught up"}</p>

                      <p className={styles.empty_text}>
                        New episodes of anime you follow will appear here.
                      </p>
                    </div>
                  )}

                  {notificationsList.length != 0 && (
                    <ul className={styles.notification_list}>
                      {notificationsList.map((notification) => (
                        <NotificationItem
                          key={notification.id}
                          notification={notification}
                        />
                      ))}
                    </ul>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    );
  }
}

export default NotificationsContainer;
