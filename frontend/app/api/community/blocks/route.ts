// POST /api/community/blocks - block or unblock a person.
// GET  /api/community/blocks - the viewer's own block list.
//
// A block is the viewer's own row, so the write runs on the viewer's session and
// RLS (blocker_id = auth.uid()) is the authority. The ONE thing RLS cannot
// express is "is the target a staff account": staff_roles is deliberately
// invisible to browsers, so looking it up needs the service role. That is the
// only use of the admin client in this file, and it reads one row by id.
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Supabase builder; rows are narrowed below */
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createClient } from "@/app/lib/supabase/server";
import { isCommunityEnabled } from "@/app/lib/community/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noStore(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

type Client = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => any;
};

/** Injected in tests; the real route always builds both from the request. */
export type BlockDeps = { sessionClient?: Client | null; adminClient?: unknown };

export async function GET(_request?: unknown, deps: BlockDeps = {}): Promise<Response> {
  if (!isCommunityEnabled()) return noStore({ error: "disabled" }, 404);

  const client = (deps.sessionClient ?? createClient()) as unknown as Client | null;
  if (!client) return noStore({ error: "unavailable" }, 503);

  const { data } = await client.auth.getUser();
  const me = data.user?.id;
  if (!me) return noStore({ blocked: [] }, 200);

  const { data: rows, error } = await client
    .from("community_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", me)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return noStore({ error: "unavailable" }, 503);

  const ids: string[] = ((rows ?? []) as { blocked_id: string }[]).map((row) => row.blocked_id);
  let names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: profiles } = await client
      .from("public_profiles")
      .select("id, display_name, username")
      .in("id", ids);
    names = Object.fromEntries(
      ((profiles ?? []) as { id: string; display_name: string | null; username: string | null }[]).map((row) => [
        row.id,
        row.display_name || row.username || "member",
      ]),
    );
  }

  return noStore({ blocked: ids.map((id) => ({ id, name: names[id] ?? "member" })) }, 200);
}

export async function POST(request: Request, deps: BlockDeps = {}): Promise<Response> {
  if (!isCommunityEnabled()) return noStore({ error: "disabled" }, 404);

  const client = (deps.sessionClient ?? createClient()) as unknown as Client | null;
  if (!client) return noStore({ error: "unavailable" }, 503);

  const { data } = await client.auth.getUser();
  const me = data.user?.id;
  if (!me) return noStore({ error: "auth_required", message: "Sign in to block someone." }, 401);

  const raw = await request.json().catch(() => null);
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const target = typeof body.userId === "string" && UUID.test(body.userId) ? body.userId : null;
  const action = body.action === "unblock" ? "unblock" : "block";

  if (!target) return noStore({ error: "invalid_target", message: "Pick a person to block." }, 400);
  if (target === me) {
    return noStore({ error: "self_block", message: "You cannot block yourself." }, 400);
  }

  if (action === "block") {
    // Staff roles are SQL-only. One indexed read through the service role is the
    // smallest way to answer "is this a moderator"; nothing but a boolean leaves
    // this function and the client never sees the row.
    const admin = (deps.adminClient ?? createAdminClient()) as any;
    if (admin) {
      const { data: role } = await (admin as any)
        .from("staff_roles")
        .select("role")
        .eq("user_id", target)
        .maybeSingle();
      if (role) {
        return noStore(
          {
            error: "staff_target",
            message:
              "You can't block a moderator. If something breaks the rules, use Report and the team will see it.",
          },
          403,
        );
      }
    }

    const { error } = await client
      .from("community_blocks")
      .upsert({ blocker_id: me, blocked_id: target }, { onConflict: "blocker_id,blocked_id" });
    if (error) return noStore({ error: "unavailable", message: "That did not save. Try again." }, 503);
    return noStore({ ok: true, blocked: true }, 200);
  }

  const { error } = await client
    .from("community_blocks")
    .delete()
    .eq("blocker_id", me)
    .eq("blocked_id", target);
  if (error) return noStore({ error: "unavailable", message: "That did not save. Try again." }, 503);
  return noStore({ ok: true, blocked: false }, 200);
}
