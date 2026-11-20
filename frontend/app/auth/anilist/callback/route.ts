import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { publicOrigin } from "@/app/lib/http/origin";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";
import { syncAnilistSession, type AnilistSessionAdmin, type AnilistSessionServer } from "@/app/lib/user/anilistSession";
import { ANILIST_TOKEN_ENDPOINT } from "@/app/lib/anilist/endpoint";
import { logAnilistFailure, type AnilistErrorCode } from "@/app/lib/anilist/errors";
import { isCodeFlow } from "@/app/lib/anilist/flow";
import { encryptionKeyFromEnv, serializeToken, TOKEN_COOKIE_NAME, type AnilistToken } from "@/app/lib/anilist/tokenCookie";
import { STATE_COOKIE_NAME, deriveStateKey, verifyState } from "@/app/lib/anilist/state";
import { anilistCookieMaxAge } from "@/app/lib/user/anilistLogin";
import { TITLE_LANGUAGE_COOKIE, TITLE_LANGUAGE_MAX_AGE } from "@/app/lib/titles/language";

export const dynamic = "force-dynamic";

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
};

/**
 * Authorization-code callback. The code is exchanged server to server with the
 * client secret, the token is stored encrypted in an httpOnly cookie, and the
 * browser is sent back to the app with no token anywhere in the URL.
 */
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const params = request.nextUrl.searchParams;
  const back = (query: string) => NextResponse.redirect(new URL(`/${query}`, origin));

  if (!isCodeFlow()) return back("");

  const oauthError = params.get("error");

  // AniList's own refusal (usually `access_denied`): reuse the existing wording.
  if (oauthError) return back(`?error=${encodeURIComponent(oauthError)}`);

  const code = params.get("code");

  if (!code) {
    logAnilistFailure("ANILIST_CODE_EXCHANGE_FAILED", "no_code");

    return back("?anilist_error=ANILIST_CODE_EXCHANGE_FAILED");
  }

  let key: Buffer;

  try {
    key = encryptionKeyFromEnv();
  } catch {
    logAnilistFailure("ANILIST_CONFIG_MISSING", "encryption_key");

    return back("?anilist_error=ANILIST_CONFIG_MISSING");
  }

  const check = verifyState(params.get("state"), deriveStateKey(key), {
    cookieNonce: request.cookies.get(STATE_COOKIE_NAME)?.value ?? null,
  });

  if (!check.ok) {
    logAnilistFailure("ANILIST_STATE_INVALID", check.reason);

    return back("?anilist_error=ANILIST_STATE_INVALID");
  }

  const clientId = process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID;
  const clientSecret = process.env.ANILIST_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logAnilistFailure("ANILIST_CONFIG_MISSING", "client_credentials");

    return back("?anilist_error=ANILIST_CONFIG_MISSING");
  }

  let exchanged: TokenResponse | null = null;

  try {
    const response = await fetch(ANILIST_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/auth/anilist/callback`,
        code,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      // The status is safe to log; the body may echo request details.
      logAnilistFailure("ANILIST_CODE_EXCHANGE_FAILED", response.status);

      return back("?anilist_error=ANILIST_CODE_EXCHANGE_FAILED");
    }

    exchanged = (await response.json()) as TokenResponse;
  } catch {
    logAnilistFailure("ANILIST_VIEWER_UNREACHABLE", "token_endpoint");

    return back("?anilist_error=ANILIST_VIEWER_UNREACHABLE");
  }

  const accessToken = exchanged?.access_token;

  if (!accessToken) {
    logAnilistFailure("ANILIST_CODE_EXCHANGE_FAILED", "no_access_token");

    return back("?anilist_error=ANILIST_CODE_EXCHANGE_FAILED");
  }

  const token: AnilistToken = {
    accessToken,
    tokenType: exchanged?.token_type || "Bearer",
    expiresIn: exchanged?.expires_in === undefined ? null : String(exchanged.expires_in),
  };

  const sync = await syncAnilistSession({
    accessToken,
    clientId,
    deps: {
      createAdmin: () => createAdminClient() as unknown as AnilistSessionAdmin | null,
      createServerClient: async () => (await createAuthServerClient()) as unknown as AnilistSessionServer | null,
      fetchViewer: async (value) => {
        const { fetchAnilistViewer } = await import("@/app/lib/anilist/viewer");

        return fetchAnilistViewer(value);
      },
      randomPassword: () => randomBytes(32).toString("base64url"),
    },
  });

  const response = back(
    sync.body.ok ? "?anilist=linked" : `?anilist_error=${sync.body.code ?? "ANILIST_SYNC_FAILED"}`
  );

  // The token is kept even when the account sync failed: AniList accepted the
  // login, and the next visit can retry the link without a second authorisation.
  response.cookies.set({
    name: TOKEN_COOKIE_NAME,
    value: serializeToken(token, "code", key),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: anilistCookieMaxAge(token.expiresIn),
  });

  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  if (sync.body.seededTitleLanguage) {
    response.cookies.set({
      name: TITLE_LANGUAGE_COOKIE,
      value: sync.body.seededTitleLanguage,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: TITLE_LANGUAGE_MAX_AGE,
    });
  }

  return response;
}

export type { AnilistErrorCode };
