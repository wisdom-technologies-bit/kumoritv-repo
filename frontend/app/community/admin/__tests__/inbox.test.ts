// Phase 6, part B: the inbox's shared pieces.
//
// The SQL is covered by test-harness/phase6-sql-check.mjs (grouping, distinct
// reporters, keyset cursor, clip reports, counters). These are the TypeScript
// pieces: the cursor, the bulk route's clip path, and the guarantee that the
// admin area is never pulled into a normal visitor's bundle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { decodeCursor, encodeCursor } from "@/app/lib/community/admin-server";
import { POST as bulkDismiss } from "@/app/api/community/admin/reports/bulk/route";

const CLIP = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const REPORT = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const ROOT = path.resolve(__dirname, "../../../..");

const allowAll = { check: () => ({ allowed: true, retryAfterSeconds: 0 }) };

function gate(rpc?: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    gate: async () => ({
      ok: true as const,
      staff: { userId: "00000000-0000-4000-8000-0000000000ab", role: "moderator" as const },
      client: {
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          const result = (rpc?.(name, args) ?? {}) as { data?: unknown; error?: unknown };
          return { data: result.data ?? null, error: result.error ?? null };
        },
      } as never,
    }),
  };
}

function req(body: unknown) {
  return new Request("http://localhost/api/community/admin/reports/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the keyset cursor round-trips and refuses junk", () => {
  const cursor = { count: 3, latest: "2026-11-18T09:00:00.123456+00:00", id: REPORT };
  const encoded = encodeCursor(cursor);
  assert.deepEqual(decodeCursor(encoded), cursor);
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(""), null);
  assert.equal(decodeCursor("not-a-cursor"), null);
  assert.equal(decodeCursor("3~2026-11-18T09:00:00Z"), null);
  assert.equal(decodeCursor("nope~2026-11-18T09:00:00Z~abc"), null);
});

test("bulk dismiss: clip ids go to the clip function, and only clip ids", async () => {
  const { gate: g, calls } = gate(() => ({ data: [{ changed: 2, status: "dismissed" }] }));
  const ok = await bulkDismiss(req({ clipIds: [CLIP] }), undefined, { gate: g, limiter: allowAll });
  assert.equal(ok.status, 200);
  assert.equal(calls[0].name, "community_resolve_clip_reports");
  assert.deepEqual(calls[0].args.p_ids, [CLIP]);
  assert.equal(calls[0].args.p_status, "dismissed");

  const mixed = await bulkDismiss(req({ ids: [REPORT], clipIds: [CLIP] }), undefined, {
    gate: g,
    limiter: allowAll,
  });
  assert.equal(mixed.status, 400);

  const empty = await bulkDismiss(req({ ids: [], clipIds: [] }), undefined, { gate: g, limiter: allowAll });
  assert.equal(empty.status, 400);
});

test("the admin area is not reachable from the public feed's imports", () => {
  const files = [
    "app/community/components/PostCard.tsx",
    "app/community/components/FeedShell.tsx",
    "app/community/components/StaffRestoreButton.tsx",
    "app/community/page.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /from ["']@?\/?app\/community\/admin/, `${file} must not import the admin area`);
    assert.doesNotMatch(source, /admin\/components/, `${file} must not import admin components`);
  }
});
