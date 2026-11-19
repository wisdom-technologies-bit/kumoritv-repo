import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";
import {
  syncAnilistSession,
  type AnilistSessionAdmin,
  type AnilistSessionServer,
} from "@/app/lib/user/anilistSession";
import { fetchAnilistViewer } from "@/app/lib/anilist/viewer";
import { anilistErrorMessage, logAnilistFailure } from "@/app/lib/anilist/errors";
import { clientIp, consume } from "@/app/lib/anilist/rateLimit";
import { anilistCookieMaxAge } from "@/app/lib/user/anilistLogin";
import {
  TOKEN_COOKIE_NAME,
  readAnilistToken,
  serializeToken,
  type AnilistToken,
} from "@/app/lib/anilist/tokenCookie";
import { TITLE_LANGUAGE_COOKIE, TITLE_LANGUAGE_MAX_AGE } from "@/app/lib/titles/language";

export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

// ResponseCookies.set takes the cookie options flattened, not nested under
// `options`; a nested object silently drops HttpOnly/Secure.
function cookieEntries(token: AnilistToken, seededTitleLanguage?: string) {
  const entries: {
    name: string;
    value: string;
    httpOnly?: boolean;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
  }[] = [
    {
      name: TOKEN_COOKIE_NAME,
      value: serializeToken(token, "implicit"),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: anilistCookieMaxAge(token.expiresIn),
    },
  ];

  if (seededTitleLanguage) {
    entries.push({
      name: TITLE_LANGUAGE_COOKIE,
      value: seededTitleLanguage,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: TITLE_LANGUAGE_MAX_AGE,
    });
  }

  return entries;
}

/**
 * Implicit grant: the browser holds the token for a moment and posts it here.
 * The token is validated once against AniList, the Supabase account is linked or
 * created, and the viewer the UI needs comes back in the same response. The
 * browser never calls AniList itself, and Firestore is not involved.
 */
export async function POST(request: NextRequest) {
  if (!consume(`anilist-session:${clientIp(request.headers)}`, RATE_LIMIT.limit, RATE_LIMIT.windowMs)) {
    logAnilistFailure("ANILIST_RATE_LIMITED", "session");

    return NextResponse.json(
      { ok: false, code: "ANILIST_RATE_LIMITED", error: anilistErrorMessage("ANILIST_RATE_LIMITED") },
      { status: 429 }
    );
  }

  let body: { accessToken?: string; tokenType?: string; expiresIn?: string | number | null };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "ANILIST_TOKEN_MISSING", error: anilistErrorMessage("ANILIST_TOKEN_MISSING") },
      { status: 400 }
    );
  }

  const result = await syncAnilistSession({
    accessToken: body?.accessToken,
    clientId: process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID,
    deps: {
      // The structural types in anilistSession.ts describe only what the flow
      // touches; the generated Supabase types are wider (and deep).
      createAdmin: () => createAdminClient() as unknown as AnilistSessionAdmin | null,
      createServerClient: async () =>
        (await createAuthServerClient()) as unknown as AnilistSessionServer | null,
      fetchViewer: (accessToken) => fetchAnilistViewer(accessToken),
      randomPassword: () => randomBytes(32).toString("base64url"),
    },
  });

  const response = NextResponse.json(result.body, { status: result.status });

  if (result.body.ok && body?.accessToken) {
    const token: AnilistToken = {
      accessToken: body.accessToken,
      tokenType: body.tokenType || "Bearer",
      expiresIn:
        body.expiresIn === null || body.expiresIn === undefined ? null : String(body.expiresIn),
    };

    for (const cookie of cookieEntries(token, result.body.seededTitleLanguage)) {
      response.cookies.set(cookie);
    }
  }

  return response;
}

/**
 * Code grant: the callback route already stored the (encrypted) token in an
 * httpOnly cookie and linked the account. This only hands the viewer to the UI,
 * so the redux/localStorage user can be built without the token ever reaching
 * client JavaScript.
 */
export async function GET(request: NextRequest) {
  if (!consume(`anilist-viewer:${clientIp(request.headers)}`, RATE_LIMIT.limit, RATE_LIMIT.windowMs)) {
    logAnilistFailure("ANILIST_RATE_LIMITED", "viewer");

    return NextResponse.json(
      { ok: false, code: "ANILIST_RATE_LIMITED", error: anilistErrorMessage("ANILIST_RATE_LIMITED") },
      { status: 429 }
    );
  }

  const token = readAnilistToken(request.cookies.get(TOKEN_COOKIE_NAME)?.value);

  if (!token) {
    return NextResponse.json(
      { ok: false, code: "ANILIST_TOKEN_MISSING", error: anilistErrorMessage("ANILIST_TOKEN_MISSING") },
      { status: 401 }
    );
  }

  const viewer = await fetchAnilistViewer(token.accessToken);

  if (!viewer.ok) {
    return NextResponse.json(
      { ok: false, code: viewer.code, error: anilistErrorMessage(viewer.code) },
      { status: viewer.status >= 400 && viewer.status < 600 ? viewer.status : 502 }
    );
  }

  return NextResponse.json({ ok: true, flow: "code", viewer: viewer.viewer });
}
