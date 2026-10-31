import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMENTS_JSONLD_LIMIT,
  countPageComments,
  readCommentSummary,
  readTopComments,
} from "../comments-jsonld";
import { buildMediaJsonLd, buildWatchJsonLd, serializeJsonLd } from "../jsonld";

const SITE = "https://kumoritv.top";

/**
 * Minimal PostgREST-ish double: it only models the two reads this module makes
 * (an exact head count and an ordered page).
 */
function fakeClient(options: {
  rows?: unknown[];
  count?: number;
  error?: { message: string } | null;
  onOrder?: () => void;
}) {
  const calls: string[] = [];

  const builder = () => {
    const state: Record<string, unknown> = {};
    const api = {
      select(_columns: string, selectOptions?: { count?: string; head?: boolean }) {
        state.head = selectOptions?.head ?? false;
        state.wantCount = selectOptions?.count;
        return api;
      },
      eq(column: string, value: unknown) {
        state[column] = value;
        return api;
      },
      is(column: string, value: unknown) {
        state[`is:${column}`] = value;
        return api;
      },
      order(column: string, opts: unknown) {
        state[`order:${column}`] = opts;
        options.onOrder?.();
        return api;
      },
      limit(value: number) {
        state.limit = value;
        return api;
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        calls.push(JSON.stringify(state));
        if (options.error) return Promise.resolve({ data: null, error: options.error, count: null }).then(resolve, reject);
        if (state.head) {
          return Promise.resolve({ data: null, error: null, count: options.count ?? 0 }).then(resolve, reject);
        }
        return Promise.resolve({ data: options.rows ?? [], error: null, count: null }).then(resolve, reject);
      },
    };
    return api;
  };

  return {
    calls,
    client: { from: (table: string) => (calls.push(`from:${table}`), builder()) },
  };
}

const row = (over: Record<string, unknown> = {}) => ({
  body: "Great episode!",
  created_at: "2025-02-01T12:00:00.000Z",
  is_spoiler: false,
  username: "luffy",
  display_name: "Monkey D. Luffy",
  likes: 12,
  ...over,
});

test("the summary reads the public comment_feed view", async () => {
  const fake = fakeClient({ rows: [row()], count: 7 });
  const summary = await readCommentSummary(fake.client, { anilistId: 21, episodeNumber: 1089 });

  assert.deepEqual(summary, {
    commentCount: 7,
    comments: [
      { text: "Great episode!", datePublished: "2025-02-01T12:00:00.000Z", author: "Monkey D. Luffy" },
    ],
  });
  assert.ok(fake.calls.some((call) => call.includes("from:comment_feed")));
  assert.ok(fake.calls.some((call) => call.includes('"anilist_id":21')));
  assert.ok(fake.calls.some((call) => call.includes('"episode_number":1089')));
  assert.ok(fake.calls.some((call) => call.includes('"is:parent_id":null')), "top-level only");
});

test("spoilers, deleted rows, blank bodies and anonymous rows are excluded", async () => {
  const fake = fakeClient({
    rows: [
      row({ is_spoiler: true, body: "Spoiler!" }),
      row({ deleted_at: "2025-01-01T00:00:00.000Z", body: "Removed" }),
      row({ body: "<p>   </p>" }),
      row({ display_name: null, username: null }),
      row({ body: "Kept" }),
    ],
    count: 5,
  });

  const summary = await readCommentSummary(fake.client, { anilistId: 21 });
  assert.equal(summary?.comments.length, 1);
  assert.equal(summary?.comments[0].text, "Kept");
});

test("at most five comments are kept, and duplicates collapse", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => row({ body: `Comment ${index}` }));
  rows.push(row({ body: "Comment 0" }));

  const summary = await readCommentSummary(fakeClient({ rows, count: 13 }).client, { anilistId: 21 });
  assert.equal(summary?.comments.length, COMMENTS_JSONLD_LIMIT);
  assert.equal(COMMENTS_JSONLD_LIMIT, 5);
  assert.deepEqual(
    summary?.comments.map((comment) => comment.text),
    ["Comment 0", "Comment 1", "Comment 2", "Comment 3", "Comment 4"],
  );
});

test("a wrong username falls back to the display name and strips html", async () => {
  const fake = fakeClient({
    rows: [row({ display_name: null, username: "zoro", body: "<b>Three sword</b> style" })],
    count: 1,
  });
  const comments = await readTopComments(fake.client, { anilistId: 21 });
  assert.deepEqual(comments, [
    { text: "Three sword style", datePublished: "2025-02-01T12:00:00.000Z", author: "zoro" },
  ]);
});

test("a failing query returns null instead of throwing", async () => {
  const summary = await readCommentSummary(
    fakeClient({ error: { message: "relation does not exist" } }).client,
    { anilistId: 21 },
  );
  assert.equal(summary, null);

  assert.equal(await readCommentSummary(null, { anilistId: 21 }), null);
  assert.equal(await readCommentSummary(fakeClient({}).client, { anilistId: 0 }), null);
});

test("a hanging query times out and yields null", async () => {
  const hanging = {
    from: () => {
      const api: Record<string, unknown> = {};
      const chain = () => api;
      for (const method of ["select", "eq", "is", "order", "limit"]) api[method] = chain;
      // Never settles: the budget must win.
      api.then = () => new Promise(() => {});
      return api;
    },
  };

  const summary = await readCommentSummary(hanging as never, { anilistId: 21 }, 25);
  assert.equal(summary, null);
});

test("commentCount is the full total, not the number of quoted comments", async () => {
  const fake = fakeClient({ rows: [row()], count: 431 });
  assert.equal(await countPageComments(fake.client, { anilistId: 21 }), 431);
  assert.equal((await readCommentSummary(fake.client, { anilistId: 21 }))?.commentCount, 431);
});

test("comment markup is trimmed, escaped and shaped like schema.org Comment", async () => {
  const fake = fakeClient({
    rows: [
      row({
        body: `I <3 One Piece & Zoro\u2028forever ${"x".repeat(400)}`,
        display_name: "Nami",
      }),
    ],
    count: 1,
  });
  const summary = await readCommentSummary(fake.client, { anilistId: 21 });

  const graph = buildMediaJsonLd({
    id: 21,
    name: "One Piece",
    url: `${SITE}/media/21`,
    format: "TV",
    comments: summary,
  });
  const nodes = graph["@graph"] as Array<Record<string, unknown>>;
  assert.equal(nodes[0].commentCount, 1);

  const comments = nodes[0].comment as Array<Record<string, unknown>>;
  assert.equal(comments.length, 1);
  assert.equal(comments[0]["@type"], "Comment");
  assert.ok(String(comments[0].text).length <= 300, "text is trimmed to 300 chars");
  assert.ok(String(comments[0].text).startsWith("I <3 One Piece"), "the body is kept as text");
  assert.deepEqual(comments[0].author, { "@type": "Person", name: "Nami" });
  assert.match(String(comments[0].datePublished), /(Z|[+-]\d{2}:\d{2})$/, "datePublished has a timezone");

  const payload = serializeJsonLd(graph);
  assert.ok(!payload.includes("</script>"), "a comment can never close the script tag");
  assert.ok(payload.includes("\\u003c"), "< is escaped");
  assert.ok(payload.includes("\\u0026"), "& is escaped");
  assert.ok(!payload.includes("\u2028"), "U+2028 is escaped");
  assert.equal(JSON.parse(payload)["@graph"][0].comment[0].text.startsWith("I <3 One Piece"), true);
  assert.doesNotThrow(() => JSON.parse(payload));
});

test("the watch page VideoObject carries the comments too", async () => {
  const summary = await readCommentSummary(fakeClient({ rows: [row()], count: 2 }).client, {
    anilistId: 21,
    episodeNumber: 1089,
  });

  const nodes = buildWatchJsonLd({
    id: 21,
    animeName: "One Piece",
    episode: 1089,
    description: "Luffy sets sail.",
    thumbnailUrl: "https://cdn.example/ep.jpg",
    airedAtISO: "2024-01-07",
    url: `${SITE}/watch/21?ep=1089`,
    seriesUrl: `${SITE}/media/21`,
    format: "TV",
    playable: true,
    comments: summary,
  })["@graph"] as Array<Record<string, unknown>>;

  const video = nodes[1];
  assert.equal(video.commentCount, 2);
  assert.equal((video.comment as unknown[]).length, 1);
});

test("a failed comments query leaves the page markup valid, just without comments", () => {
  const graph = buildMediaJsonLd({
    id: 21,
    name: "One Piece",
    url: `${SITE}/media/21`,
    format: "TV",
    comments: null,
  });
  const nodes = graph["@graph"] as Array<Record<string, unknown>>;
  assert.equal(nodes[0].comment, undefined);
  assert.equal(nodes[0].commentCount, undefined);
  assert.doesNotThrow(() => JSON.parse(serializeJsonLd(graph)));
});
