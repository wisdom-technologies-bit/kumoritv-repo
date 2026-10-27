"use client";
// Playback preferences. Signed in -> `profiles`; guest -> localStorage (as before).

import { useCallback, useEffect, useState } from "react";
import { attempt, isSignedIn, resolveContext, type UserDataContextInput } from "./context";
import { writeJson } from "./storage";
import userSettingsActions from "@/app/api/cookie/userCookieSettingsActions";
import type { ProfilePrefsRow, UserPrefs } from "./types";

export type LocalPrefs = UserPrefs;

const defaults: LocalPrefs = {
  autoSkip: false,
  autoNext: true,
  dubEpisodes: false,
  subtitle_language: "English",
};

export const PREFS_CACHE_PREFIX = "kumori_prefs_cache_";
export function prefsCacheKey(userId: string): string {
  return `${PREFS_CACHE_PREFIX}${userId}`;
}

function get(key: keyof LocalPrefs) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaults[key];
    return key === "subtitle_language" ? v : v === "true";
  } catch {
    return defaults[key];
  }
}

export function readPrefs(): LocalPrefs {
  if (typeof window === "undefined") return defaults;
  return {
    autoSkip: get("autoSkip") as boolean,
    autoNext: get("autoNext") as boolean,
    dubEpisodes: get("dubEpisodes") as boolean,
    subtitle_language: get("subtitle_language") as string,
  };
}

export function useLocalPrefs() {
  const [prefs, setPrefs] = useState<LocalPrefs>(defaults);
  useEffect(() => {
    setPrefs(readPrefs());
    const fn = () => setPrefs(readPrefs());
    window.addEventListener("storage", fn);
    return () => window.removeEventListener("storage", fn);
  }, []);
  return prefs;
}

export function setLocalPref<K extends keyof LocalPrefs>(key: K, value: LocalPrefs[K]) {
  try {
    localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------- profiles

export function profileToPrefs(row: Partial<ProfilePrefsRow> | null | undefined): LocalPrefs {
  if (!row) return { ...defaults };
  return {
    autoSkip: Boolean(row.auto_skip),
    autoNext: row.auto_next === null || row.auto_next === undefined ? true : Boolean(row.auto_next),
    dubEpisodes: row.preferred_audio === "dub",
    subtitle_language: row.subtitle_language || "English",
  };
}

export function prefsToProfilePatch(key: keyof LocalPrefs, value: boolean | string) {
  switch (key) {
    case "autoSkip":
      return { auto_skip: Boolean(value) };
    case "autoNext":
      return { auto_next: Boolean(value) };
    case "dubEpisodes":
      return { preferred_audio: value ? "dub" : "sub" };
    case "subtitle_language":
      return { subtitle_language: String(value) };
    default:
      return {};
  }
}

export async function getPrefs(input?: UserDataContextInput): Promise<LocalPrefs> {
  const local = readPrefs();
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return local;

  const result = await attempt("prefs.get", async () => {
    const { data, error } = await ctx.client!.from("profiles")
      .select("auto_skip, auto_next, preferred_audio, subtitle_language, created_at, updated_at")
      .eq("id", ctx.userId)
      .maybeSingle();
    if (error) throw error;
    return profileToPrefs(data);
  });

  if (!result.ok) return local;

  writeJson(ctx.storage, prefsCacheKey(ctx.userId!), result.data);
  return result.data;
}

async function setSubtitleCookie(value: string) {
  try {
    await userSettingsActions.setSubtitleLanguageCookie({ lang: value });
  } catch {
    /* cookies are best effort */
  }
}

export async function setPref<K extends keyof LocalPrefs>(
  key: K,
  value: LocalPrefs[K],
  input?: UserDataContextInput,
): Promise<boolean> {
  setLocalPref(key, value);

  if (key === "subtitle_language") void setSubtitleCookie(String(value));

  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return true;

  const result = await attempt("prefs.set", async () => {
    const { error } = await ctx.client!.from("profiles")
      .update(prefsToProfilePatch(key, value))
      .eq("id", ctx.userId);
    if (error) throw error;
    return true;
  });

  return result.ok;
}

/** Drop-in replacement for useLocalPrefs that also reads/writes the profile. */
export function usePrefs(input?: UserDataContextInput) {
  const [prefs, setPrefs] = useState<LocalPrefs>(defaults);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setPrefs(readPrefs());

    getPrefs(input)
      .then((next) => {
        if (active) setPrefs(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback(
    async <K extends keyof LocalPrefs>(key: K, value: LocalPrefs[K]) => {
      setPrefs((current) => ({ ...current, [key]: value }));
      await setPref(key, value, input);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { prefs, loading, setPref: update };
}
