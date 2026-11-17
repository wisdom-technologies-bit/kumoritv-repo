// POST /api/community/admin/announcements
//
// Phase 4, part B2. Session first, then `is_admin()` (security definer over
// staff_roles), then validation, then the write WITH THE CALLER'S SESSION so the
// announcements admin policies apply as well. No service role here: RLS can
// express every rule this route needs.
//
// Idempotency: the browser sends one UUID per compose attempt and the row keeps
// it under a unique index. A double click therefore loses the race in Postgres
// (23505) and the existing row is returned instead of a second announcement.
import { revalidatePath } from "next/cache";
import { readCommunityAdmin } from "@/app/lib/community/admin";
import { ADMIN_WRITES_PER_MINUTE, adminWriteLimiter } from "@/app/lib/community/rate-limit";
import { validateAnnouncementInput } from "@/app/lib/community/announcement-form";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AnnouncementRowClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string; is_anonymous?: boolean } | null } }>;
  };
  rpc: (name: "is_admin") => Promise<{ data: unknown; error: unknown }>;
  from: (table: "announcements") => {
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string } | null; error: { code?: string; message?: string } | null }>;
      };
    };
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: { message?: string } | null }> };
    };
  };
};

export function announcementsRevalidate(id?: string): void {
  // The pages are force-dynamic, so this is belt and braces for the day one of
  // them gets a cache. It is cheap and it documents which pages show rows.
  try {
    revalidatePath("/community");
    revalidatePath("/community/announcements");
    if (id) revalidatePath(`/community/announcements/${id}`);
  } catch {
    /* not inside a request: nothing to revalidate */
  }
}

export function audit(line: {
  adminId: string;
  action: "create" | "update" | "delete";
  announcementId: string | null;
}): void {
  // The existing moderation table only accepts hide/unhide/remove/restore/
  // role_change actions and has no insert grant for any browser role, so an
  // announcement write is recorded on the server log instead of bending that
  // table's meaning. See the report.
  console.info(
    `[community][audit] ${line.action} announcement=${line.announcementId ?? "new"} admin=${line.adminId}`,
  );
}

/** The two gates every admin route shares. */
export async function requireAdminSession(): Promise<
  | { ok: true; client: AnnouncementRowClient; adminId: string }
  | { ok: false; response: Response }
> {
  if (!isCommunityEnabled()) {
    return { ok: false, response: Response.json({ error: "not_found" }, { status: 404 }) };
  }

  const raw = await createAuthServerClient();
  if (!raw) {
    return {
      ok: false,
      response: Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }),
    };
  }
  const client = raw as unknown as AnnouncementRowClient;

  const { data } = await client.auth.getUser();
  const user = data?.user;
  // An anonymous Supabase session is not a staff account.
  if (!user || user.is_anonymous) {
    return {
      ok: false,
      response: Response.json(
        { error: "unauthorized", message: "Sign in with a staff account." },
        { status: 401, headers: { "cache-control": "no-store" } },
      ),
    };
  }

  const { data: isAdmin } = await client.rpc("is_admin");
  if (isAdmin !== true) {
    // 404, not 403: a non-admin should not learn that the composer exists.
    return {
      ok: false,
      response: Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } }),
    };
  }

  const admin = await readCommunityAdmin();
  // The same cookie client just asked twice; this second call only guarantees
  // that a disagreement between the two clients fails closed.
  if (!admin) {
    return {
      ok: false,
      response: Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } }),
    };
  }

  return { ok: true, client, adminId: user.id };
}

export type AdminGate = Awaited<ReturnType<typeof requireAdminSession>>;

export type CreateDeps = {
  /** Tests only: the real gate talks to Supabase through cookies. */
  gate?: () => Promise<AdminGate>;
  limiter?: { check: (key: string, limit: number, now?: number) => { allowed: boolean; retryAfterSeconds: number } };
};

export async function POST(request: Request, deps: CreateDeps = {}): Promise<Response> {
  const gate = await (deps.gate ?? requireAdminSession)();
  if (!gate.ok) return gate.response;

  const decision = (deps.limiter ?? adminWriteLimiter).check(`admin:${gate.adminId}`, ADMIN_WRITES_PER_MINUTE);
  if (!decision.allowed) {
    return Response.json(
      { error: "rate_limited", message: "Too many writes. Try again in a minute." },
      { status: 429, headers: { "cache-control": "no-store", "retry-after": String(decision.retryAfterSeconds) } },
    );
  }

  const raw = await request.json().catch(() => null);
  const validated = validateAnnouncementInput(raw);
  if (!validated.ok) {
    return Response.json(
      { error: "invalid", field: validated.field, message: validated.message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const input = validated.value;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    title: input.title,
    body: input.body,
    image: input.image,
    url: input.url,
    expires_at: input.expiresAt,
    created_by: gate.adminId,
    updated_at: now,
    idempotency_key: input.idempotencyKey,
    // "Send push notification" OFF is expressed as "already sent", which is the
    // exact predicate the existing cron uses. No cron change needed.
    push_sent_at: input.sendPush ? null : now,
  };

  const { data, error } = await gate.client.from("announcements").insert(row).select("id").single();

  if (error) {
    // A repeated idempotency key is the double click, not a failure.
    if (error.code === "23505" && input.idempotencyKey) {
      const existing = await gate.client
        .from("announcements")
        .select("id")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing.data?.id) {
        return Response.json(
          { ok: true, id: existing.data.id, deduped: true },
          { headers: { "cache-control": "no-store" } },
        );
      }
    }
    console.error("[community] announcement insert failed", error);
    return Response.json(
      { error: "write_failed", message: "The announcement could not be saved." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  if (!data?.id) {
    return Response.json(
      { error: "write_failed", message: "The announcement could not be saved." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  audit({ adminId: gate.adminId, action: "create", announcementId: data.id });
  announcementsRevalidate(data.id);

  return Response.json({ ok: true, id: data.id }, { headers: { "cache-control": "no-store" } });
}
