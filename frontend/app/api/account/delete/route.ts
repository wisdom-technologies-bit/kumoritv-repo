import { NextResponse } from "next/server";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";
import { createAdminClient } from "@/app/lib/supabase/admin";

export async function POST() {
  const client = await createAuthServerClient();
  if (!client) return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || user.is_anonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Account deletion is not configured" }, { status: 503 });
  // Prompt 38D commit B: comments are no longer hard deleted here. The
  // anonymiser decides which ones survive (those somebody replied to) and
  // strips the author from them; the foreign key's ON DELETE SET NULL is the
  // safety net if this call fails.
  const anonymise = await (
    admin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    }
  ).rpc("anonymise_user_comments", { p_user: user.id });

  for (const table of ["favourites", "watchlist", "watch_progress", "comment_reactions"] as const) {
    const column = table === "comment_reactions" ? "user_id" : "user_id";
    await admin.from(table).delete().eq(column, user.id);
  }

  // Prompt 38D commit B - community rows.
  //
  // Comments are handled by anonymise_user_comments above: a comment with
  // replies stays with user_id NULL and the body "[deleted]", one without
  // replies is removed.
  //
  // - posts are removed (and their comments go with them, by FK);
  // - reactions and blocks are the user's own and go;
  // - reports are KEPT and anonymised by the foreign keys themselves
  //   (reporter_id / resolved_by are `on delete set null`), so the moderation
  //   trail survives an account deletion.
  const communityCleanup: Array<{ table: string; column: string }> = [
    { table: "community_posts", column: "author_id" },
    { table: "community_reactions", column: "user_id" },
    { table: "community_blocks", column: "blocker_id" },
    { table: "community_blocks", column: "blocked_id" },
    { table: "staff_roles", column: "user_id" },
  ];

  for (const { table, column } of communityCleanup) {
    try {
      await admin.from(table).delete().eq(column, user.id);
    } catch {
      // The community migration may not be applied in this environment; a
      // missing table must never block an account deletion.
    }
  }
  if (anonymise.error) {
    // Do not abort the deletion: the key's SET NULL still removes the identity,
    // and a stuck deletion is worse than a kept body.
  }

  const result = await admin.auth.admin.deleteUser(user.id);
  if (result.error) return NextResponse.json({ error: "Unable to delete account" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
