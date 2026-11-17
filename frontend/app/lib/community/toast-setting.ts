"use client";

// Phase 4, part A4: "New post notifications", one setting with two homes.
//
//   * signed-in users: `profiles.community_toasts` (RLS: own row only), so the
//     choice follows them to another device;
//   * everyone (including guests): localStorage, so a visitor who hides the bar
//     is not shown it again on the next page.
//
// The toast reads the value at POLL time, not at mount, so flipping the switch
// takes effect on the next poll without a reload. A tiny module-level cache plus
// subscribers keeps the settings modal and the toast in step without a context
// provider of their own.

import type { SupabaseClient } from "@supabase/supabase-js";

export const TOAST_SETTING_KEY = "kumori.community.toasts";

let cached: boolean | null = null;
const listeners = new Set<(value: boolean) => void>();

function notify(value: boolean): void {
  for (const listener of listeners) listener(value);
}

/** Default ON, as the owner asked. */
export function readStoredToastSetting(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(TOAST_SETTING_KEY);
    if (raw === null) return true;
    return raw !== "0";
  } catch {
    // Private mode, storage disabled, quota: the default is still safe.
    return true;
  }
}

export function getToastSetting(): boolean {
  if (cached !== null) return cached;
  return readStoredToastSetting();
}

/** Writes both homes; localStorage failures never block the switch. */
export function setToastSetting(value: boolean): void {
  cached = value;
  try {
    window.localStorage.setItem(TOAST_SETTING_KEY, value ? "1" : "0");
  } catch {
    /* the in-memory value still applies for this page */
  }
  notify(value);
}

/** A signed-in profile value wins over whatever this browser remembered. */
export function applyServerToastSetting(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  cached = value;
  try {
    window.localStorage.setItem(TOAST_SETTING_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  notify(value);
  return value;
}

export function subscribeToastSetting(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Just the one call this module makes, typed without `any`. */
type ProfilesWriter = {
  from: (table: "profiles") => {
    update: (values: Record<string, unknown>) => {
      eq: (column: "id", value: string) => Promise<{ error: { message?: string } | null }>;
    };
  };
};

/**
 * The profile write. The browser client carries the user's session, so the
 * existing "profiles update own" policy (auth.uid() = id) is the only thing
 * deciding whether this lands. Returns false on any failure so the caller can
 * put the switch back.
 */
export async function saveToastSettingToProfile(
  client: SupabaseClient | null,
  userId: string | null,
  value: boolean,
): Promise<boolean> {
  if (!client || !userId) return false;
  try {
    const db = client as unknown as ProfilesWriter;
    const { error } = await db.from("profiles").update({ community_toasts: value }).eq("id", userId);
    return !error;
  } catch {
    return false;
  }
}
