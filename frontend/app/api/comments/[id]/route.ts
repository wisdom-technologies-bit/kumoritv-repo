// PATCH /api/comments/<id>  - the spoiler flag only.
// DELETE /api/comments/<id> - soft delete.
//
// Both run with the service role (after the lockdown file the browser has no
// write grant on public.comments), so ownership is enforced in the WHERE clause
// here: id AND user_id = the session user. Someone else's comment answers 404,
// not 403, because a 403 would confirm the comment exists.
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { handleDeleteComment, handleUpdateComment, type CommentSession } from "@/app/lib/comments/comments-server";
import { patchCommentSpoiler, softDeleteCommentRow } from "@/app/lib/comments/admin-writes";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

async function readSession(): Promise<CommentSession | null> {
  try {
    const client = await createAuthServerClient();
    const { data } = (await client?.auth.getUser()) ?? { data: { user: null } };
    const user = data?.user;
    return user ? { userId: user.id, isAnonymous: user.is_anonymous === true } : null;
  } catch {
    return null;
  }
}

function unavailable(): Response {
  return Response.json(
    { error: "unavailable", message: "Commenting is unavailable right now." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  if (!isCommunityEnabled()) return Response.json({ error: "not_found" }, { status: 404 });

  const admin = createAdminClient();
  if (!admin) return unavailable();

  const raw = await request.json().catch(() => null);
  const result = await handleUpdateComment({
    session: await readSession(),
    commentId: context.params.id,
    raw,
    update: async ({ commentId, userId, isSpoiler }) => patchCommentSpoiler(admin, { commentId, userId, isSpoiler }),
  });

  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  if (!isCommunityEnabled()) return Response.json({ error: "not_found" }, { status: 404 });

  const admin = createAdminClient();
  if (!admin) return unavailable();

  const result = await handleDeleteComment({
    session: await readSession(),
    commentId: context.params.id,
    remove: async ({ commentId, userId, at }) => softDeleteCommentRow(admin, { commentId, userId, at }),
  });

  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
