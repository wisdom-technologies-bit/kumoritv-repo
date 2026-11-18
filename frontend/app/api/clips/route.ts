// POST /api/clips - create a link-based clip.
// GET  /api/clips - Phase 5: the public browse list.
//
// Nothing is cut or uploaded: the row is a pointer to a time range. A guest is
// identified by the owner cookie (the table only stores its hash); a signed-in
// user by the Supabase session. Rate limits: 10/hour for a guest keyed on
// IP + cookie, 60/hour for a session.

import { cookies } from "next/headers";
import { CLIP_MAX_SECONDS_GUEST, CLIP_MAX_SECONDS_USER, CLIP_OWNER_COOKIE, CLIP_OWNER_COOKIE_MAX_AGE, CLIP_RATE_GUEST, CLIP_RATE_USER, clipPath } from "@/app/lib/clips/constants";
import { validateCreateClipBody } from "@/app/lib/clips/body";
import { createOwnerToken, hashOwnerToken, ownerTokenSecret } from "@/app/lib/clips/owner-token";
import { clipCreationLimiter, createRateLimiter, rateLimitKey } from "@/app/lib/clips/rate-limit";
import { createClipRecord, toPublicClip } from "@/app/lib/clips/server";
import { clientIp, readClipViewer, readOwnerCookie } from "@/app/lib/clips/request";
import { handleBrowse } from "@/app/lib/clips/browse-handler";
import { loadBrowsePage } from "@/app/lib/clips/browse-server";
import { isClipsPublicEnabled } from "@/app/lib/clips/public-flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const browseLimiter = createRateLimiter({ windowMs: 60_000 });

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
      // Behind a TLS proxy `request.url` can still read as http, so trust the
      // configured site origin first. A Secure cookie over plain http is never
      // stored, which would silently break guest ownership.
      secure:
        (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https:") ||
        new URL(request.url).protocol === "https:",
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

/**
 * GET /api/clips?sort=latest|views|week&anime=<id>&q=&cursor=&limit=24
 *
 * Public browse over live clips, newest first by default. The response is the
 * same for every viewer (the adult rule strips adult rows server side), which
 * is what makes the shared cache safe: a CDN can serve one body to everyone.
 * 404 with the flag off, so an owner who has not checked the public list yet is
 * not advertising an endpoint that shows every clip on the site.
 *
 * The decisions live in app/lib/clips/browse-handler.ts; this file is wiring.
 */
export async function GET(request: Request) {
  return handleBrowse(request, {
    enabled: isClipsPublicEnabled,
    load: (query) => loadBrowsePage(query),
    limiter: browseLimiter,
    ip: clientIp(request),
  });
}
