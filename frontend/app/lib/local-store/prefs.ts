"use client";
// Kept for backwards compatibility: same exports and signatures as before, now
// provided by app/lib/user-data/prefs.ts (localStorage for guests, profiles for
// signed-in users).

export type { LocalPrefs } from "@/app/lib/user-data/prefs";
export {
  readPrefs,
  useLocalPrefs,
  setLocalPref,
  usePrefs,
  getPrefs,
  setPref,
} from "@/app/lib/user-data/prefs";
