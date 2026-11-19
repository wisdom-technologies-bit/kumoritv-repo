// POST /api/community/admin/reports/[id] - resolve or dismiss one report.
//
// Body: { status: "actioned" | "dismissed", note?: string }
//
// The write goes through public.community_resolve_report(), which checks
// is_staff() itself and refuses to overwrite a decision somebody else already
// made. A report that is no longer open comes back as 409 with its current
// state rather than being silently re-decided.
import { classifyReportError } from "@/app/lib/community/moderation";
import { MODERATION_PER_MINUTE, moderationLimiter } from "@/app/lib/community/rate-limit";
import { requireStaffSession, type StaffGate } from "@/app/lib/community/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type ReportDeps = {
  gate?: () => Promise<StaffGate>;
  limiter?: { check: (key: string, limit: number, now?: number) => { allowed: boolean; retryAfterSeconds: number } };
};

function noStore(body: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...(extra ?? {}) } });
}

export async function POST(
  request: Request,
  context: { params: { id: string } },
  deps: ReportDeps = {},
): Promise<Response> {
  const gate = await (deps.gate ?? requireStaffSession)();
  if (!gate.ok) return gate.response;

  const id = context?.params?.id ?? "";
  if (!UUID.test(id)) return noStore({ error: "not_found", message: "That report no longer exists." }, 404);

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
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (status !== "actioned" && status !== "dismissed") {
    return noStore({ error: "invalid_status", message: "Choose to action or dismiss the report." }, 400);
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 500) {
    return noStore({ error: "note_too_long", message: "Keep the note under 500 characters." }, 400);
  }

  const client = gate.client as unknown as RpcClient;
  let data: unknown;
  let error: { message?: string } | null;
  try {
    const result = await client.rpc("community_resolve_report", {
      p_id: id,
      p_status: status,
      p_note: note || null,
    });
    data = result.data;
    error = result.error;
  } catch (thrown) {
    error = { message: thrown instanceof Error ? thrown.message : "unknown" };
  }

  if (error) {
    const mapped = classifyReportError(error.message ?? "");
    if (mapped.status >= 500) console.error("[community] report resolve failed", mapped.error);
    return noStore({ error: mapped.error, message: mapped.message }, mapped.status);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { changed?: boolean; status?: string } | null;
  if (!row || typeof row.changed !== "boolean") {
    return noStore({ error: "report_failed", message: "That report could not be updated." }, 500);
  }
  if (!row.changed) {
    return noStore(
      { error: "stale_action", message: "That report was already decided.", status: row.status ?? null },
      409,
    );
  }

  return noStore({ ok: true, status: row.status ?? status }, 200);
}
