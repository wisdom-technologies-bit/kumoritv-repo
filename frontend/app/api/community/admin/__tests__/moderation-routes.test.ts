// Phase 6, part A: the moderation routes.
//
// The gate and the rate limiter are injected (the real ones read cookies and
// call is_staff()/is_admin()), so every branch is reachable without a database.
// What is NOT simulated here: the database function's own role check and the
// single-log-row rule - that is test-harness/phase6-sql-check.mjs, which runs
// the real SQL in PGlite.
import assert from "node:assert/strict";
import test from "node:test";
import { POST as moderate } from "@/app/api/community/admin/moderate/route";
import { POST as resolveReport } from "@/app/api/community/admin/reports/[id]/route";
import { POST as bulkDismiss } from "@/app/api/community/admin/reports/bulk/route";

const POST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const REPORT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const STAFF_ID = "00000000-0000-4000-8000-0000000000d6";

const allowAll = { check: () => ({ allowed: true, retryAfterSeconds: 0 }) };
const denyAll = { check: () => ({ allowed: false, retryAfterSeconds: 30 }) };

function gate(role: "moderator" | "admin" = "admin", rpc?: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (rpc) {
        const result = rpc(name, args) as { data?: unknown; error?: { message?: string } | null };
        return { data: result?.data ?? null, error: result?.error ?? null };
      }
      return { data: null, error: null };
    },
  };
  return {
    calls,
    gate: async () => ({ ok: true as const, client: client as never, staff: { userId: STAFF_ID, role } }),
  };
}

function req(body: unknown, url = "http://localhost/api/community/admin/moderate") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------- the gate

test("moderate: anonymous and non-staff are refused before anything runs", async () => {
  const unauthorised = await moderate(req({ kind: "post", id: POST_ID, action: "hide" }), undefined, {
    gate: async () => ({ ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) }),
  });
  assert.equal(unauthorised.status, 401);

  const notStaff = await moderate(req({ kind: "post", id: POST_ID, action: "hide" }), undefined, {
    gate: async () => ({ ok: false, response: Response.json({ error: "not_found" }, { status: 404 }) }),
  });
  assert.equal(notStaff.status, 404);
});

test("moderate: no-store on every answer", async () => {
  const { gate: g } = gate();
  const response = await moderate(req({ kind: "post", id: POST_ID, action: "remove" }), undefined, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

// ---------------------------------------------------------- input validation

test("moderate: validates kind, id and action", async () => {
  const { gate: g, calls } = gate();
  for (const body of [
    { kind: "user", id: POST_ID, action: "hide" },
    { kind: "post", id: "not-a-uuid", action: "hide" },
    { kind: "post", id: POST_ID, action: "delete" },
    {},
  ]) {
    const response = await moderate(req(body), undefined, { gate: g, limiter: allowAll });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0, "nothing reaches the database when the body is invalid");
});

test("moderate: remove needs a reason of 3-300 characters", async () => {
  const { gate: g, calls } = gate(undefined, () => ({
    data: { changed: true, status: "removed", previous: "published", log_id: 7, reports_actioned: 1 },
  }));
  const short = await moderate(req({ kind: "post", id: POST_ID, action: "remove", reason: "a" }), undefined, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(short.status, 400);
  assert.equal((await short.json()).error, "reason_required");

  const long = await moderate(
    req({ kind: "post", id: POST_ID, action: "remove", reason: "x".repeat(301) }),
    undefined,
    { gate: g, limiter: allowAll },
  );
  assert.equal(long.status, 400);

  const ok = await moderate(
    req({ kind: "post", id: POST_ID, action: "remove", reason: "spam" }),
    undefined,
    { gate: g, limiter: allowAll },
  );
  assert.equal(ok.status, 200);
  assert.equal(calls[0].args.p_reason, "spam");
  assert.equal(calls[0].name, "community_moderate");
});

test("moderate: hide does not need a reason and sends null", async () => {
  const { gate: g, calls } = gate(undefined, () => ({
    data: { changed: true, status: "hidden", previous: "published", log_id: 12, reports_actioned: 2 },
  }));
  const response = await moderate(req({ kind: "comment", id: POST_ID, action: "hide" }), undefined, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].args.p_kind, "comment");
  assert.equal(calls[0].args.p_reason, null);
  const body = await response.json();
  assert.equal(body.status, "hidden");
  assert.equal(body.log_id, 12);
  assert.equal(body.reports_actioned, 2);
});

// ------------------------------------------------------------- the outcomes

test("moderate: a no-op is 409 with the current state, never a fake success", async () => {
  const { gate: g } = gate(undefined, () => ({
    data: { changed: false, status: "removed", previous: "removed", log_id: null, reports_actioned: 0 },
  }));
  const response = await moderate(req({ kind: "post", id: POST_ID, action: "remove", reason: "spam" }), undefined, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, "stale_action");
  assert.equal(body.status, "removed");
});

test("moderate: database codes map to typed answers instead of 500s", async () => {
  const notStaff = gate(undefined, () => ({ error: { message: "community_moderate:not_staff" } }));
  const a = await moderate(req({ kind: "post", id: POST_ID, action: "hide" }), undefined, {
    gate: notStaff.gate,
    limiter: allowAll,
  });
  assert.equal(a.status, 403);

  const gone = gate(undefined, () => ({ error: { message: "community_moderate:not_found" } }));
  const b = await moderate(req({ kind: "post", id: POST_ID, action: "hide" }), undefined, {
    gate: gone.gate,
    limiter: allowAll,
  });
  assert.equal(b.status, 404);

  const boom = gate(undefined, () => ({ error: { message: "connection reset by peer" } }));
  const c = await moderate(req({ kind: "post", id: POST_ID, action: "hide" }), undefined, {
    gate: boom.gate,
    limiter: allowAll,
  });
  assert.equal(c.status, 500);
  assert.equal((await c.json()).error, "moderation_failed");
});

test("moderate: 60 a minute per staff member", async () => {
  const { gate: g, calls } = gate();
  const response = await moderate(req({ kind: "post", id: POST_ID, action: "hide" }), undefined, {
    gate: g,
    limiter: denyAll,
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(calls.length, 0);
});

// ------------------------------------------------------------- report routes

test("reports/[id]: staff only, validated, and 409 once already decided", async () => {
  const anonymous = await resolveReport(req({ status: "actioned" }, "http://x/1"), { params: { id: REPORT_ID } }, {
    gate: async () => ({ ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) }),
  });
  assert.equal(anonymous.status, 401);

  const { gate: g, calls } = gate("moderator", () => ({ data: { changed: true, status: "dismissed" } }));
  const bad = await resolveReport(req({ status: "deleted" }, "http://x/1"), { params: { id: REPORT_ID } }, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(bad.status, 400);

  const longNote = await resolveReport(
    req({ status: "dismissed", note: "x".repeat(501) }, "http://x/1"),
    { params: { id: REPORT_ID } },
    { gate: g, limiter: allowAll },
  );
  assert.equal(longNote.status, 400);

  const ok = await resolveReport(req({ status: "dismissed", note: "not a rule" }, "http://x/1"), { params: { id: REPORT_ID } }, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(ok.status, 200);
  assert.equal(calls[0].name, "community_resolve_report");
  assert.equal(calls[0].args.p_status, "dismissed");
  assert.equal(calls[0].args.p_note, "not a rule");

  const { gate: g2 } = gate("moderator", () => ({ data: { changed: false, status: "actioned" } }));
  const stale = await resolveReport(req({ status: "dismissed" }, "http://x/1"), { params: { id: REPORT_ID } }, {
    gate: g2,
    limiter: allowAll,
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).status, "actioned");
});

test("reports/[id]: a bad id is a 404, not a database error", async () => {
  const { gate: g } = gate();
  const response = await resolveReport(req({ status: "actioned" }, "http://x/1"), { params: { id: "nope" } }, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(response.status, 404);
});

test("reports/bulk: 1..50 ids, de-duplicated, dismissed in one call", async () => {
  const { gate: g, calls } = gate("moderator", () => ({ data: { changed: true, dismissed: 2 } }));

  const empty = await bulkDismiss(req({ ids: [] }), undefined, { gate: g, limiter: allowAll });
  assert.equal(empty.status, 400);

  const tooMany = await bulkDismiss(
    req({ ids: Array.from({ length: 51 }, (_, index) => `3f2504e0-4f89-41d3-9a0c-0305e82c${String(index).padStart(4, "0")}`) }),
    undefined,
    { gate: g, limiter: allowAll },
  );
  assert.equal(tooMany.status, 400);

  const duplicate = await bulkDismiss(
    req({ ids: [REPORT_ID, REPORT_ID, "not-a-uuid"] }),
    undefined,
    { gate: g, limiter: allowAll },
  );
  assert.equal(duplicate.status, 200);
  assert.equal(calls[0].name, "community_dismiss_reports");
  assert.deepEqual(calls[0].args.p_ids, [REPORT_ID]);
  assert.equal((await duplicate.json()).dismissed, 2);
});

test("reports/bulk: a non-staff caller gets the gate's answer and nothing is written", async () => {
  const { gate: g, calls } = gate();
  const response = await bulkDismiss(req({ ids: [REPORT_ID] }), undefined, {
    gate: async () => ({ ok: false, response: Response.json({ error: "not_found" }, { status: 404 }) }),
    limiter: allowAll,
  });
  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
  assert.equal(g.constructor.name, "AsyncFunction"); // the injected gate is not used at all
});
