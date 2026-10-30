import anilistUsers from "@/app/api/anilist/anilistUsers";
import axios from "axios";
import {
  addUserInfo,
  removeUserInfo,
} from "@/app/lib/redux/features/manageUserData";
import { makeStore } from "../redux/store";
import userSettingsActions from "@/app/api/cookie/userCookieSettingsActions";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import {
  ANILIST_NOTICE_EVENT,
  BRIDGE_FAILURE_NOTICE,
  describeAnilistError,
  hasAnilistRedirect,
  parseAnilistRedirect,
} from "./anilistLogin";

export const userCustomStore = makeStore();

export const ANILIST_USER_STORAGE_KEY = "anilist-user";

export type AnilistLoginOutcome =
  | { status: "none" }
  | { status: "error"; message: string }
  | { status: "ok"; bridge: "synced" | "linked" | "failed" };

type AnilistLoginOptions = {
  /** Skip the hard reload that picks up the new Supabase session (used by tests). */
  skipReload?: boolean;
  /** Where notices go; defaults to a DOM event the header listens to. */
  onNotice?: (message: string) => void;
};

function notice(message: string, options: AnilistLoginOptions = {}) {
  if (options.onNotice) {
    options.onNotice(message);

    return;
  }

  try {
    window.dispatchEvent(new window.CustomEvent(ANILIST_NOTICE_EVENT, { detail: message }));
  } catch {
    /* no DOM (server render): nothing to show */
  }
}

/** Drops `#access_token=...` from the address bar so a refresh (or the history
 *  entry) never replays the token. */
export function stripAnilistRedirectFromUrl() {
  try {
    const { pathname, search, origin } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}` || origin || "/");
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

/**
 * Consumes the AniList redirect, stores the token cookie, loads the viewer into
 * the redux store + localStorage and bridges the session to Supabase.
 *
 * Runs whatever the current Supabase state is: a visitor who already holds an
 * anonymous (or email) session still gets their AniList identity applied.
 */
export async function handleAnilistUserLoginWithRedux(
  options: AnilistLoginOptions = {}
): Promise<AnilistLoginOutcome> {
  if (typeof window === "undefined") return { status: "none" };

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

  try {
    await axios.post("/api/anilist", { accessToken, tokenType, expiresIn });
  } catch (error) {
    console.warn("[anilist] token cookie was not stored", error);
  }

  const userData = await anilistUsers.getCurrUserData({ accessToken });

  if (!userData) {
    const message = "AniList login failed. Please try again.";

    notice(message, options);

    return { status: "error", message };
  }

  localStorage.setItem(ANILIST_USER_STORAGE_KEY, JSON.stringify(userData));
  userCustomStore.dispatch(addUserInfo(userData));

  let bridge: "synced" | "linked" | "failed" = "failed";

  try {
    const response = await fetch("/api/auth/anilist-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });

    if (response.ok) {
      const data = await response.json().catch(() => null);

      bridge = data?.linked ? "linked" : "synced";
    } else {
      console.warn("[anilist] session bridge failed", response.status);
    }
  } catch (error) {
    console.warn("[anilist] session bridge failed", error);
  }

  if (bridge === "failed") {
    notice(BRIDGE_FAILURE_NOTICE, options);

    return { status: "ok", bridge };
  }

  if (bridge === "synced" && !options.skipReload) {
    // The bridge replaced the session cookie. The browser client keeps the old
    // session in memory, so the page has to boot again to pick the new one up.
    // This is not a manual reload: the login finishes on its own.
    const client = createBrowserSupabaseClient();

    await client?.auth.getSession().catch(() => undefined);
    window.location.replace(window.location.pathname + window.location.search);
  }

  return { status: "ok", bridge };
}

export async function checkAccessTokenStillValid() {
  try {
    await axios.get("/api/anilist");

    return;
  } catch {
    userCustomStore.dispatch(removeUserInfo());
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
    await userSettingsActions.setMediaTitleLanguageCookie({
      lang: titleLanguage,
    });

    await userSettingsActions.setSubtitleLanguageCookie({
      lang: subtitleLanguage,
    });

    await userSettingsActions.setPlayWrongMediaCookie({
      playWrongMedia: playWrongMedia,
    });
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
