"use client";

// Community Phase 4 / Part A3: `?toastdebug=1`, the owner's on-phone diagnostic.
//
// Deliberately tiny and stateless: the parameter is read from the URL and
// nothing is ever written back. It is the only way the chip can appear, and it
// changes no behaviour: the toast decision is identical with or without it.

export const TOAST_DEBUG_PARAM = "toastdebug";

/** Why the last poll did or did not show a toast (shown only with ?toastdebug=1). */
export type ToastDecisionReason =
  | "seeded"
  | "shown"
  | "path"
  | "fullscreen"
  | "preroll"
  | "typing"
  | "setting"
  | "own item"
  | "throttled"
  | "visible"
  | "deferred"
  | "none new";

/** True only for `?toastdebug=1` (or `=true`). Never persisted. */
export function readToastDebug(search?: string): boolean {
  if (typeof window === "undefined" && search === undefined) return false;
  const query = search ?? window.location.search;
  try {
    const value = new URLSearchParams(query).get(TOAST_DEBUG_PARAM);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}
