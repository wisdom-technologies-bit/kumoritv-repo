// POST /api/comments - the only way a comment is created.
//
// Before Phase 6 the browser inserted into public.comments with the viewer's
// session and RLS decided. RLS can check ownership and target visibility but it
// cannot run a profanity filter or answer with a sentence a person can read, so
// the write moved here. The lockdown SQL (community-phase-6-lockdown.sql)
// removes the browser's INSERT grant; this route writes with the service role
// after validating, filtering and rate limiting.
//
// user_id comes from the verified session, never from the body.
import { clientIp } from "@/app/lib/clips/request";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { commentCreateLimiter, COMMENT_PER_MINUTE } from "@/app/lib/community/rate-limit";
import { handleCreateComment, type CommentSession } from "@/app/lib/comments/comments-server";
import { insertCommentRow } from "@/app/lib/comments/admin-writes";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isCommunityEnabled()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const raw = await request.json().catch(() => null);

  let session: CommentSession | null = null;
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
    return Response.json(
      { error: "unavailable", message: "Commenting is unavailable right now." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await handleCreateComment({
    session,
    raw,
    ip: clientIp(request),
    limiter: commentCreateLimiter,
    limit: COMMENT_PER_MINUTE,
    insert: async (row) => insertCommentRow(admin, row as unknown as Record<string, unknown>),
  });

  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store", ...(result.headers ?? {}) },
  });
}
