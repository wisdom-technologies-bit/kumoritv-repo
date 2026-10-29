// Adult content preference endpoint (default: hidden).
// Signed-in: writes profiles.show_adult and mirrors it to the cookie.
// Guest: writes the cookie only. The server reads this on every AniList call.

import { cookies } from "next/headers";
import { createClient } from "@/app/lib/supabase/server";
import {
  ADULT_COOKIE,
  adultCookieOptions,
  parseAdultEnabled,
  resolveAdultSetting,
} from "@/app/lib/anilist/adult-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readState() {
  const cookieValue = cookies().get(ADULT_COOKIE)?.value ?? null;
  let profileShow: boolean | null = null;
  let signedIn = false;
  try {
    const client: any = createClient();
    if (client) {
      const { data } = await client.auth.getUser();
      const userId = data?.user?.id;
      if (userId) {
        signedIn = true;
        const { data: profile } = await client
          .from("profiles")
          .select("show_adult")
          .eq("id", userId)
          .maybeSingle();
        profileShow =
          typeof profile?.show_adult === "boolean" ? profile.show_adult : null;
      }
    }
  } catch {
    /* guest / anonymous */
  }
  const setting = resolveAdultSetting({ profileShow, cookieValue });
  return { show: setting.show, source: setting.source, signedIn };
}

export async function GET() {
  return Response.json(await readState(), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const value =
    typeof body?.enabled === "boolean"
      ? body.enabled
      : parseAdultEnabled(body?.enabled ?? body?.show_adult);

  let signedIn = false;
  try {
    const client: any = createClient();
    if (client) {
      const { data } = await client.auth.getUser();
      const userId = data?.user?.id;
      if (userId) {
        signedIn = true;
        await client
          .from("profiles")
          .update({ show_adult: value })
          .eq("id", userId);
      }
    }
  } catch {
    /* guest: cookie only */
  }

  // The cookie stays in sync for signed-in users and is the whole store for guests.
  const options = adultCookieOptions(value);
  cookies().set(options.name, options.value, {
    path: options.path,
    maxAge: options.maxAge,
    sameSite: options.sameSite,
  });

  return Response.json({ show: value, signedIn }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE() {
  cookies().set(adultCookieOptions(false).name, "false", {
    path: "/",
    maxAge: 0,
  });
  return Response.json({ show: false });
}
