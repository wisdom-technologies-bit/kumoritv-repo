// Phase 4, part B2: the admin announcement API.
//
// The gate is injected (the real one reads cookies and calls is_admin()), so
// every branch is reachable without a database: auth, validation, idempotency,
// rate limit, edit and delete. What is NOT simulated: the real RLS decision -
// that is the SQL file's job and is called out in the report.

import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "@/app/api/community/admin/announcements/route";
import { DELETE, PATCH } from "@/app/api/community/admin/announcements/[id]/route";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000d4";

type Row = Record<string, unknown>;

function fakeClient(options: { insertError?: { code?: string }; existingId?: string | null; resultId?: string | null } = {}) {
  const inserted: Row[] = [];
  const updated: Row[] = [];
  const deleted: string[] = [];

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID }, }, }) },
    rpc: async () => ({ data: true, error: null }),
    from: (_table: "announcements") => ({
      insert: (row: Row) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: options.insertError ? null : { id: options.resultId ?? ID },
              error: options.insertError ?? null,
            }),
          }),
        };
      },
      select: () => ({
        eq: (_column: string, _value: string) => ({
          maybeSingle: async () => ({
            data: options.existingId ? { id: options.existingId } : null,
            error: null,
          }),
        }),
      }),
      update: (values: Row) => {
        updated.push(values);
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: ID }, error: null }),
            }),
          }),
        };
      },
      delete: () => ({
        eq: (_column: string, value: string) => {
          deleted.push(value);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: value }, error: null }),
            }),
          };
        },
      }),
    }),
  };

  return { client, inserted, updated, deleted };
}

const allowAll = { check: () => ({ allowed: true, retryAfterSeconds: 0 }) };

function gateWith(client: unknown) {
  return async () => ({ ok: true as const, client: client as never, adminId: ADMIN_ID });
}

function request(body: unknown, method = "POST", url = "http://localhost/api/community/admin/announcements") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const valid = {
  title: "Service Update: KumoriTV Is Back Online!",
  body: "# We are back\n\n**Thank you** for staying with us.",
  image: null,
  url: null,
  expiresAt: null,
  sendPush: true,
  idempotencyKey: ID,
};

test("with the flag off the route 404s before any client is built", async () => {
  delete process.env.COMMUNITY_ENABLED;
  const response = await POST(request(valid));
  assert.equal(response.status, 404);
});

test("anonymous is 401", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const response = await POST(request(valid), {
    gate: async () => ({
      ok: false as const,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    }),
  });
  assert.equal(response.status, 401);
  delete process.env.COMMUNITY_ENABLED;
});

test("a signed-in non-admin gets 404, not 403", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const response = await POST(request(valid), {
    gate: async () => ({
      ok: false as const,
      response: Response.json({ error: "not_found" }, { status: 404 }),
    }),
  });
  assert.equal(response.status, 404);
  delete process.env.COMMUNITY_ENABLED;
});

test("validation errors name the field", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client } = fakeClient();
  const response = await POST(request({ ...valid, title: "" }), {
    gate: gateWith(client),
    limiter: allowAll,
  });
  assert.equal(response.status, 400);
  const payload = (await response.json()) as { field: string; message: string };
  assert.equal(payload.field, "title");
  delete process.env.COMMUNITY_ENABLED;
});

test("an unknown field is rejected", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client } = fakeClient();
  const response = await POST(request({ ...valid, pinned: true }), {
    gate: gateWith(client),
    limiter: allowAll,
  });
  assert.equal(response.status, 400);
  delete process.env.COMMUNITY_ENABLED;
});

test("create writes created_by, stamps updated_at and leaves push pending", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client, inserted } = fakeClient({ resultId: ID });
  const response = await POST(request(valid), { gate: gateWith(client), limiter: allowAll });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: ID });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].created_by, ADMIN_ID);
  assert.equal(inserted[0].push_sent_at, null);
  assert.equal(inserted[0].idempotency_key, ID);
  assert.ok(inserted[0].updated_at);
  delete process.env.COMMUNITY_ENABLED;
});

test("sendPush off sets push_sent_at so the cron skips it", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client, inserted } = fakeClient();
  await POST(request({ ...valid, sendPush: false }), { gate: gateWith(client), limiter: allowAll });
  assert.equal(typeof inserted[0].push_sent_at, "string");
  delete process.env.COMMUNITY_ENABLED;
});

test("a repeated idempotency key returns the first row instead of a second", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client } = fakeClient({ insertError: { code: "23505" }, existingId: ID });
  const response = await POST(request(valid), { gate: gateWith(client), limiter: allowAll });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: ID, deduped: true });
  delete process.env.COMMUNITY_ENABLED;
});

test("a write failure is a 500 with no internals", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client } = fakeClient({ insertError: { code: "42501" } });
  const response = await POST(request(valid), { gate: gateWith(client), limiter: allowAll });
  assert.equal(response.status, 500);
  const payload = (await response.json()) as { message?: string };
  assert.equal(payload.message, "The announcement could not be saved.");
  assert.equal(JSON.stringify(payload).includes("42501"), false);
  delete process.env.COMMUNITY_ENABLED;
});

test("the admin write limit is a 429 with Retry-After", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client } = fakeClient();
  const response = await POST(request(valid), {
    gate: gateWith(client),
    limiter: { check: () => ({ allowed: false, retryAfterSeconds: 30 }) },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  delete process.env.COMMUNITY_ENABLED;
});

test("a patch never touches push_sent_at", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client, updated } = fakeClient();
  const response = await PATCH(request({ ...valid, sendPush: true }, "PATCH"), { params: { id: ID } }, {
    gate: gateWith(client),
    limiter: allowAll,
  });
  assert.equal(response.status, 200);
  assert.equal(updated.length, 1);
  assert.equal("push_sent_at" in updated[0], false, "an edit must not resend the push");
  assert.ok(updated[0].updated_at);
  delete process.env.COMMUNITY_ENABLED;
});

test("a patch with an invalid id is a 404", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client } = fakeClient();
  const response = await PATCH(request(valid, "PATCH"), { params: { id: "not-a-uuid" } }, {
    gate: gateWith(client),
    limiter: allowAll,
  });
  assert.equal(response.status, 404);
  delete process.env.COMMUNITY_ENABLED;
});

test("delete removes the row by id", async () => {
  process.env.COMMUNITY_ENABLED = "1";
  const { client, deleted } = fakeClient();
  const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: ID } }, {
    gate: gateWith(client),
    limiter: allowAll,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(deleted, [ID]);
  delete process.env.COMMUNITY_ENABLED;
});
