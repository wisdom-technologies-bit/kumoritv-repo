import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { createAdminClient } from "@/app/lib/supabase/admin";

export async function POST() {
  const client = createClient();
  if (!client) return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || user.is_anonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Account deletion is not configured" }, { status: 503 });
  for (const table of ["favourites", "watchlist", "watch_progress", "comments", "comment_reactions"] as const) {
    const column = table === "comment_reactions" ? "user_id" : "user_id";
    await admin.from(table).delete().eq(column, user.id);
  }
  const result = await admin.auth.admin.deleteUser(user.id);
  if (result.error) return NextResponse.json({ error: "Unable to delete account" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
