// POST /api/community/admin/reports/bulk - dismiss many reports at once.
//
// Body: { ids: string[], note?: string }  (1..50 community_reports ids)
//    or { clipIds: string[], note?: string } (1..50 clips: every open clip report
//    on those clips is dismissed).
//
// Bulk dismiss only: actioning a report is a decision about one piece of
// content, and content actions have their own route (/admin/moderate), so a
// bulk "dismiss" cannot accidentally hide fifty unrelated posts. The database
// function re-checks the count and the role.
import { classifyReportError } from "@/app/lib/community/moderation";
import { MODERATION_PER_MINUTE, moderationLimiter } from "@/app/lib/community/rate-limit";
import { requireStaffSession, type StaffGate } from "@/app/lib/community/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BULK_MAX = 50;

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type BulkDeps = {
  gate?: () => Promise<StaffGate>;
  limiter?: { check: (key: string, limit: number, now?: number) => { allowed: boolean; retryAfterSeconds: number } };
};

function noStore(body: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...(extra ?? {}) } });
}

export async function POST(request: Request, _context?: unknown, deps: BulkDeps = {}): Promise<Response> {
  const gate = await (deps.gate ?? requireStaffSession)();
  if (!gate.ok) return gate.response;

  const decision = (deps.limiter ?? moderationLimiter).check(
    `moderate:${gate.staff.userId}`,
    MODERATION_PER_MINUTE,
  );
  if (!decision.allowed) {
    return noStore(
      { error: "rate_limited", message: "Too many moderation actions. Try again in a minute." },
      429,
      { "retry-after": String(decision.retryAfterSeconds) },
    );
  }

  const raw = await request.json().catch(() => null);
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const rawClipIds = Array.isArray(body.clipIds) ? body.clipIds : [];
  const ids = [...new Set(rawIds.filter((value): value is string => typeof value === "string" && UUID.test(value)))];
  const clipIds = [
    ...new Set(rawClipIds.filter((value): value is string => typeof value === "string" && UUID.test(value))),
  ];

  if (ids.length === 0 && clipIds.length === 0) {
    return noStore({ error: "invalid_selection", message: "Select at least one report." }, 400);
  }
  if (ids.length > BULK_MAX || clipIds.length > BULK_MAX) {
    return noStore({ error: "invalid_selection", message: `Select at most ${BULK_MAX} reports.` }, 400);
  }
  if (ids.length > 0 && clipIds.length > 0) {
    return noStore({ error: "invalid_selection", message: "Send report ids or clip ids, not both." }, 400);
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 500) {
    return noStore({ error: "note_too_long", message: "Keep the note under 500 characters." }, 400);
  }

  const client = gate.client as unknown as RpcClient;
  let data: unknown;
  let error: { message?: string } | null;
  try {
    const result =
      clipIds.length > 0
        ? await client.rpc("community_resolve_clip_reports", { p_ids: clipIds, p_status: "dismissed" })
        : await client.rpc("community_dismiss_reports", { p_ids: ids, p_note: note || null });
    data = result.data;
    error = result.error;
  } catch (thrown) {
    error = { message: thrown instanceof Error ? thrown.message : "unknown" };
  }

  if (error) {
    const mapped = classifyReportError(error.message ?? "");
    if (mapped.status >= 500) console.error("[community] bulk dismiss failed", mapped.error);
    return noStore({ error: mapped.error, message: mapped.message }, mapped.status);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { dismissed?: number } | null;
  return noStore({ ok: true, dismissed: Number(row?.dismissed ?? 0) }, 200);
}
