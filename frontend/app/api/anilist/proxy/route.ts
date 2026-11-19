import { NextRequest, NextResponse } from "next/server";
import { ANILIST_GRAPHQL_URL } from "@/app/lib/anilist/endpoint";
import { TOKEN_COOKIE_NAME, readAnilistToken } from "@/app/lib/anilist/tokenCookie";
import { clientIp, consume } from "@/app/lib/anilist/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Authenticated GraphQL relay for the browser.
 *
 * The favourite / list / notification buttons used to call AniList straight from
 * the browser, which meant GET /api/anilist had to hand the access token to
 * JavaScript. They now post their query here: the token stays in the httpOnly
 * cookie and never reaches client code, in either auth flow.
 */
export async function POST(request: NextRequest) {
  if (!consume(`anilist-proxy:${clientIp(request.headers)}`, 60, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const token = readAnilistToken(request.cookies.get(TOKEN_COOKIE_NAME)?.value);

  if (!token) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let payload: { query?: unknown; variables?: unknown };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (typeof payload?.query !== "string" || payload.query.length > 8000) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const response = await fetch(ANILIST_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token.accessToken}`,
        accept: "application/json",
      },
      body: JSON.stringify({ query: payload.query, variables: payload.variables ?? {} }),
      cache: "no-store",
    });

    const body = await response.json().catch(() => ({}));

    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json({ error: "anilist_unreachable" }, { status: 502 });
  }
}
