// Phase 6, part F: account deletion coverage.
//
// The plan's test list asks for one thing here: deletion removes posts, reactions
// and blocks, and nulls the reporter. The reporter null is the database's job
// (ON DELETE SET NULL) and is asserted in the SQL harness; this file proves the
// list, the order, and that nothing that fails can leave an account undeletable.
import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMUNITY_TABLES,
  CONTENT_TABLES,
  PERSONAL_TABLES,
  deleteAccount,
  type DeletionDeps,
} from "@/app/lib/account/deletion";
import { pushIdentityConfigured, removeOneSignalIdentity } from "@/app/lib/push/identity";

const USER = "11111111-1111-4111-8111-111111111111";

function harness(overrides: Partial<DeletionDeps> = {}) {
  const calls: string[] = [];
  const deleted: Array<[string, string]> = [];
  const deps: DeletionDeps = {
    userId: USER,
    anonymiseComments: async () => {
      calls.push("anonymise");
      return { error: null };
    },
    deleteWhere: async (table, column) => {
      calls.push(`${table}.${column}`);
      deleted.push([table, column]);
      return { error: null };
    },
    removePushIdentity: async () => {
      calls.push("push");
      return { ok: true, status: 200 };
    },
    deleteAuthUser: async () => {
      calls.push("auth");
      return { error: null };
    },
    ...overrides,
  };
  return { deps, calls, deleted };
}

test("every Phase 6 table is in the list, in both directions for blocks", () => {
  const tables = [...PERSONAL_TABLES, ...COMMUNITY_TABLES, ...CONTENT_TABLES].map((entry) => `${entry.table}.${entry.column}`);
  for (const expected of [
    "community_posts.author_id",
    "community_reactions.user_id",
    "community_blocks.blocker_id",
    "community_blocks.blocked_id",
    "staff_roles.user_id",
    "comment_reactions.user_id",
    "clips.user_id",
  ]) {
    assert.ok(tables.includes(expected), `missing ${expected}`);
  }
});

test("comments are anonymised first, the auth user is deleted last", async () => {
  const { deps, calls } = harness();
  const report = await deleteAccount(deps);

  assert.equal(report.ok, true);
  assert.equal(calls[0], "anonymise", "the anonymiser needs the rows to still exist");
  assert.equal(calls[calls.length - 1], "auth", "the point of no return is last");
  assert.ok(calls.indexOf("push") < calls.indexOf("auth"), "the push identity goes while the id still means something");
});

test("a table that fails does not stop the deletion", async () => {
  const { deps } = harness({
    deleteWhere: async (table) => {
      if (table === "community_blocks") return { error: { message: "relation does not exist" } };
      return { error: null };
    },
  });
  const report = await deleteAccount(deps);

  assert.equal(report.ok, true);
  assert.deepEqual(report.failedTables, ["community_blocks", "community_blocks"]);
});

test("an anonymiser failure is reported but never blocks the auth delete", async () => {
  const { deps, calls } = harness({
    anonymiseComments: async () => {
      throw new Error("function does not exist");
    },
  });
  const report = await deleteAccount(deps);

  assert.equal(report.ok, true);
  assert.ok(calls.includes("auth"));
});

test("a push provider failure leaves the deletion successful", async () => {
  const { deps } = harness({
    removePushIdentity: async () => ({ ok: false, status: 503 }),
  });
  const report = await deleteAccount(deps);

  assert.equal(report.ok, true);
  assert.equal(report.pushRemoved, false);
});

test("only the auth delete failing makes the deletion fail", async () => {
  const { deps } = harness({
    deleteAuthUser: async () => ({ error: { message: "nope" } }),
  });
  const report = await deleteAccount(deps);

  assert.equal(report.ok, false);
  assert.equal(report.failedStep, "auth");
});

test("OneSignal is unconfigured without both env values", async () => {
  assert.equal(pushIdentityConfigured({}), false);
  assert.equal(pushIdentityConfigured({ NEXT_PUBLIC_ONESIGNAL_APP_ID: "app" }), false);
  assert.equal(pushIdentityConfigured({ NEXT_PUBLIC_ONESIGNAL_APP_ID: "app", ONESIGNAL_REST_API_KEY: "key" }), true);

  const result = await removeOneSignalIdentity(USER, { env: {} });
  assert.deepEqual(result, { ok: false, skipped: true });
});

test("the push identity is deleted by external_id, with the key only in the header", async () => {
  const seen: Array<{ url: string; method?: string; auth?: string }> = [];
  const result = await removeOneSignalIdentity(USER, {
    env: { NEXT_PUBLIC_ONESIGNAL_APP_ID: "app-1", ONESIGNAL_REST_API_KEY: "secret-key" },
    fetchImpl: (async (url: string, init: RequestInit) => {
      seen.push({
        url: String(url),
        method: init.method,
        auth: (init.headers as Record<string, string>).Authorization,
      });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch,
  });

  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/apps\/app-1\/users\/by\/external_id\/11111111-1111-4111-8111-111111111111$/);
  assert.equal(seen[0].method, "DELETE");
  assert.equal(seen[0].auth, "Key secret-key");
});

test("a missing subscription is the same outcome as a removal", async () => {
  const result = await removeOneSignalIdentity(USER, {
    env: { NEXT_PUBLIC_ONESIGNAL_APP_ID: "app-1", ONESIGNAL_REST_API_KEY: "secret-key" },
    fetchImpl: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
  });
  assert.equal(result.ok, true);
});

test("a network failure is reported, not thrown", async () => {
  const result = await removeOneSignalIdentity(USER, {
    env: { NEXT_PUBLIC_ONESIGNAL_APP_ID: "app-1", ONESIGNAL_REST_API_KEY: "secret-key" },
    fetchImpl: (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch,
  });
  assert.equal(result.ok, false);
});
