// POST /api/clips - create a link-based clip.
//
// Nothing is cut or uploaded: the row is a pointer to a time range. A guest is
// identified by the owner cookie (the table only stores its hash); a signed-in
// user by the Supabase session. Rate limits: 10/hour for a guest keyed on
// IP + cookie, 60/hour for a session.

import { cookies } from "next/headers";
import { CLIP_MAX_SECONDS_GUEST, CLIP_MAX_SECONDS_USER, CLIP_OWNER_COOKIE, CLIP_OWNER_COOKIE_MAX_AGE, CLIP_RATE_GUEST, CLIP_RATE_USER, clipPath } from "@/app/lib/clips/constants";
import { validateCreateClipBody } from "@/app/lib/clips/body";
import { createOwnerToken, hashOwnerToken, ownerTokenSecret } from "@/app/lib/clips/owner-token";
import { clipCreationLimiter, rateLimitKey } from "@/app/lib/clips/rate-limit";
import { createClipRecord, toPublicClip } from "@/app/lib/clips/server";
import { clientIp, readClipViewer, readOwnerCookie } from "@/app/lib/clips/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  unknown_anime: 400,
  invalid_owner_token: 400,
  database_unavailable: 503,
  insert_failed: 500,
  code_unavailable: 503,
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const viewer = await readClipViewer();
  const maxSeconds = viewer.userId ? CLIP_MAX_SECONDS_USER : CLIP_MAX_SECONDS_GUEST;

  const parsed = validateCreateClipBody(body, maxSeconds);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error, message: parsed.message }, { status: 400 });
  }

  // Guests prove ownership with a first-party HttpOnly cookie; the raw token is
  // never stored, never logged and never returned.
  const ownerToken = viewer.userId ? null : readOwnerCookie() ?? createOwnerToken();
  const ownerHash = ownerToken ? hashOwnerToken(ownerToken, ownerTokenSecret()) : null;

  const decision = clipCreationLimiter.check(
    rateLimitKey({ userId: viewer.userId, ip: clientIp(request), ownerHash }),
    viewer.userId ? CLIP_RATE_USER : CLIP_RATE_GUEST,
  );
  if (!decision.allowed) {
    return Response.json(
      {
        error: "rate_limited",
        message: "You're creating clips too quickly. Try again later.",
        retryAfter: decision.retryAfterSeconds,
      },
      { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
    );
  }

  const created = await createClipRecord({
    anilistId: parsed.value.anilistId,
    episode: parsed.value.episode,
    start: parsed.value.start,
    end: parsed.value.end,
    title: parsed.value.title,
    audio: parsed.value.audio,
    userId: viewer.userId,
    ownerToken,
  });

  if (!created.ok) {
    return Response.json(
      { error: created.error },
      { status: STATUS[created.error] ?? 500 },
    );
  }

  if (ownerToken) {
    cookies().set(CLIP_OWNER_COOKIE, ownerToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: CLIP_OWNER_COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  }

  return Response.json(
    {
      clip: toPublicClip(created.clip),
      url: clipPath(created.clip.code),
      owner: viewer.userId ? "user" : "guest",
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
