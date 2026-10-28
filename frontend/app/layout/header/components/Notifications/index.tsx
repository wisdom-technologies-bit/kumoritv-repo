"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useCallback, useEffect, useState } from "react";
import BellFillSvg from "@/public/assets/bell-fill.svg";
import BellSvg from "@/public/assets/bell.svg";
import styles from "./component.module.css";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { convertFromUnix } from "@/app/lib/formatDateUnix";
import { useAppSelector } from "@/app/lib/redux/hooks";
import {
  listNotifications,
  markAllNotificationsRead,
  type NotificationView,
} from "@/app/lib/user-data/notifications";
import { displayTitle } from "@/app/lib/titles";

function NotificationsContainer() {
  //
  // HOW IT WORKS
  //
  // Notifications live in Supabase now. The fanout_episode_notifications trigger
  // creates a row for every subscribed user when a new aired episode is stored, so
  // this component only reads them: on mount, on window focus and every 5 minutes.
  // Unread rows (read_at is null) drive the badge.
  //
  const [notificationsList, setNotificationsList] = useState<NotificationView[]>(
    []
  );
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);

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

  const hasNewNotifications = unreadCount > 0;

  async function toggleOpenNotificationsPanel() {
    setIsPanelOpen(!isPanelOpen);

    if (!isPanelOpen) {
      setUnreadCount(0);

      await markAllNotificationsRead();
    }
  }

  if (user || anilistUser) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          id={styles.notification_container}
        >
          <button
            id={styles.notification_btn}
            onClick={() => toggleOpenNotificationsPanel()}
            title={isPanelOpen ? "Close Notifications" : "Open Notifications"}
            aria-controls={styles.results_container}
            data-active={isPanelOpen}
          >
            {hasNewNotifications ? (
              <BellFillSvg fill="white" width={16} height={16} />
            ) : (
              <BellSvg fill="white" width={16} height={16} />
            )}
          </button>

          {hasNewNotifications && (
            <span id={styles.notifications_badge}>{unreadCount}</span>
          )}

          <AnimatePresence>
            {isPanelOpen && (
              <motion.div
                initial={{ y: "-20px", opacity: 0 }}
                animate={{ y: "0px", opacity: 1 }}
                exit={{ y: "-20px", opacity: 0 }}
                id={styles.results_container}
                aria-expanded={isPanelOpen}
              >
                <h4>Latest Notifications (BETA)</h4>

                {notificationsList.length == 0 && (
                  <div>
                    <p style={{ color: "var(--white-100)" }}>
                      No New Notifications
                    </p>
                  </div>
                )}

                {notificationsList.length != 0 && (
                  <ul>
                    {notificationsList.map((media, key) => (
                      <li
                        key={key}
                        className={styles.notification_item_container}
                        aria-label={`${displayTitle(media.title)} new episode released`}
                      >
                        <div className={styles.img_container}>
                          <Image
                            src={media.coverImage.large}
                            alt={displayTitle(media.title)}
                            fill
                            sizes="100px"
                          />
                        </div>

                        <div className={styles.notification_item_info}>
                          <h5>
                            Episode{" "}
                            {media.episodes[media.episodes.length - 1]?.number}{" "}
                            Released!
                          </h5>

                          <small>{displayTitle(media.title)}</small>

                          {media.status != "RELEASING" && (
                            <p>
                              <b>Watch the Season Finale!</b>
                            </p>
                          )}

                          <p>
                            Released on{" "}
                            {media.nextReleaseDate
                              ? convertFromUnix(media.nextReleaseDate)
                              : "—"}
                          </p>

                          <Link
                            href={`/watch/${media.mediaId}?ep=${
                              media.episodes[media.episodes.length - 1]?.number
                            }`}
                          >
                            SEE MORE
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    );
  }
}

export default NotificationsContainer;
