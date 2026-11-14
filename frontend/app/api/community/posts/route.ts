// POST /api/community/posts - the only way to create a community post.
//
// Auth: a real signed-in account. A "continue as guest" Supabase session is
// rejected here AND by RLS (there is no insert policy at all).
// author_id comes from the verified session, never from the body.
// Validation: length, empty-body and profanity run on the server; the durable
// 1/30 s, 20/h and duplicate-body limits live in community_posts_guard().
import { clientIp } from "@/app/lib/clips/request";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { postCreateLimiter } from "@/app/lib/community/rate-limit";
import { handleCreatePost, type CommunitySession } from "@/app/lib/community/posts-server";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { getClipByCode } from "@/app/lib/clips/server";
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
    return Response.json(
      { error: "unavailable", message: "Posting is unavailable right now." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await handleCreatePost({
    session,
    raw,
    ip: clientIp(request),
    limiter: postCreateLimiter,
    // The clip is looked up with the service role and only its id and title are
    // kept; nothing the browser said about the clip is trusted.
    resolveClip: async (code) => {
      const row = await getClipByCode(code);
      return row ? { id: row.id, title: row.title } : null;
    },
    insert: async (row) => {
      const { data, error } = await (admin as any)
        .from("community_posts")
        .insert({ ...row, status: "published" })
        .select("id, author_id, body, is_spoiler, created_at, clip_id, link_url")
        .single();
      return { data: data ?? null, error: error ?? null };
    },
  });

  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store", ...(result.headers ?? {}) },
  });
}
