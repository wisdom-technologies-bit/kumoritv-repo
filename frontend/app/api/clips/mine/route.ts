// GET /api/clips/mine - the community composer's "My recent clips" tab.
//
// Signed-in accounts only: a guest gets 401 sign_in_required, because a guest
// cannot post and a picker that ends in "sign in to post" is a lie.
//
// The two sources and the adult rule are explained in app/lib/clips/mine.ts;
// this file is only the wiring: session, cookie hash, rate limit, database.
// Nothing is cached (no-store): the answer depends on who is asking and on
// their adult-content setting.

import { createRateLimiter } from "@/app/lib/clips/rate-limit";
import { hashOwnerToken, ownerTokenSecret } from "@/app/lib/clips/owner-token";
import { getAnimeSummaries, listClipsByOwnerHash, listUserClips } from "@/app/lib/clips/server";
import { handleClipsMine, MINE_NO_STORE } from "@/app/lib/clips/mine";
import { clientIp, readClipViewer, readOwnerCookie } from "@/app/lib/clips/request";
import { readShowAdultContent } from "@/app/lib/anilist/adult-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60_000 });

export async function GET(request: Request) {
  const viewer = await readClipViewer();

  // The owner hash is derived server-side from the cookie; the raw token never
  // leaves the browser and the table only holds the digest.
  const ownerToken = readOwnerCookie();
  const ownerHash = ownerToken ? hashOwnerToken(ownerToken, ownerTokenSecret()) : null;

  const result = await handleClipsMine({
    session: viewer,
    ownerHash,
    showAdult: await readShowAdultContent(),
    ip: clientIp(request),
    limiter,
    listAccountClips: (userId, limit) => listUserClips(userId, limit),
    listGuestClips: (hash, limit) => listClipsByOwnerHash(hash, limit),
    getAnime: (ids) => getAnimeSummaries(ids),
  });

  return Response.json(result.body, { status: result.status, headers: result.headers ?? MINE_NO_STORE });
}
