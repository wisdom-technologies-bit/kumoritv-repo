// PATCH / DELETE /api/community/admin/announcements/[id]
//
// Same gates as the create route: real session, `is_admin()`, rate limit, then a
// write with the caller's own client so RLS applies.
//
// PATCH never touches `push_sent_at`: editing an announcement that already went
// out must not send it again, and an edit that was never sent is still picked up
// by the cron exactly once. `sendPush` is ignored on an edit for that reason.
import { ADMIN_WRITES_PER_MINUTE, adminWriteLimiter } from "@/app/lib/community/rate-limit";
import { announcementsRevalidate, audit, requireAdminSession } from "../route";
import { validateAnnouncementInput } from "@/app/lib/community/announcement-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UpdateResult = {
  data: { id: string } | null;
  error: { code?: string; message?: string } | null;
};

type WriteClient = {
  from: (table: "announcements") => {
    update: (values: Record<string, unknown>) => {
      eq: (column: "id", value: string) => {
        select: (columns: string) => { maybeSingle: () => Promise<UpdateResult> };
      };
    };
    delete: () => {
      eq: (column: "id", value: string) => {
        select: (columns: string) => { maybeSingle: () => Promise<UpdateResult> };
      };
    };
  };
};

export type EditDeps = {
  /** Tests only: the real gate talks to Supabase through cookies. */
  gate?: () => Promise<ReturnType<typeof requireAdminSession> extends Promise<infer T> ? T : never>;
  limiter?: { check: (key: string, limit: number, now?: number) => { allowed: boolean; retryAfterSeconds: number } };
};

export async function PATCH(request: Request, context: { params: { id: string } }, deps: EditDeps = {}): Promise<Response> {
  const gate = await (deps.gate ?? requireAdminSession)();
  if (!gate.ok) return gate.response;

  const id = context?.params?.id ?? "";
  if (!UUID.test(id)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

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
  const client = gate.client as unknown as WriteClient;

  const { data, error } = await client
    .from("announcements")
    .update({
      title: input.title,
      body: input.body,
      image: input.image,
      url: input.url,
      expires_at: input.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[community] announcement update failed", error);
    return Response.json(
      { error: "write_failed", message: "The announcement could not be saved." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
  if (!data?.id) {
    // RLS returns no row for a non-admin; that is indistinguishable from a
    // missing id on purpose.
    return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  audit({ adminId: gate.adminId, action: "update", announcementId: id });
  announcementsRevalidate(id);

  return Response.json({ ok: true, id }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(
  _request: Request,
  context: { params: { id: string } },
  deps: EditDeps = {},
): Promise<Response> {
  const gate = await (deps.gate ?? requireAdminSession)();
  if (!gate.ok) return gate.response;

  const id = context?.params?.id ?? "";
  if (!UUID.test(id)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const decision = (deps.limiter ?? adminWriteLimiter).check(`admin:${gate.adminId}`, ADMIN_WRITES_PER_MINUTE);
  if (!decision.allowed) {
    return Response.json(
      { error: "rate_limited", message: "Too many writes. Try again in a minute." },
      { status: 429, headers: { "cache-control": "no-store", "retry-after": String(decision.retryAfterSeconds) } },
    );
  }

  const client = gate.client as unknown as WriteClient;
  const { data, error } = await client.from("announcements").delete().eq("id", id).select("id").maybeSingle();

  if (error) {
    console.error("[community] announcement delete failed", error);
    return Response.json(
      { error: "write_failed", message: "The announcement could not be deleted." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
  if (!data?.id) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  audit({ adminId: gate.adminId, action: "delete", announcementId: id });
  announcementsRevalidate();

  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
