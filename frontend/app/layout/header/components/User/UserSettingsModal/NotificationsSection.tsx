"use client";
// Settings → Notifications. The master toggle belongs to THIS browser (browser
// permission + the OneSignal subscription); the category toggles belong to the
// account and live in `push_preferences`.

import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./component.module.css";
import SectionHeading from "./SectionHeading";
import SwitchRow from "./SwitchRow";
import {
  applyPreferenceChange,
  categoriesVisible,
  detectPushEnvironment,
  preferencesOnFirstEnable,
  masterToggleState,
  PUSH_NOTICES,
  type MasterToggleState,
  type PushEnvironment,
  type PushPreferences,
} from "@/app/lib/push/state";
import {
  currentPushState,
  ensurePushInitialized,
  optOutPush,
  requestPushPermissionAndOptIn,
  watchPushSubscription,
} from "@/app/lib/push/runtime";
import { loadPushPreferences, savePushPreferences } from "@/app/lib/user-data/push";

export const NOTIFICATIONS_SECTION_ID = "settings-notifications";

type CategoryKey =
  | "newEpisodesAll"
  | "newEpisodesSubscribed"
  | "replies"
  | "likes"
  | "mentions"
  | "announcements";

const CATEGORIES: Array<{
  key: CategoryKey;
  id: string;
  name: string;
  label: string;
  description?: string;
}> = [
  {
    key: "newEpisodesAll",
    id: "settings-push-all-episodes",
    name: "pushNewEpisodesAll",
    label: "New episodes (all anime)",
    description: "One digest, at most every few hours.",
  },
  {
    key: "newEpisodesSubscribed",
    id: "settings-push-subscribed-episodes",
    name: "pushNewEpisodesSubscribed",
    label: "New episodes from anime I subscribed to",
  },
  {
    key: "replies",
    id: "settings-push-replies",
    name: "pushReplies",
    label: "Replies to my comments",
  },
  {
    key: "likes",
    id: "settings-push-likes",
    name: "pushLikes",
    label: "Likes on my comments",
  },
  {
    key: "mentions",
    id: "settings-push-mentions",
    name: "pushMentions",
    label: "Mentions",
    description: "When someone @-mentions you.",
  },
  {
    key: "announcements",
    id: "settings-push-announcements",
    name: "pushAnnouncements",
    label: "Announcements from KumoriTV",
  },
];

function readEnvironment(): PushEnvironment {
  const state = currentPushState();

  return detectPushEnvironment({
    configured: state.configured,
    optedIn: state.optedIn,
    notificationPermission: state.permission,
    navigatorLike:
      typeof navigator !== "undefined"
        ? {
            userAgent: navigator.userAgent,
            standalone: (navigator as unknown as { standalone?: boolean }).standalone,
            maxTouchPoints: navigator.maxTouchPoints,
          }
        : undefined,
    matchMediaLike:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? (query: string) => window.matchMedia(query)
        : undefined,
  });
}

export default function NotificationsSection({ isSignedIn }: { isSignedIn: boolean }) {
  const [preferences, setPreferences] = useState<PushPreferences | null>(null);
  const [environment, setEnvironment] = useState<PushEnvironment>(() => readEnvironment());
  const [message, setMessage] = useState<string>("");
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const mounted = useRef(true);

  const refreshEnvironment = useCallback(() => {
    if (!mounted.current) return;
    setEnvironment(readEnvironment());
  }, []);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;

    let active = true;

    void (async () => {
      // Initialising here (and not before sign-in) is harmless if the provider
      // already did it: the runtime keeps a single initialisation promise.
      await ensurePushInitialized();
      if (!active) return;
      refreshEnvironment();

      const loaded = await loadPushPreferences();
      if (!active || !loaded.ok) return;
      setPreferences(loaded.preferences);
    })();

    return () => {
      active = false;
    };
  }, [isSignedIn, refreshEnvironment]);

  // OneSignal tells us when the browser subscription changes (for example the
  // user blocks notifications in site settings): keep the toggle truthful.
  useEffect(() => {
    if (!isSignedIn) return;

    return watchPushSubscription(() => refreshEnvironment());
  }, [isSignedIn, refreshEnvironment]);

  const master: MasterToggleState = masterToggleState(environment);
  const showCategories = categoriesVisible(master);

  async function handleMasterToggle(next: boolean) {
    if (!preferences || isBusy) return;

    setIsBusy(true);
    setMessage("");

    const previous = preferences;

    if (!next) {
      // Turning OFF: opt this browser out first, then persist the account flag.
      setPreferences({ ...previous, enabled: false });

      await optOutPush();
      const saved = await savePushPreferences({ ...previous, enabled: false });

      if (!saved) {
        if (mounted.current) setPreferences(previous);
        if (mounted.current) setMessage("That change could not be saved. Please try again.");
      } else if (mounted.current) {
        setMessage("Push notifications are off.");
      }

      refreshEnvironment();
      setIsBusy(false);

      return;
    }

    if (!environment.configured) {
      setMessage(PUSH_NOTICES.unavailable);
      setIsBusy(false);

      return;
    }
    if (!environment.supported) {
      setMessage(PUSH_NOTICES.unsupported);
      setIsBusy(false);

      return;
    }
    if (environment.isIosSafari && !environment.isStandalone) {
      setMessage(PUSH_NOTICES.ios);
      setIsBusy(false);

      return;
    }
    if (environment.permission === "denied") {
      // Blocked at the browser level: never ask again, just say how to unblock.
      setMessage(PUSH_NOTICES.denied);
      setIsBusy(false);

      return;
    }

    const result = await requestPushPermissionAndOptIn();
    refreshEnvironment();

    if (result === "unavailable") {
      setMessage(PUSH_NOTICES.unavailable);
      setIsBusy(false);

      return;
    }
    if (result === "denied") {
      setMessage(PUSH_NOTICES.denied);
      setIsBusy(false);

      return;
    }
    if (result === "dismissed") {
      setMessage("Notifications were not enabled. You can turn them on any time.");
      setIsBusy(false);

      return;
    }
    if (result === "error") {
      setMessage("Could not turn on push notifications. Please try again.");
      setIsBusy(false);

      return;
    }

    // Granted: the very first enable applies the defaults once.
    const nextPreferences = previous.defaultsApplied
      ? { ...previous, enabled: true }
      : preferencesOnFirstEnable(previous);

    setPreferences(nextPreferences);

    const saved = await savePushPreferences(nextPreferences);

    if (!saved) {
      if (mounted.current) setPreferences(previous);
      if (mounted.current) setMessage("That change could not be saved. Please try again.");
    } else if (mounted.current) {
      setMessage("Push notifications are on for this browser.");
    }

    refreshEnvironment();
    setIsBusy(false);
  }

  async function handleCategoryToggle(key: CategoryKey, value: boolean) {
    if (!preferences || isBusy) return;

    const previous = preferences;
    const next = applyPreferenceChange(previous, { [key]: value });

    // Optimistic: the switch moves immediately, and moves back if the write fails.
    setPreferences(next);
    setMessage("");

    const saved = await savePushPreferences(next);

    if (!saved) {
      if (mounted.current) setPreferences(previous);
      if (mounted.current) setMessage("That change could not be saved. Please try again.");
    }
  }

  const masterChecked = master.checked && (preferences?.enabled ?? false);
  const masterNotice = master.notice;

  return (
    <section
      className={styles.card}
      id={NOTIFICATIONS_SECTION_ID}
      data-settings-section="notifications"
      aria-labelledby="settings-notifications-heading"
    >
      <SectionHeading
        title="Notifications"
        description="Pushes are off by default. Everything also shows in the bell."
        headingId="settings-notifications-heading"
      />

      {!isSignedIn ? (
        <span className={styles.helper}>
          Sign in to choose what KumoriTV notifies you about.
        </span>
      ) : (
        <>
          <SwitchRow
            id="settings-push-master"
            name="pushNotifications"
            label="Push notifications"
            checked={masterChecked}
            disabled={master.disabled || isBusy || !preferences}
            onChange={(value) => void handleMasterToggle(value)}
          />

          {masterNotice && (
            <span className={styles.helper} data-push-notice={master.noticeKind ?? "info"} role="status">
              {masterNotice}
            </span>
          )}

          {showCategories && preferences && (
            <div className={styles.sub_switches} data-push-categories="true">
              {CATEGORIES.map((category) => (
                <SwitchRow
                  key={category.key}
                  id={category.id}
                  name={category.name}
                  label={category.label}
                  description={category.description}
                  checked={preferences[category.key]}
                  disabled={isBusy}
                  onChange={(value) => void handleCategoryToggle(category.key, value)}
                />
              ))}

              <span className={styles.helper}>
                The two episode options are alternatives: turning one on turns the
                other off.
              </span>
            </div>
          )}

          {message && (
            <span className={styles.helper} role="status" data-push-message="true">
              {message}
            </span>
          )}
        </>
      )}
    </section>
  );
}
