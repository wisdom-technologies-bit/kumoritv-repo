"use client";
// The one place that talks to OneSignal. Everything here is defensive: a missing
// env var, a browser without push, a blocked script or a rejected promise all end
// up as "push unavailable", never as an exception thrown into the page.

import { oneSignalInitOptions, onesignalAppId, pushConfigured } from "./config";

type PushSubscriptionLike = {
  optedIn?: boolean | null;
  optIn?: () => Promise<void>;
  optOut?: () => Promise<void>;
  addEventListener?: (event: "change", listener: (change: unknown) => void) => void;
  removeEventListener?: (event: "change", listener: (change: unknown) => void) => void;
};

/** Only the slice of the Web SDK v16 API this app uses. */
export type PushClient = {
  init: (options: Record<string, unknown>) => Promise<void> | void;
  login: (externalId: string) => Promise<void> | void;
  logout: () => Promise<void> | void;
  Notifications?: {
    permission?: boolean;
    permissionNative?: NotificationPermission;
    isPushSupported?: () => boolean;
    requestPermission?: () => Promise<boolean>;
  };
  User?: { PushSubscription?: PushSubscriptionLike };
};

export type PushBrowserState = {
  configured: boolean;
  initialized: boolean;
  supported: boolean;
  permission: NotificationPermission | "unknown";
  optedIn: boolean;
  /** Last initialisation failure, for logs only (never shown to the user). */
  error: string | null;
};

let client: PushClient | null = null;
let loader: Promise<PushClient | null> | null = null;
let initializer: Promise<boolean> | null = null;
let initialized = false;
let lastError: string | null = null;
let externalId: string | null = null;

/** Loads the SDK once. Returns null when the package cannot load (offline, CSP,
 *  unsupported browser) instead of rejecting. */
export async function loadPushClient(): Promise<PushClient | null> {
  if (client) return client;
  if (loader) return loader;

  loader = (async () => {
    try {
      const module = await import("react-onesignal");
      const sdk = (module as unknown as { default?: PushClient }).default ?? (module as unknown as PushClient);
      if (!sdk || typeof sdk.init !== "function") throw new Error("OneSignal SDK shape unknown");
      client = sdk;
      return sdk;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      client = null;
      return null;
    }
  })();

  return loader;
}

/**
 * Initialises the SDK at most once. Only called for a signed-in user: guests
 * never load OneSignal at all.
 */
export async function ensurePushInitialized(): Promise<boolean> {
  if (initialized) return true;
  if (initializer) return initializer;

  initializer = (async () => {
    if (!pushConfigured()) {
      lastError = "missing_app_id";
      return false;
    }

    const sdk = await loadPushClient();
    if (!sdk) return false;

    try {
      await sdk.init(
        oneSignalInitOptions(onesignalAppId(), process.env.NODE_ENV === "development"),
      );
      initialized = true;
      lastError = null;
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      initialized = false;
      return false;
    }
  })();

  return initializer;
}

/**
 * Keeps the OneSignal External ID equal to the Supabase user id. Sign-out logs
 * the browser out so the next account does not inherit the subscription.
 */
export async function syncPushIdentity(userId: string | null): Promise<void> {
  if (!userId) {
    if (externalId && client) {
      try {
        await client.logout();
      } catch {
        /* logging out of a dead SDK is not an error worth surfacing */
      }
    }
    externalId = null;
    return;
  }

  if (externalId === userId) return;

  const ready = await ensurePushInitialized();
  if (!ready || !client) return;

  try {
    await client.login(userId);
    externalId = userId;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

/** Reads what THIS browser currently reports. Safe to call before init. */
export function currentPushState(): PushBrowserState {
  let permission: NotificationPermission | "unknown" = "unknown";
  try {
    permission = typeof Notification !== "undefined" ? Notification.permission : "unknown";
  } catch {
    permission = "unknown";
  }

  let supported = false;
  try {
    supported = client?.Notifications?.isPushSupported
      ? client.Notifications.isPushSupported() === true
      : typeof PushManager !== "undefined" && typeof navigator !== "undefined" && !!navigator.serviceWorker;
  } catch {
    supported = false;
  }

  // `permissionNative` is authoritative once the SDK is up.
  const sdkPermission = client?.Notifications?.permissionNative;
  if (sdkPermission) permission = sdkPermission;

  return {
    configured: pushConfigured(),
    initialized,
    supported,
    permission,
    optedIn: client?.User?.PushSubscription?.optedIn === true,
    error: lastError,
  };
}

export type OptInResult = "granted" | "denied" | "dismissed" | "unavailable" | "error";

/**
 * Turning the master toggle ON: ask the browser once, then opt the push
 * subscription in. This is the only path that triggers the permission prompt.
 */
export async function requestPushPermissionAndOptIn(): Promise<OptInResult> {
  const ready = await ensurePushInitialized();
  if (!ready || !client) return "unavailable";

  try {
    // The browser will not show the prompt again after a denial, so asking is
    // pointless: report "denied" and let the section explain how to unblock.
    const nativeNow =
      client.Notifications?.permissionNative ??
      (typeof Notification !== "undefined" ? Notification.permission : "default");

    if (nativeNow === "denied") return "denied";

    const alreadyGranted =
      client.Notifications?.permissionNative === "granted" ||
      (typeof Notification !== "undefined" && Notification.permission === "granted");

    if (!alreadyGranted) {
      const granted = await client.Notifications?.requestPermission?.();
      if (!granted) {
        const native =
          client.Notifications?.permissionNative ??
          (typeof Notification !== "undefined" ? Notification.permission : "default");
        return native === "denied" ? "denied" : "dismissed";
      }
    }

    await client.User?.PushSubscription?.optIn?.();
    return "granted";
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return "error";
  }
}

/** Turning the master toggle OFF: opt this browser out (no push from it). */
export async function optOutPush(): Promise<boolean> {
  if (!initialized || !client) return true;
  try {
    await client.User?.PushSubscription?.optOut?.();
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

/** Subscribes to OneSignal's subscription changes so the toggle stays truthful. */
export function watchPushSubscription(listener: () => void): () => void {
  const subscription = client?.User?.PushSubscription;
  if (!subscription?.addEventListener) return () => {};

  try {
    subscription.addEventListener("change", listener);
    return () => {
      try {
        subscription.removeEventListener?.("change", listener);
      } catch {
        /* nothing to clean up */
      }
    };
  } catch {
    return () => {};
  }
}

// ------------------------------------------------------------------ test seams

export function __setPushClientForTests(next: PushClient | null): void {
  client = next;
  loader = next ? Promise.resolve(next) : null;
  initialized = Boolean(next);
  initializer = next ? Promise.resolve(true) : null;
  lastError = null;
  externalId = null;
}

export function __resetPushRuntimeForTests(): void {
  client = null;
  loader = null;
  initializer = null;
  initialized = false;
  lastError = null;
  externalId = null;
}
