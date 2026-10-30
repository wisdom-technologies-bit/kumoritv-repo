import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";
import {
  syncAnilistSession,
  type AnilistSessionAdmin,
  type AnilistSessionServer,
  type AnilistViewer,
} from "@/app/lib/user/anilistSession";

const attempts = new Map<string, { count: number; expiresAt: number }>();

async function fetchAnilistViewer(accessToken: string): Promise<AnilistViewer | null> {
  const apiUrl = process.env.NEXT_PUBLIC_ANILIST_API_URL || "https://graphql.anilist.co";
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: "query { Viewer { id name avatar { large medium } } }" }),
  });

  return (await response.json())?.data?.Viewer ?? null;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = attempts.get(ip);

  if (!current || current.expiresAt <= now) attempts.set(ip, { count: 1, expiresAt: now + 60_000 });
  else if (current.count >= 10) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  } else current.count += 1;

  let accessToken: string | undefined;

  try {
    accessToken = ((await request.json()) as { accessToken?: string })?.accessToken;
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_request", error: "The AniList login response was incomplete." },
      { status: 400 }
    );
  }

  const result = await syncAnilistSession({
    accessToken,
    clientId: process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID,
    deps: {
      // The structural types in anilistSession.ts describe only what the flow
      // touches; the generated Supabase types are wider (and deep).
      createAdmin: () => createAdminClient() as unknown as AnilistSessionAdmin | null,
      createServerClient: async () =>
        (await createAuthServerClient()) as unknown as AnilistSessionServer | null,
      fetchViewer: fetchAnilistViewer,
      randomPassword: () => randomBytes(32).toString("base64url"),
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
