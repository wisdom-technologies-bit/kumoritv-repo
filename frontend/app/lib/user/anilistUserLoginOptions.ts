"use client";
// The AniList login, from the browser side.
//
// The viewer now comes from ONE server call (/api/auth/anilist-session), which
// validates the token against AniList, links or creates the Supabase account and
// returns the fields the UI needs. There is no Firestore step and no second
// browser call to AniList.
import axios from "axios";
import { addUserInfo, removeUserInfo } from "@/app/lib/redux/features/manageUserData";
import { getAppStore } from "../redux/appStore";
import userSettingsActions from "@/app/api/cookie/userCookieSettingsActions";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import {
  ANILIST_CODE_ERROR_PARAM,
  ANILIST_CODE_PARAM,
  ANILIST_NOTICE_EVENT,
  describeAnilistError,
  hasAnilistRedirect,
  parseAnilistRedirect,
} from "./anilistLogin";
import {
  ANILIST_ERROR_CODES,
  anilistErrorMessage,
  type AnilistErrorCode,
} from "@/app/lib/anilist/errors";
import type { AnilistViewer } from "@/app/lib/anilist/viewer";
import { normaliseTitleLanguage, TITLE_LANGUAGE_COOKIE } from "@/app/lib/titles/language";

/** @deprecated Use getAppStore(); kept so older imports keep working. */
export const userCustomStore = { dispatch: (...args: Parameters<ReturnType<typeof getAppStore>["dispatch"]>) => getAppStore().dispatch(...args), getState: () => getAppStore().getState() };

export const ANILIST_USER_STORAGE_KEY = "anilist-user";

export type AnilistLoginOutcome =
  | { status: "none" }
  | { status: "error"; message: string; code?: AnilistErrorCode }
  | { status: "ok"; bridge: "synced" | "linked" };

type AnilistLoginOptions = {
  /** Skip the hard reload that picks up the new Supabase session (used by tests). */
  skipReload?: boolean;
  /** Where notices go; defaults to a DOM event the header listens to. */
  onNotice?: (message: string, code?: AnilistErrorCode) => void;
};

function notice(message: string, options: AnilistLoginOptions = {}, code?: AnilistErrorCode) {
  if (options.onNotice) {
    options.onNotice(message, code);

    return;
  }

  try {
    window.dispatchEvent(new window.CustomEvent(ANILIST_NOTICE_EVENT, { detail: { message, code } }));
  } catch {
    /* no DOM (server render): nothing to show */
  }
}

/** Drops the login parameters from the address bar so a refresh (or the history
 *  entry) never replays the token. */
export function stripAnilistRedirectFromUrl() {
  try {
    const { pathname, search } = window.location;
    const params = new URLSearchParams(search);

    params.delete(ANILIST_CODE_PARAM);
    params.delete(ANILIST_CODE_ERROR_PARAM);

    const query = params.toString();

    window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}` || "/");
  } catch {
    /* jsdom-less environments */
  }
}

export function currentAnilistRedirect() {
  if (typeof window === "undefined") return "";

  const { hash, search } = window.location;

  if (hasAnilistRedirect(hash ?? "")) return hash ?? "";
  if (hasAnilistRedirect(search ?? "")) return search ?? "";

  return "";
}

function asErrorCode(value: string | null): AnilistErrorCode | undefined {
  return value && (ANILIST_ERROR_CODES as readonly string[]).includes(value)
    ? (value as AnilistErrorCode)
    : undefined;
}

/** The redux/localStorage shape the rest of the app reads. */
export function viewerToUser(viewer: AnilistViewer): UserAnilist {
  return {
    isUserFromAnilist: true,
    id: viewer.id,
    name: viewer.name ?? "",
    createdAt: 0,
    avatar: {
      large: viewer.avatar?.large ?? "",
      medium: viewer.avatar?.medium ?? "",
    },
    favourites: { anime: { nodes: [] }, manga: { nodes: [] } },
    options: {
      displayAdultContent: Boolean(viewer.options?.displayAdultContent),
      titleLanguage: viewer.options?.titleLanguage ?? "ROMAJI",
    },
  };
}

/** Stores the user and, on a first link only, mirrors the seeded title language. */
function storeUser(viewer: AnilistViewer, seededTitleLanguage?: string) {
  const user = viewerToUser(viewer);

  localStorage.setItem(ANILIST_USER_STORAGE_KEY, JSON.stringify(user));
  getAppStore().dispatch(addUserInfo(user));

  const seeded = normaliseTitleLanguage(seededTitleLanguage);

  if (!seeded) return;

  try {
    // Never overwrite a choice this browser already holds.
    if (!localStorage.getItem(TITLE_LANGUAGE_COOKIE)) {
      localStorage.setItem(TITLE_LANGUAGE_COOKIE, seeded);
    }
  } catch {
    /* storage can be unavailable */
  }
}

function fail(code: AnilistErrorCode, options: AnilistLoginOptions): AnilistLoginOutcome {
  const message = anilistErrorMessage(code);

  notice(message, options, code);
  console.warn(`[anilist] code=${code}`);

  return { status: "error", message, code };
}

/**
 * Code grant: the callback already stored the token and linked the account. This
 * only asks the server for the viewer, so the UI has a user object.
 */
async function completeCodeLogin(options: AnilistLoginOptions): Promise<AnilistLoginOutcome> {
  let response: Response;

  try {
    response = await fetch("/api/auth/anilist-session", { cache: "no-store" });
  } catch {
    return fail("ANILIST_VIEWER_UNREACHABLE", options);
  }

  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; code?: string; viewer?: AnilistViewer }
    | null;

  if (!response.ok || !data?.ok || !data.viewer) {
    return fail(asErrorCode(data?.code ?? null) ?? "ANILIST_SYNC_FAILED", options);
  }

  storeUser(data.viewer);

  if (!options.skipReload) {
    const client = createBrowserSupabaseClient();

    await client?.auth.getSession().catch(() => undefined);
    window.location.replace(window.location.pathname + window.location.search);
  }

  return { status: "ok", bridge: "synced" };
}

/**
 * Consumes the AniList redirect (implicit hash or code-flow query), asks the
 * server to validate the login, then loads the viewer into redux + localStorage.
 */
export async function handleAnilistUserLoginWithRedux(
  options: AnilistLoginOptions = {}
): Promise<AnilistLoginOutcome> {
  if (typeof window === "undefined") return { status: "none" };

  const search = new URLSearchParams(window.location.search);
  const codeError = search.get(ANILIST_CODE_ERROR_PARAM);

  if (codeError) {
    stripAnilistRedirectFromUrl();

    return fail(asErrorCode(codeError) ?? "ANILIST_SYNC_FAILED", options);
  }

  if (search.get(ANILIST_CODE_PARAM)) {
    stripAnilistRedirectFromUrl();

    return completeCodeLogin(options);
  }

  const raw = currentAnilistRedirect();

  if (!raw) return { status: "none" };

  const parsed = parseAnilistRedirect(raw);

  if (parsed.error) {
    const message = describeAnilistError(parsed.error);

    stripAnilistRedirectFromUrl();
    notice(message, options);
    console.warn("[anilist] login error", parsed.error);

    return { status: "error", message };
  }

  if (!parsed.token) return { status: "none" };

  const { accessToken, tokenType, expiresIn } = parsed.token;

  // The token leaves the address bar before the first request.
  stripAnilistRedirectFromUrl();

  let response: Response;

  try {
    response = await fetch("/api/auth/anilist-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken, tokenType, expiresIn }),
    });
  } catch {
    return fail("ANILIST_VIEWER_UNREACHABLE", options);
  }

  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; code?: string; linked?: boolean; viewer?: AnilistViewer; seededTitleLanguage?: string }
    | null;

  if (!response.ok || !data?.ok || !data.viewer) {
    return fail(asErrorCode(data?.code ?? null) ?? "ANILIST_SYNC_FAILED", options);
  }

  storeUser(data.viewer, data.seededTitleLanguage);

  if (data.linked === false && !options.skipReload) {
    // The bridge replaced the session cookie. The browser client keeps the old
    // session in memory, so the page has to boot again to pick the new one up.
    const client = createBrowserSupabaseClient();

    await client?.auth.getSession().catch(() => undefined);
    window.location.replace(window.location.pathname + window.location.search);
  }

  return { status: "ok", bridge: data.linked ? "linked" : "synced" };
}

export async function checkAccessTokenStillValid() {
  try {
    await axios.get("/api/anilist");

    return;
  } catch {
    getAppStore().dispatch(removeUserInfo());
  }
}

export async function addUserCookies({
  isAdultContentEnabled,
  titleLanguage,
  subtitleLanguage,
  playWrongMedia,
}: {
  isAdultContentEnabled: string;
  titleLanguage: string;
  subtitleLanguage: string;
  playWrongMedia: string;
}) {
  try {
    await userSettingsActions.setMediaTitleLanguageCookie({ lang: titleLanguage });
    await userSettingsActions.setSubtitleLanguageCookie({ lang: subtitleLanguage });
    await userSettingsActions.setPlayWrongMediaCookie({ playWrongMedia });
  } catch (err) {
    console.log(err);

    return err;
  }
}

export async function removeCookies() {
  try {
    await axios.delete("/api/media-title-language");
    await axios.delete("/api/subtitle");
    await axios.delete("/api/anilist");
  } catch (err) {
    console.log(err);

    return err;
  }
}
