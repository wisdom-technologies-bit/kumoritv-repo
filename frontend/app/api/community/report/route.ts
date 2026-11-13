// POST /api/community/report - report a post, a comment or an announcement.
//
// Guests may report: their identity is a salted IP hash, never the raw IP and
// never a client-supplied id. A signed-in reporter is stored by user id so the
// unique index makes a second report a 409 instead of noise.
import { clientIp } from "@/app/lib/clips/request";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { handleCreateReport, type CommunitySession } from "@/app/lib/community/posts-server";
import { reporterHashFor } from "@/app/lib/community/reporter";
import { reportLimiter } from "@/app/lib/community/rate-limit";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCommunityEnabled()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const raw = await request.json().catch(() => null);

  let session: CommunitySession | null = null;
  try {
    const client = await createAuthServerClient();
    const { data } = (await client?.auth.getUser()) ?? { data: { user: null } };
    const user = data?.user;
    if (user) session = { userId: user.id, isAnonymous: user.is_anonymous === true };
  } catch {
    session = null;
  }

  const admin = createAdminClient();
  if (!admin) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  const result = await handleCreateReport({
    session,
    raw,
    reporterHash: reporterHashFor(clientIp(request)),
    limiter: reportLimiter,
    insert: async (row) => {
      const { error } = await (admin as any).from("community_reports").insert(row);
      return { error: error ?? null };
    },
  });

  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store", ...(result.headers ?? {}) },
  });
}
