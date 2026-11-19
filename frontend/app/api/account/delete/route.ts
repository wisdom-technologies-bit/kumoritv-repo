import { NextResponse } from "next/server";
import { deleteAccount } from "@/app/lib/account/deletion";
import { removeOneSignalIdentity } from "@/app/lib/push/identity";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";
import { createAdminClient } from "@/app/lib/supabase/admin";

// Phase 6, part F: the list and the order live in app/lib/account/deletion.ts so
// they can be tested. This route is the wiring: who is asking, and which client
// performs each step.
export async function POST() {
  const client = await createAuthServerClient();
  if (!client) return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || user.is_anonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Account deletion is not configured" }, { status: 503 });

  const report = await deleteAccount({
    userId: user.id,
    // Prompt 38D commit B: comments are not hard deleted. The anonymiser decides
    // which ones survive (those somebody replied to) and strips the author.
    anonymiseComments: async () => {
      const { error: rpcError } = await (
        admin as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message?: string } | null }>;
        }
      ).rpc("anonymise_user_comments", { p_user: user.id });
      return { error: rpcError ?? null };
    },
    deleteWhere: async (table, column) => {
      const { error: deleteError } = await admin.from(table).delete().eq(column, user.id);
      return { error: deleteError ?? null };
    },
    // Outside the database: the browser subscription is keyed on external_id.
    removePushIdentity: () => removeOneSignalIdentity(user.id),
    deleteAuthUser: async () => {
      const { error: authError } = await admin.auth.admin.deleteUser(user.id);
      return { error: authError ?? null };
    },
  });

  if (!report.ok) {
    // The only step that can stop a deletion is the auth delete itself.
    if (report.failedTables.length > 0) {
      console.warn("[account] deletion left rows behind", { tables: report.failedTables });
    }
    return NextResponse.json({ error: "Unable to delete account" }, { status: 500 });
  }

  if (report.failedTables.length > 0) {
    // The auth user is gone, so the FKs have cascaded or nulled these anyway;
    // the list is kept for the log rather than for the response.
    console.warn("[account] deletion completed with leftover table deletes", { tables: report.failedTables });
  }
  if (!report.pushRemoved) {
    console.warn("[account] push identity not removed (push unconfigured or provider unavailable)");
  }

  return NextResponse.json({ ok: true });
}
