// The feed loader used by every client-side load: a filter switch, "Load more",
// and the retry after a failed first paint. It is not the same code as the
// server page, so the two can disagree - and they did: the loader kept posts and
// announcements and threw away every comment row, which is why the Comments tab
// showed nothing while the RPC was returning comments all along.

import assert from "node:assert/strict";
import test from "node:test";

import { listFeedPage, type FeedItem } from "../queries";

const row = (kind: string, key: string): FeedItem =>
  ({ feed_key: key, kind, created_at: "2026-11-14T10:00:00.000Z" }) as unknown as FeedItem;

/** The smallest thing listFeedPage needs: an rpc() that answers like PostgREST. */
function fakeClient(rows: FeedItem[] | null, error: { message: string } | null = null) {
  return { rpc: async () => ({ data: error ? null : rows, error }) } as never;
}

test("comments are cards too: a client load keeps them", async () => {
  const rows = [
    row("post", "post:1"),
    row("comment", "comment:2"),
    row("announcement", "announcement:3"),
    row("comment", "comment:4"),
  ];
  const result = await listFeedPage(fakeClient(rows), { filter: "comment" });
  assert.equal(result.error, null);
  assert.deepEqual(result.data?.items.map((item) => item.feed_key), [
    "post:1",
    "comment:2",
    "announcement:3",
    "comment:4",
  ]);
});

test("the cursor is the last row returned, whatever its kind", async () => {
  const result = await listFeedPage(fakeClient([row("comment", "comment:9")]));
  assert.deepEqual(result.data?.cursor, { createdAt: "2026-11-14T10:00:00.000Z", key: "comment:9" });
});

test("rows without a kind are dropped, and an error is passed through", async () => {
  const junk = [{ feed_key: "x" }, ...[]] as unknown as FeedItem[];
  const clean = await listFeedPage(fakeClient([...junk, row("post", "post:1")]));
  assert.deepEqual(clean.data?.items.map((item) => item.feed_key), ["post:1"]);

  const failed = await listFeedPage(fakeClient(null, { message: "boom" }));
  assert.equal(failed.data, null);
  assert.ok(failed.error);
});

test("no client is an error, not an empty feed", async () => {
  const result = await listFeedPage(null);
  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unavailable");
});
