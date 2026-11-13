// DELETE /api/community/posts/[id] - soft delete (deleted_at), never a row
// removal: the report trail has to survive.
//
// The write runs with the CALLER's session, so the RLS update policy decides
// who may do it: the author or staff. The guard then freezes status/pinned for
// everyone who is not staff, so this route cannot be used to hide a post.
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: { params: { id: string } }) {
  if (!isCommunityEnabled()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const id = context?.params?.id ?? "";
  if (!UUID.test(id)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const client = await createAuthServerClient();
  if (!client) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  const { data: auth } = await client.auth.getUser();
  const user = auth?.user;
  if (!user) {
    return Response.json({ error: "unauthorized", message: "Sign in first." }, { status: 401 });
  }
  if (user.is_anonymous) {
    return Response.json({ error: "sign_in_required", message: "Sign in first." }, { status: 403 });
  }

  // Idempotent: deleting an already-deleted post is a success.
  const { data: existing, error: readError } = await (client as any)
    .from("community_posts")
    .select("id, author_id, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!existing) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (existing.deleted_at) {
    return Response.json({ ok: true, alreadyDeleted: true }, { headers: { "cache-control": "no-store" } });
  }

  const { data: updated, error } = await (client as any)
    .from("community_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, author_id")
    .maybeSingle();

  if (error) {
    // RLS refuses a row the caller may not touch; that is a 403, not a 500.
    const message = String(error.message ?? "");
    if (/row-level security|permission denied/i.test(message)) {
      return Response.json({ error: "forbidden", message: "You cannot delete that post." }, { status: 403 });
    }
    return Response.json({ error: "delete_failed" }, { status: 500 });
  }
  if (!updated) {
    return Response.json({ error: "forbidden", message: "You cannot delete that post." }, { status: 403 });
  }

  // A staff removal is logged; the author's own delete is not.
  if (updated.author_id !== user.id) {
    const admin = createAdminClient();
    await (admin as any)?.from("community_moderation_log").insert({
      actor_id: user.id,
      action: "remove",
      target_kind: "post",
      target_id: id,
      reason: "author delete by staff",
    });
  }

  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
