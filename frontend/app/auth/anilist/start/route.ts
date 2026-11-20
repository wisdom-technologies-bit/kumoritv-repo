import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/app/lib/http/origin";
import { anilistAuthorizeUrl, anilistCodeAuthorizeUrl } from "@/app/lib/user/anilistLogin";
import { isCodeFlow } from "@/app/lib/anilist/flow";
import { encryptionKeyFromEnv } from "@/app/lib/anilist/tokenCookie";
import { STATE_COOKIE_NAME, STATE_TTL_MS, createState, deriveStateKey } from "@/app/lib/anilist/state";
import { logAnilistFailure } from "@/app/lib/anilist/errors";

export const dynamic = "force-dynamic";

/**
 * The AniList login button points here, so the flow (implicit or code) is decided
 * on the server and one env var flips it without touching the client.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID;
  const origin = publicOrigin(request);

  if (!clientId) {
    logAnilistFailure("ANILIST_CONFIG_MISSING", "client_id");

    return NextResponse.redirect(new URL("/?anilist_error=ANILIST_CONFIG_MISSING", origin));
  }

  if (!isCodeFlow()) {
    const url = anilistAuthorizeUrl(clientId);

    if (!url) return NextResponse.redirect(new URL("/?anilist_error=ANILIST_CONFIG_MISSING", origin));

    return NextResponse.redirect(url);
  }

  let key: Buffer;

  try {
    key = encryptionKeyFromEnv();
  } catch {
    // Fail closed: without the key the token could not be stored encrypted.
    logAnilistFailure("ANILIST_CONFIG_MISSING", "encryption_key");

    return NextResponse.redirect(new URL("/?anilist_error=ANILIST_CONFIG_MISSING", origin));
  }

  const { state, nonce } = createState(deriveStateKey(key));
  const url = anilistCodeAuthorizeUrl(clientId, `${origin}/auth/anilist/callback`, state);

  if (!url) return NextResponse.redirect(new URL("/?anilist_error=ANILIST_CONFIG_MISSING", origin));

  const response = NextResponse.redirect(url);

  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: nonce,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });

  return response;
}

