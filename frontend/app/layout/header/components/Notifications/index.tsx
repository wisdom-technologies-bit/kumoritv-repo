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
import HeartFillSvg from "@/public/assets/heart-fill.svg";
import MegaphoneFillSvg from "@/public/assets/megaphone-fill.svg";
import {
  BELL_ITEM_LIMIT,
  loadBell,
  markAllBellRead,
  type AnnouncementView,
  type BellItem,
  type NotificationView,
  type UserNotificationView,
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

/** reply / mention: the actor's face, what they did, and the snippet. */
function UserNotificationItem({ notification }: { notification: UserNotificationView }) {
  const initial = (notification.actorName ?? "?").trim().charAt(0).toUpperCase() || "?";
  const [avatarBroken, setAvatarBroken] = useState(false);
  const showAvatar = Boolean(notification.actorAvatar) && !avatarBroken;

  return (
    <li
      className={styles.notification_item_container}
      data-unread={notification.isRead ? "false" : "true"}
      data-kind={notification.kind}
      aria-label={notification.title}
    >
      <div className={styles.img_container} data-actor-avatar="true">
        {showAvatar ? (
          <Image
            src={notification.actorAvatar as string}
            alt=""
            fill
            sizes="56px"
            onError={() => setAvatarBroken(true)}
          />
        ) : (
          <span className={styles.img_fallback}>{initial}</span>
        )}
      </div>

      <div className={styles.notification_item_info}>
        <div className={styles.item_heading}>
          <p className={styles.item_title}>{notification.title}</p>

          {!notification.isRead && (
            <span className={styles.unread_dot} data-unread-dot="true" role="img" aria-label="Unread" />
          )}
        </div>

        {notification.body && <p className={styles.item_snippet}>{notification.body}</p>}

        {notification.url && (
          <Link className={styles.watch_link} href={notification.url}>
            View
          </Link>
        )}
      </div>
    </li>
  );
}

/** like: a heart, the running count and the comment snippet. */
function LikeNotificationItem({ notification }: { notification: UserNotificationView }) {
  const count = notification.count || 1;

  return (
    <li
      className={styles.notification_item_container}
      data-unread={notification.isRead ? "false" : "true"}
      data-kind="like"
      aria-label={`Your comment got ${count} ${count === 1 ? "like" : "likes"}`}
    >
      <div className={styles.icon_container} aria-hidden="true">
        <HeartFillSvg width={18} height={18} viewBox="0 0 16 16" />
      </div>

      <div className={styles.notification_item_info}>
        <div className={styles.item_heading}>
          <p className={styles.item_title}>
            Your comment got {count} {count === 1 ? "like" : "likes"}
          </p>

          {!notification.isRead && (
            <span className={styles.unread_dot} data-unread-dot="true" role="img" aria-label="Unread" />
          )}
        </div>

        {notification.body && <p className={styles.item_snippet}>{notification.body}</p>}

        {notification.url && (
          <Link className={styles.watch_link} href={notification.url}>
            View
          </Link>
        )}
      </div>
    </li>
  );
}

/** digest: "N new episodes on KumoriTV", with up to three titles in the body. */
function DigestNotificationItem({ notification }: { notification: UserNotificationView }) {
  const initial = "K";

  return (
    <li
      className={styles.notification_item_container}
      data-unread={notification.isRead ? "false" : "true"}
      data-kind="digest"
      aria-label={notification.title}
    >
      <div className={styles.img_container}>
        {notification.image ? (
          <Image src={notification.image} alt="" fill sizes="56px" />
        ) : (
          <span className={styles.img_fallback}>{initial}</span>
        )}
      </div>

      <div className={styles.notification_item_info}>
        <div className={styles.item_heading}>
          <p className={styles.item_title}>{notification.title}</p>

          {!notification.isRead && (
            <span className={styles.unread_dot} data-unread-dot="true" role="img" aria-label="Unread" />
          )}
        </div>

        {notification.body && <p className={styles.item_snippet}>{notification.body}</p>}

        <Link className={styles.watch_link} href={notification.url || "/"}>
          Browse
        </Link>
      </div>
    </li>
  );
}

/** announcement: a megaphone, the title and body, and the optional button. */
function AnnouncementItem({ announcement }: { announcement: AnnouncementView }) {
  return (
    <li
      className={styles.notification_item_container}
      data-unread={announcement.isRead ? "false" : "true"}
      data-kind="announcement"
      aria-label={announcement.title}
    >
      <div className={styles.icon_container} aria-hidden="true">
        <MegaphoneFillSvg width={18} height={18} viewBox="0 0 16 16" />
      </div>

      <div className={styles.notification_item_info}>
        <div className={styles.item_heading}>
          <p className={styles.item_title}>{announcement.title}</p>

          {!announcement.isRead && (
            <span className={styles.unread_dot} data-unread-dot="true" role="img" aria-label="Unread" />
          )}
        </div>

        {announcement.body && <p className={styles.item_snippet}>{announcement.body}</p>}

        {announcement.image && (
          <div className={styles.announcement_image}>
            <Image src={announcement.image} alt="" fill sizes="240px" />
          </div>
        )}

        {announcement.url && (
          <Link className={styles.watch_link} href={announcement.url}>
            Open
          </Link>
        )}
      </div>
    </li>
  );
}

function BellRow({ entry }: { entry: BellItem }) {
  if (entry.source === "episodes") return <NotificationItem notification={entry.item} />;
  if (entry.source === "announcement") return <AnnouncementItem announcement={entry.item} />;
  if (entry.item.kind === "like") return <LikeNotificationItem notification={entry.item} />;
  if (entry.item.kind === "digest") return <DigestNotificationItem notification={entry.item} />;

  return <UserNotificationItem notification={entry.item} />;
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
  const [bellItems, setBellItems] = useState<BellItem[]>([]);
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
      setBellItems([]);
      setUnreadCount(0);

      return;
    }

    // One read for all three sources: episode rows, user_notifications and
    // announcements. Push being off (or OneSignal failing to load) changes
    // nothing here: the bell only reads the database.
    const result = await loadBell();

    setBellItems(result.items);
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
    // The badge clears at once; the rows keep their unread styling until the next
    // refresh, exactly as they did before the bell merged its sources.
    setUnreadCount(0);

    // Covers all three tables (episode rows, user_notifications, announcement
    // reads). The announcement upsert is idempotent, so repeating is harmless.
    await markAllBellRead();
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
            className="header-icon-btn"
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
              <BellFillSvg fill="white" width={22} height={22} viewBox="0 0 16 16" />
            ) : (
              <BellSvg fill="white" width={22} height={22} viewBox="0 0 16 16" />
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

                  {bellItems.length == 0 && (
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

                  {bellItems.length != 0 && (
                    <ul className={styles.notification_list} data-bell-count={bellItems.length}>
                      {bellItems.slice(0, BELL_ITEM_LIMIT).map((entry) => (
                        <BellRow key={entry.id} entry={entry} />
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
