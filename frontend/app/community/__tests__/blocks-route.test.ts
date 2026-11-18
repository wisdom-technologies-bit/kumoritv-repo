// Part C: the blocks route's own rules.
//
// The database side (threads filtered per viewer, notifications suppressed) is
// proved in test-harness/phase6-sql-check.mjs. Here: auth, self, staff targets,
// the shape of the list, and that a bad id never reaches the database.
import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.COMMUNITY_ENABLED = "true";

const TARGET = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

type Row = { blocked_id: string; created_at: string };

function session(userId: string | null, blocks: Row[] = []) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      api.select = () => api;
      api.eq = () => api;
      api.in = () => Promise.resolve({ data: [], error: null });
      api.order = () => api;
      api.limit = () =>
        table === "community_blocks"
          ? Promise.resolve({ data: blocks, error: null })
          : Promise.resolve({ data: [], error: null });
      api.upsert = (payload: unknown) => {
        calls.push({ table, op: "upsert", payload });
        return Promise.resolve({ error: null });
      };
      api.delete = () => {
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.then = (resolve: (value: { error: null }) => void) => {
          calls.push({ table, op: "delete" });
          resolve({ error: null });
        };
        return chain;
      };
      return api;
    },
  };
  return { client, calls };
}

function admin(role: string | null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }) }),
    }),
  };
}

async function load(options: { user: string | null; role?: string | null; blocks?: Row[] }) {
  const mod = await import("@/app/api/community/blocks/route");
  const s = session(options.user, options.blocks ?? []);
  const deps = { sessionClient: s.client as never, adminClient: admin(options.role ?? null) as never };
  return { mod, calls: s.calls, deps };
}

function post(body: unknown) {
  return new Request("http://localhost/api/community/blocks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("blocking needs a session", async () => {
  const { mod, deps } = await load({ user: null });
  const response = await mod.POST(post({ userId: TARGET, action: "block" }), deps);
  assert.equal(response.status, 401);
});

test("you cannot block yourself", async () => {
  const { mod, deps } = await load({ user: TARGET });
  const response = await mod.POST(post({ userId: TARGET, action: "block" }), deps);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "self_block");
});

test("you cannot block a moderator, and the message says what to do instead", async () => {
  const { mod, deps, calls } = await load({ user: "me", role: "moderator" });
  const response = await mod.POST(post({ userId: TARGET, action: "block" }), deps);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "staff_target");
  assert.match(body.message, /Report/);
  assert.equal(calls.length, 0, "nothing was written");
});

test("a block is one upsert on the viewer's own row", async () => {
  const { mod, deps, calls } = await load({ user: "me" });
  const response = await mod.POST(post({ userId: TARGET, action: "block" }), deps);
  assert.equal(response.status, 200);
  assert.equal(calls[0].table, "community_blocks");
  assert.deepEqual(calls[0].payload, { blocker_id: "me", blocked_id: TARGET });
});

test("unblock deletes the row, and a bad id never reaches the database", async () => {
  const { mod, deps, calls } = await load({ user: "me" });
  const ok = await mod.POST(post({ userId: TARGET, action: "unblock" }), deps);
  assert.equal(ok.status, 200);
  assert.equal(calls[0].op, "delete");

  const bad = await mod.POST(post({ userId: "not-a-uuid", action: "block" }), deps);
  assert.equal(bad.status, 400);
});

test("the list only ever names people, never emails", async () => {
  const { mod, deps } = await load({
    user: "me",
    blocks: [{ blocked_id: TARGET, created_at: "2026-11-18T10:00:00Z" }],
  });
  const response = await mod.GET(undefined, deps);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).blocked, [{ id: TARGET, name: "member" }]);
});
