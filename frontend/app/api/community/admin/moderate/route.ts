// POST /api/community/admin/moderate
//
// Phase 6, part A. One route, one database function: the route never touches a
// content table directly. public.community_moderate() checks is_staff() itself,
// changes one row, writes exactly one log row and resolves the target's open
// reports - all in one transaction. If the row is already in the requested
// state the function logs nothing and this route answers 409 with the current
// state, so a double click or a second moderator is told what happened instead
// of silently "succeeding".
//
// Session first, then the role, then a 60/min per-staff limit, then validation.
// Everything runs with the caller's own session: no service role.
import {
  classifyModerationError,
  validateModerationInput,
  type ModerationAction,
  type ModerationKind,
  type ModerationState,
} from "@/app/lib/community/moderation";
import { MODERATION_PER_MINUTE, moderationLimiter } from "@/app/lib/community/rate-limit";
import { requireStaffSession, type StaffGate } from "@/app/lib/community/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type ModerateResult = {
  changed: boolean;
  status: ModerationState;
  previous: ModerationState;
  log_id: number | null;
  reports_actioned: number;
};

export type ModerateDeps = {
  /** Tests only: the real gate reads cookies and calls is_staff(). */
  gate?: () => Promise<StaffGate>;
  limiter?: { check: (key: string, limit: number, now?: number) => { allowed: boolean; retryAfterSeconds: number } };
};

function noStore(body: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...(extra ?? {}) } });
}

export async function POST(request: Request, _context?: unknown, deps: ModerateDeps = {}): Promise<Response> {
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
  const parsed = validateModerationInput(raw);
  if (!parsed.ok) return noStore({ error: parsed.error, message: parsed.message }, 400);

  const input = parsed.value;
  const client = gate.client as unknown as RpcClient;

  let data: unknown;
  let error: { message?: string } | null;
  try {
    const result = await client.rpc("community_moderate", {
      p_kind: input.kind,
      p_id: input.id,
      p_action: input.action,
      p_reason: input.reason,
    });
    data = result.data;
    error = result.error;
  } catch (thrown) {
    error = { message: thrown instanceof Error ? thrown.message : "unknown" };
  }

  if (error) {
    const mapped = classifyModerationError(error.message ?? "");
    // The reason itself is never logged here; the database keeps it in the
    // moderation log, which is the only place it belongs.
    if (mapped.status >= 500) console.error("[community] moderate failed", mapped.error);
    return noStore({ error: mapped.error, message: mapped.message }, mapped.status);
  }

  const row = (Array.isArray(data) ? data[0] : data) as Partial<ModerateResult> | null;
  if (!row || typeof row.changed !== "boolean") {
    return noStore({ error: "moderation_failed", message: "The change could not be saved." }, 500);
  }

  if (!row.changed) {
    return noStore(
      {
        error: "stale_action",
        message: "That content is already in this state.",
        status: (row.status as ModerationState) ?? "published",
      },
      409,
    );
  }

  return noStore({
    ok: true,
    status: row.status as ModerationState,
    previous: row.previous as ModerationState,
    log_id: row.log_id ?? null,
    reports_actioned: Number(row.reports_actioned ?? 0),
    kind: input.kind as ModerationKind,
    action: input.action as ModerationAction,
    id: input.id,
  }, 200);
}
