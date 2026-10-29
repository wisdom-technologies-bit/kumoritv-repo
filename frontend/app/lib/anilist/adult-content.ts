// Adult-content preference, restored (default HIDDEN).
//
// ON only when a signed-in profile has `show_adult` true, or a guest carries the
// `is_adult_content_enabled=true` cookie. For signed-in users the profile wins
// and the cookie is kept in sync. The server is the source of truth: when
// hidden, AniList gets `isAdult: false`; when shown the argument is omitted
// entirely, because `isAdult: true` would return adult titles ONLY.

export const ADULT_COOKIE = "is_adult_content_enabled";

export type AdultSetting = {
  show: boolean;
  source: "profile" | "cookie" | "default";
};

export function parseAdultEnabled(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

/** Profile wins when it is a real boolean; otherwise the cookie decides. */
export function resolveAdultSetting({
  profileShow,
  cookieValue,
}: {
  profileShow?: boolean | null;
  cookieValue?: string | null;
}): AdultSetting {
  if (typeof profileShow === "boolean")
    return { show: profileShow, source: "profile" };
  if (cookieValue != null)
    return { show: parseAdultEnabled(cookieValue), source: "cookie" };
  return { show: false, source: "default" };
}

/** The `isAdult` variable: only ever sent as false, when adult titles are hidden. */
export function adultQueryVariables(show: boolean): { isAdult?: false } {
  return show ? {} : { isAdult: false };
}

type MaybeMedia = { isAdult?: unknown; media?: { isAdult?: unknown } };

/**
 * Defensive filter for the lists AniList cannot filter itself (airing
 * schedules, media trends, recommendations).
 */
export function filterMediasWithAdultContent<T>(items: T[], show: boolean): T[] {
  if (show || !Array.isArray(items)) return items;
  return items.filter((item) => {
    const value = item as MaybeMedia;
    const adult =
      typeof value?.isAdult === "boolean"
        ? value.isAdult
        : typeof value?.media?.isAdult === "boolean"
          ? value.media.isAdult
          : false;
    return adult !== true;
  });
}

/**
 * Reads the setting on the server: signed-in profile first, cookie second.
 * Never throws: any failure means adult content stays hidden.
 */
export async function readShowAdultContent(): Promise<boolean> {
  let cookieValue: string | null = null;
  try {
    const { cookies } = await import("next/headers");
    cookieValue = cookies().get(ADULT_COOKIE)?.value ?? null;
  } catch {
    cookieValue = null;
  }

  try {
    const { createClient } = await import("@/app/lib/supabase/server");
    const client: any = createClient();
    if (client) {
      const { data } = await client.auth.getUser();
      const userId = data?.user?.id;
      if (userId) {
        const { data: profile } = await client
          .from("profiles")
          .select("show_adult")
          .eq("id", userId)
          .maybeSingle();
        if (typeof profile?.show_adult === "boolean") {
          const { source } = resolveAdultSetting({ profileShow: profile.show_adult });
          void source;
          return profile.show_adult;
        }
      }
    }
  } catch {
    /* fall through to the cookie */
  }

  return resolveAdultSetting({ cookieValue }).show;
}

/** Keeps the cookie in sync with the profile / the guest choice. */
export function adultCookieOptions(value: boolean) {
  return {
    name: ADULT_COOKIE,
    value: value ? "true" : "false",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax" as const,
  };
}
