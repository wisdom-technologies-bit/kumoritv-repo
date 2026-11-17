// Phase 4, part A1: the public latest endpoint.
//
// The reader, the clock and the limiter are injected, so this exercises the real
// handler (flag, cursor, ETag, 304, cache, adult stripping, 429) without a
// database. The SQL rules themselves are asserted in the SQL file's verification
// block and in the report.

import assert from "node:assert/strict";
import test from "node:test";
import { __clearLatestCache, handleLatest } from "@/app/api/community/latest/route";
import type { LatestRow } from "@/app/lib/community/latest";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, seconds)).toISOString();

function row(overrides: Partial<LatestRow> = {}): LatestRow {
  return {
    id: "post-1",
    kind: "post",
    created_at: at(10),
    author_id: "author-1",
    author_name: "Ada",
    author_avatar: "https://cdn/ada.png",
    text: "hello **world**",
    has_clip: false,
    clip_thumb: null,
    adult: false,
    href: "/community/post/post-1",
    ...overrides,
  };
}

function request(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/community/latest${query}`, { headers });
}

function allowAll() {
  return { check: () => ({ allowed: true, retryAfterSeconds: 0 }) };
}

function enableFlag(value: string) {
  process.env.COMMUNITY_ENABLED = value;
}

test.beforeEach(() => {
  enableFlag("1");
  __clearLatestCache();
});

test.after(() => {
  delete process.env.COMMUNITY_ENABLED;
});

test("with the flag off it answers 404 and never reads the database", async () => {
  enableFlag("");
  let reads = 0;
  const response = await handleLatest(request(), {
    reader: async () => {
      reads += 1;
      return [row()];
    },
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  assert.equal(response.status, 404);
  assert.equal(reads, 0);
  assert.equal(response.headers.get("cache-control"), "no-store");
  enableFlag("1");
});

test("200 carries the items, the newest cursor and an ETag", async () => {
  const response = await handleLatest(request("?limit=5"), {
    reader: async () => [row({ id: "a", created_at: at(10) }), row({ id: "b", created_at: at(12) })],
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("etag")), /^W\/"/);
  assert.equal(response.headers.get("cache-control"), "public, s-maxage=10, stale-while-revalidate=20");

  const body = (await response.json()) as { items: Array<Record<string, unknown>>; cursor: string };
  assert.equal(body.items.length, 2);
  assert.equal(body.cursor, at(12), "the cursor is the newest created_at");
  assert.deepEqual(Object.keys(body.items[0]).sort(), [
    "adult",
    "authorAvatar",
    "authorId",
    "authorName",
    "clipThumb",
    "createdAt",
    "hasClip",
    "href",
    "id",
    "kind",
    "text",
  ]);
  assert.equal(body.items[0].text, "hello world", "markdown is stripped on the way out");
});

test("a matching If-None-Match answers 304 with no body", async () => {
  const first = await handleLatest(request(), {
    reader: async () => [row()],
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  const etag = String(first.headers.get("etag"));
  await first.text();

  // A DIFFERENT cursor key so this is not served by the in-memory cache: the
  // 304 must also come from a fresh read.
  const second = await handleLatest(request("?limit=5", { "if-none-match": etag }), {
    reader: async () => [row()],
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");
  assert.equal(second.headers.get("etag"), etag);
});

test("the 10 s cache serves the same bytes without a second read", async () => {
  let reads = 0;
  const reader = async () => {
    reads += 1;
    return [row()];
  };
  const now = () => 1_000_000;

  await handleLatest(request(), { reader, limiter: allowAll(), ip: "1.1.1.1", now });
  await handleLatest(request(), { reader, limiter: allowAll(), ip: "2.2.2.2", now });
  assert.equal(reads, 1, "one read, shared by every viewer");
});

test("an adult item is generic, and the body is byte-identical for everyone", async () => {
  const reader = async () => [
    row({
      id: "adult-1",
      adult: true,
      text: "Hentai title",
      clip_thumb: "https://cdn/leak.jpg",
      author_avatar: "https://cdn/ada.png",
      has_clip: true,
    }),
  ];

  const first = await handleLatest(request(), { reader, limiter: allowAll(), ip: "1.1.1.1" });
  const firstBody = await first.text();
  const second = await handleLatest(request(), { reader, limiter: allowAll(), ip: "9.9.9.9" });
  const secondBody = await second.text();

  assert.equal(first.status, 200);
  assert.equal(firstBody, secondBody, "cached response is identical for every viewer");
  assert.equal(firstBody.includes("Hentai title"), false);
  assert.equal(firstBody.includes("leak.jpg"), false);
  assert.equal(firstBody.includes("ada.png"), false);

  const payload = JSON.parse(firstBody) as { items: Array<Record<string, unknown>> };
  assert.equal(payload.items[0].adult, true);
  assert.equal(payload.items[0].text, "New 18+ clip");
  assert.equal(payload.items[0].clipThumb, null);
  assert.equal(payload.items[0].authorAvatar, null);
});

test("rows without an id or a date are dropped, never rendered as blank", async () => {
  const response = await handleLatest(request(), {
    reader: async () => [row({ id: "" }), row({ id: "ok" })],
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  const payload = (await response.json()) as { items: Array<{ id: string }> };
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, "ok");
});

test("no new items answers the same cursor it was given", async () => {
  const response = await handleLatest(request(`?after=${encodeURIComponent(at(4))}`), {
    reader: async () => [],
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  const payload = (await response.json()) as { items: unknown[]; cursor: string };
  assert.deepEqual(payload.items, []);
  assert.equal(payload.cursor, at(4));
});

test("an invalid cursor is a 400, not a silent backlog", async () => {
  const response = await handleLatest(request("?after=yesterday"), {
    reader: async () => [row()],
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  assert.equal(response.status, 400);
});

test("limit is clamped to the contract's maximum of 5", async () => {
  let seen = -1;
  await handleLatest(request("?limit=50"), {
    reader: async ({ limit }) => {
      seen = limit;
      return [];
    },
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  assert.equal(seen, 5);
});

test("429 answers with Retry-After and reads nothing", async () => {
  let reads = 0;
  const response = await handleLatest(request(), {
    reader: async () => {
      reads += 1;
      return [row()];
    },
    limiter: { check: () => ({ allowed: false, retryAfterSeconds: 42 }) },
    ip: "1.1.1.1",
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(reads, 0);
});

test("a read failure is a 503 with no caching, not an empty 200", async () => {
  const response = await handleLatest(request(), {
    reader: async () => {
      throw new Error("boom");
    },
    limiter: allowAll(),
    ip: "1.1.1.1",
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
