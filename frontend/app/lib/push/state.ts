// Pure push state rules: what the Notifications section shows, and what the
// master toggle does. No React, no OneSignal import, so the tests can drive it
// with plain objects.

export type PushPreferences = {
  enabled: boolean;
  defaultsApplied: boolean;
  newEpisodesAll: boolean;
  newEpisodesSubscribed: boolean;
  replies: boolean;
  likes: boolean;
  mentions: boolean;
  announcements: boolean;
};

/** A user with no row yet: push off, every category off. */
export const EMPTY_PUSH_PREFERENCES: PushPreferences = {
  enabled: false,
  defaultsApplied: false,
  newEpisodesAll: false,
  newEpisodesSubscribed: false,
  replies: false,
  likes: false,
  mentions: false,
  announcements: false,
};

/**
 * The defaults applied ONCE, the first time the master is turned on: episodes of
 * anime you subscribed to, plus announcements. Everything else starts off.
 */
export function preferencesOnFirstEnable(
  current: PushPreferences = EMPTY_PUSH_PREFERENCES,
): PushPreferences {
  return {
    ...EMPTY_PUSH_PREFERENCES,
    ...current,
    enabled: true,
    defaultsApplied: true,
    newEpisodesAll: false,
    newEpisodesSubscribed: true,
    replies: false,
    likes: false,
    mentions: false,
    announcements: true,
  };
}

/**
 * Applies a category change. "All anime" and "subscribed anime" are mutually
 * exclusive in the database (`push_preferences_episode_mode_chk`), so turning one
 * on turns the other off in the SAME object, which is written in one update.
 */
export function applyPreferenceChange(
  current: PushPreferences,
  change: Partial<Omit<PushPreferences, "defaultsApplied">>,
): PushPreferences {
  const next: PushPreferences = { ...current, ...change };

  if (change.newEpisodesAll === true) next.newEpisodesSubscribed = false;
  if (change.newEpisodesSubscribed === true) next.newEpisodesAll = false;

  return next;
}

/**
 * What the ON/ON-OFF each toggle sends to the database. Both episode flags are
 * always present so a single update can never trip the CHECK constraint.
 */
export function preferenceColumns(preferences: PushPreferences) {
  const newEpisodesAll = preferences.newEpisodesAll && !preferences.newEpisodesSubscribed;

  return {
    enabled: preferences.enabled,
    defaults_applied: preferences.defaultsApplied,
    new_episodes_all: newEpisodesAll,
    new_episodes_subscribed: newEpisodesAll ? false : preferences.newEpisodesSubscribed,
    replies: preferences.replies,
    likes: preferences.likes,
    mentions: preferences.mentions,
    announcements: preferences.announcements,
  };
}

export function preferencesFromRow(row: Record<string, unknown> | null | undefined): PushPreferences {
  if (!row) return { ...EMPTY_PUSH_PREFERENCES };

  return {
    enabled: row.enabled === true,
    defaultsApplied: row.defaults_applied === true,
    newEpisodesAll: row.new_episodes_all === true,
    newEpisodesSubscribed: row.new_episodes_subscribed === true,
    replies: row.replies === true,
    likes: row.likes === true,
    mentions: row.mentions === true,
    announcements: row.announcements === true,
  };
}

// ---------------------------------------------------------------- the master

export type PushEnvironment = {
  /** NEXT_PUBLIC_ONESIGNAL_APP_ID is set (and the SDK could be loaded). */
  configured: boolean;
  /** The browser can do Web Push at all. */
  supported: boolean;
  /** iOS/iPadOS Safari, where push needs an installed web app. */
  isIosSafari: boolean;
  /** Running as an installed web app (home screen / standalone display). */
  isStandalone: boolean;
  /** `Notification.permission`; "unknown" when the API is missing. */
  permission: NotificationPermission | "unknown";
  /** OneSignal's push subscription is opted in for THIS browser. */
  optedIn: boolean;
};

export type MasterToggleState = {
  checked: boolean;
  disabled: boolean;
  /** One sentence under the toggle, or null when everything is fine. */
  notice: string | null;
  noticeKind: "unavailable" | "unsupported" | "ios" | "denied" | null;
};

export const PUSH_NOTICES = {
  unavailable: "Push notifications are not available right now",
  unsupported: "Your browser does not support push notifications",
  ios: "On iPhone, add KumoriTV to your Home Screen to enable push notifications.",
  denied:
    "Notifications are blocked for KumoriTV in this browser. Open the site settings (the padlock in the address bar), allow notifications, then reload this page.",
} as const;

/**
 * The master toggle reflects THIS browser: on only when the browser permission
 * is granted AND OneSignal's subscription is opted in.
 */
export function masterToggleState(environment: PushEnvironment): MasterToggleState {
  if (!environment.configured) {
    return { checked: false, disabled: true, notice: PUSH_NOTICES.unavailable, noticeKind: "unavailable" };
  }
  if (!environment.supported) {
    return { checked: false, disabled: true, notice: PUSH_NOTICES.unsupported, noticeKind: "unsupported" };
  }
  if (environment.isIosSafari && !environment.isStandalone) {
    return { checked: false, disabled: true, notice: PUSH_NOTICES.ios, noticeKind: "ios" };
  }
  if (environment.permission === "denied") {
    // The browser will not ask again: keep it off and say how to unblock.
    return { checked: false, disabled: false, notice: PUSH_NOTICES.denied, noticeKind: "denied" };
  }

  return {
    checked: environment.permission === "granted" && environment.optedIn === true,
    disabled: false,
    notice: null,
    noticeKind: null,
  };
}

/** Whether the category toggles are usable (only when the master is on). */
export function categoriesVisible(master: MasterToggleState): boolean {
  return master.checked && !master.disabled;
}

/**
 * Reads the browser state into a PushEnvironment. Every probe is defensive: a
 * missing API just means "not supported", never a thrown error.
 */
export function detectPushEnvironment(input: {
  configured: boolean;
  optedIn: boolean;
  notificationPermission?: NotificationPermission | "unknown";
  navigatorLike?: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number };
  matchMediaLike?: (query: string) => { matches?: boolean } | null | undefined;
}): PushEnvironment {
  const navigatorLike = input.navigatorLike ?? {};
  const userAgent = navigatorLike.userAgent ?? "";
  const permission =
    input.notificationPermission ??
    (typeof Notification !== "undefined" ? Notification.permission : ("unknown" as const));

  const supported =
    typeof PushManager !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.serviceWorker !== "undefined";

  const isIosDevice = /iPad|iPhone|iPod/.test(userAgent) ||
    // iPadOS 13+ reports a desktop UA; the touch points give it away.
    (/Macintosh/.test(userAgent) && (navigatorLike.maxTouchPoints ?? 0) > 1);
  const isSafari = isIosDevice && !/(CriOS|FxiOS|EdgiOS|OPiOS|mercury)/i.test(userAgent);

  let standalone = navigatorLike.standalone === true;
  try {
    standalone = standalone || input.matchMediaLike?.("(display-mode: standalone)")?.matches === true;
  } catch {
    /* matchMedia is optional */
  }

  return {
    configured: input.configured,
    supported,
    isIosSafari: isSafari,
    isStandalone: standalone,
    permission,
    optedIn: input.optedIn === true,
  };
}
