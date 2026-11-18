// Phase 5: GET /api/clips, exercised through the real handler.
//
// The flag, the loader and the limiter are injected, so every branch is
// reachable without a database: 404 with the flag off, the response shape, the
// ETag/304 pair, the cache headers, the rate limit, and the outage that must not
// be cached. The SQL itself is the report's business, not this file's.

import assert from "node:assert/strict";
import test from "node:test";
import { BROWSE_CACHE, handleBrowse, type BrowseDeps } from "@/app/lib/clips/browse-handler";
import { createRateLimiter } from "@/app/lib/clips/rate-limit";
import type { BrowseItem } from "@/app/lib/clips/browse";
import type { BrowsePage } from "@/app/lib/clips/browse-server";

const item = (overrides: Partial<BrowseItem> = {}): BrowseItem => ({
  code: "k7m2p9q",
  anilistId: 21,
  animeTitle: "One Piece",
  episode: 4,
  start: 42,
  end: 57,
  durationSec: 15,
  views: 12400,
  createdAt: "2026-11-17T12:00:00.000Z",
  authorName: null,
  thumb: "/thumb/21/4",
  adult: false,
  ...overrides,
});

function deps(overrides: Partial<BrowseDeps> & { page?: BrowsePage } = {}): BrowseDeps {
  const page = overrides.page ?? { items: [item()], nextCursor: null, failed: false };
  return {
    enabled: () => true,
    load: async () => page,
    limiter: createRateLimiter({ windowMs: 60_000 }),
    ip: "203.0.113.7",
    ...overrides,
  };
}

const request = (query = "", headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/clips${query}`, { headers });

test("the flag off means the endpoint does not exist, and says nothing about why", async () => {
  const response = await handleBrowse(request(), deps({ enabled: () => false }));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("a page of clips comes back as {items, nextCursor} with a shared cache", async () => {
  let seen: unknown = null;
  const response = await handleBrowse(
    request("?sort=views&q=one+piece&anime=21&limit=10"),
    deps({
      load: async (query) => {
        seen = query;
        return { items: [item()], nextCursor: "cursor-1", failed: false };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), BROWSE_CACHE);
  assert.match(String(response.headers.get("cache-control")), /public/);
  assert.match(String(response.headers.get("cache-control")), /s-maxage=30/);
  assert.equal(response.headers.get("vary"), "accept-encoding");

  const body = (await response.json()) as { items: BrowseItem[]; nextCursor: string | null };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].code, "k7m2p9q");
  assert.equal(body.nextCursor, "cursor-1");

  // The parsed query reached the loader: no second, divergent reading of the URL.
  assert.deepEqual(seen, {
    sort: "views",
    anime: 21,
    q: "one piece",
    limit: 10,
    after: null,
  });
});

test("the adult rule is already applied by the loader; the route never re-adds fields", async () => {
  const response = await handleBrowse(
    request(),
    deps({
      page: {
        items: [item({ adult: true, animeTitle: null, thumb: null, episode: null, start: null, end: null, durationSec: null, authorName: null })],
        nextCursor: null,
        failed: false,
      },
    }),
  );
  const body = (await response.json()) as { items: BrowseItem[] };
  const adult = body.items[0];
  assert.equal(adult.adult, true);
  assert.equal(adult.animeTitle, null);
  assert.equal(adult.thumb, null);
  assert.equal(adult.authorName, null);
});

test("a repeat request with the same ETag is a 304 with no body", async () => {
  const subject = deps();
  const first = await handleBrowse(request(), subject);
  const etag = String(first.headers.get("etag"));
  assert.ok(etag.startsWith('W/"'));

  const second = await handleBrowse(request("", { "if-none-match": etag }), subject);
  assert.equal(second.status, 304);
  assert.equal(second.headers.get("etag"), etag);
  assert.equal(second.headers.get("cache-control"), BROWSE_CACHE);
  assert.equal(await second.text(), "");
});

test("a page whose contents changed gets a new ETag and a full body", async () => {
  const first = await handleBrowse(request(), deps());
  const etag = String(first.headers.get("etag"));

  const changed = await handleBrowse(
    request("", { "if-none-match": etag }),
    deps({ page: { items: [item({ views: 1 })], nextCursor: null, failed: false } }),
  );
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
});

test("a database outage is a 503 that is never cached", async () => {
  const response = await handleBrowse(
    request(),
    deps({ page: { items: [], nextCursor: null, failed: true } }),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "unavailable" });
});

test("60 pages a minute per IP, then 429 with retry-after and no caching", async () => {
  const limiter = createRateLimiter({ windowMs: 60_000 });
  const subject = deps({ limiter });
  let last = await handleBrowse(request(), subject);
  for (let index = 1; index < 60; index += 1) {
    last = await handleBrowse(request(), subject);
    assert.equal(last.status, 200, `request ${index + 1} should be allowed`);
  }

  const limited = await handleBrowse(request(), subject);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  const retryAfter = Number(limited.headers.get("retry-after"));
  assert.ok(Number.isInteger(retryAfter) && retryAfter > 0);
  assert.equal((await limited.json()).error, "rate_limited");
});

test("the limiter is keyed per IP, so one busy client cannot silence another", async () => {
  const limiter = createRateLimiter({ windowMs: 60_000 });
  const busy = deps({ limiter, ip: "203.0.113.7", rate: 1 });
  assert.equal((await handleBrowse(request(), busy)).status, 200);
  assert.equal((await handleBrowse(request(), busy)).status, 429);

  const other = deps({ limiter, ip: "198.51.100.9", rate: 1 });
  assert.equal((await handleBrowse(request(), other)).status, 200);
});

test("an empty result is a valid, cacheable page, not an error", async () => {
  const response = await handleBrowse(
    request("?q=zzzzzz"),
    deps({ page: { items: [], nextCursor: null, failed: false } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), BROWSE_CACHE);
  assert.deepEqual(await response.json(), { items: [], nextCursor: null });
});
