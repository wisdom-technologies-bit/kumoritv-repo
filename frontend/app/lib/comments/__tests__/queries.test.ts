import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import {
  CommentFeedRow,
  addComment,
  clearReaction,
  countComments,
  isCommentingTooFast,
  listComments,
  listMyReactions,
  listReplies,
  normaliseCommentBody,
  setReaction,
  softDeleteComment,
} from "../queries";

const MEDIA_ID = 21;
const session = { user: { id: "user-1" } };

function feedRow(overrides: Partial<CommentFeedRow> = {}): CommentFeedRow {
  return {
    id: "comment-1",
    anilist_id: MEDIA_ID,
    episode_number: null,
    parent_id: null,
    user_id: "user-1",
    body: "hello",
    is_spoiler: false,
    created_at: "2026-10-01T10:00:00.000Z",
    username: "kumori",
    display_name: "Kumori TV",
    avatar_url: null,
    likes: 0,
    dislikes: 0,
    ...overrides,
  };
}

function seededClient() {
  return new FakeSupabaseClient({
    comment_feed: [
      feedRow({ id: "a-old", body: "oldest", created_at: "2026-10-01T10:00:00.000Z", likes: 1, dislikes: 0 }),
      feedRow({ id: "b-new", body: "newest", created_at: "2026-10-03T10:00:00.000Z", likes: 9, dislikes: 1 }),
      feedRow({ id: "c-mid", body: "middle", created_at: "2026-10-02T10:00:00.000Z", likes: 4, dislikes: 7 }),
      feedRow({ id: "d-ep1", body: "on episode one", created_at: "2026-10-04T10:00:00.000Z", episode_number: 1 }),
      feedRow({ id: "e-ep2", body: "on episode two", created_at: "2026-10-05T10:00:00.000Z", episode_number: 2 }),
      feedRow({ id: "f-other-media", body: "other anime", anilist_id: 999 }),
      feedRow({ id: "g-reply", body: "a reply", parent_id: "b-new", created_at: "2026-10-03T11:00:00.000Z" }),
      feedRow({ id: "h-reply", body: "another reply", parent_id: "b-new", created_at: "2026-10-03T12:00:00.000Z" }),
    ],
  });
}

test("media page lists every top-level comment of the anime, newest first", async () => {
  const client = seededClient();

  const result = await listComments(client, { anilistId: MEDIA_ID, sort: "recent", limit: 10 });

  assert.equal(result.error, null);
  assert.deepEqual(
    result.data?.map((row) => row.id),
    ["e-ep2", "d-ep1", "b-new", "c-mid", "a-old"],
  );
  // replies and other anime never show up as top-level rows
  assert.ok(!result.data?.some((row) => row.parent_id !== null));
  assert.ok(!result.data?.some((row) => row.anilist_id !== MEDIA_ID));
});

test("watch page lists only the comments of the current episode", async () => {
  const client = seededClient();

  const episodeTwo = await listComments(client, {
    anilistId: MEDIA_ID,
    episodeNumber: 2,
    sort: "recent",
    limit: 10,
  });
  assert.deepEqual(episodeTwo.data?.map((row) => row.id), ["e-ep2"]);

  const episodeOne = await listComments(client, {
    anilistId: MEDIA_ID,
    episodeNumber: 1,
    sort: "recent",
    limit: 10,
  });
  assert.deepEqual(episodeOne.data?.map((row) => row.id), ["d-ep1"]);

  const episodeNine = await listComments(client, {
    anilistId: MEDIA_ID,
    episodeNumber: 9,
    sort: "recent",
    limit: 10,
  });
  assert.deepEqual(episodeNine.data, []);
});

test("the three sort orders are done by the query", async () => {
  const client = seededClient();

  const recent = await listComments(client, { anilistId: MEDIA_ID, sort: "recent", limit: 10 });
  assert.deepEqual(recent.data?.map((row) => row.id), ["e-ep2", "d-ep1", "b-new", "c-mid", "a-old"]);

  const likes = await listComments(client, { anilistId: MEDIA_ID, sort: "likes", limit: 10 });
  assert.deepEqual(likes.data?.map((row) => row.id), ["b-new", "c-mid", "a-old", "e-ep2", "d-ep1"]);
  assert.deepEqual(likes.data?.map((row) => row.likes), [9, 4, 1, 0, 0]);

  const dislikes = await listComments(client, { anilistId: MEDIA_ID, sort: "dislikes", limit: 10 });
  assert.deepEqual(dislikes.data?.map((row) => row.id), ["c-mid", "b-new", "e-ep2", "d-ep1", "a-old"]);
  assert.deepEqual(dislikes.data?.map((row) => row.dislikes), [7, 1, 0, 0, 0]);
});

test("ties fall back to the newest comment", async () => {
  const client = new FakeSupabaseClient({
    comment_feed: [
      feedRow({ id: "old-like", created_at: "2026-10-01T10:00:00.000Z", likes: 3 }),
      feedRow({ id: "new-like", created_at: "2026-10-02T10:00:00.000Z", likes: 3 }),
    ],
  });

  const likes = await listComments(client, { anilistId: MEDIA_ID, sort: "likes", limit: 10 });
  assert.deepEqual(likes.data?.map((row) => row.id), ["new-like", "old-like"]);
});

test("pagination uses a server-side range: first 3, then 10 more", async () => {
  const seeded = Array.from({ length: 15 }, (_, index) =>
    feedRow({
      id: `comment-${index + 1}`,
      created_at: `2026-10-${String(20 - index).padStart(2, "0")}T10:00:00.000Z`,
    }),
  );
  const client = new FakeSupabaseClient({ comment_feed: seeded });

  // first render: only the first 3 comments
  const firstPage = await listComments(client, { anilistId: MEDIA_ID, sort: "recent", limit: 3 });
  assert.equal(firstPage.data?.length, 3);
  assert.deepEqual(firstPage.data?.map((row) => row.id), ["comment-1", "comment-2", "comment-3"]);

  // "SEE MORE COMMENTS" asks for 3 + 10 in one range
  const afterSeeMore = await listComments(client, { anilistId: MEDIA_ID, sort: "recent", limit: 13 });
  assert.equal(afterSeeMore.data?.length, 13);
  assert.equal(afterSeeMore.data?.at(-1)?.id, "comment-13");

  // the offset really is sent to the database
  const shifted = await listComments(client, {
    anilistId: MEDIA_ID,
    sort: "recent",
    limit: 3,
    offset: 3,
  });
  assert.deepEqual(shifted.data?.map((row) => row.id), ["comment-4", "comment-5", "comment-6"]);
});

test("the total count ignores pagination and replies", async () => {
  const client = seededClient();

  const total = await countComments(client, { anilistId: MEDIA_ID });
  assert.equal(total.error, null);
  assert.equal(total.data, 5);

  const episodeTotal = await countComments(client, { anilistId: MEDIA_ID, episodeNumber: 2 });
  assert.equal(episodeTotal.data, 1);
});

test("replies load for the visible parents, oldest first, and group under them", async () => {
  const client = seededClient();

  const replies = await listReplies(client, ["b-new"]);
  assert.equal(replies.error, null);
  assert.deepEqual(replies.data?.map((row) => row.id), ["g-reply", "h-reply"]);

  const grouped = (replies.data ?? []).reduce<Record<string, string[]>>((accumulator, row) => {
    const parentId = row.parent_id as string;
    accumulator[parentId] ??= [];
    accumulator[parentId].push(row.id);
    return accumulator;
  }, {});
  assert.deepEqual(grouped, { "b-new": ["g-reply", "h-reply"] });

  const none = await listReplies(client, []);
  assert.deepEqual(none.data, []);
});

test("my reactions map only my own rows", async () => {
  const client = new FakeSupabaseClient({
    comment_reactions: [
      { comment_id: "a-old", user_id: "user-1", value: 1, created_at: "2026-10-01T10:00:00.000Z" },
      { comment_id: "b-new", user_id: "user-1", value: -1, created_at: "2026-10-01T10:00:00.000Z" },
      { comment_id: "c-mid", user_id: "user-2", value: 1, created_at: "2026-10-01T10:00:00.000Z" },
    ],
  });

  const mine = await listMyReactions(client, session.user.id, ["a-old", "b-new", "c-mid"]);
  assert.deepEqual(mine.data, { "a-old": 1, "b-new": -1 });

  const guest = await listMyReactions(client, null, ["a-old"]);
  assert.deepEqual(guest.data, {});
});

test("addComment writes the signed-in user, the spoiler flag and the episode", async () => {
  const client = new FakeSupabaseClient();

  const mediaPageComment = await addComment(client, {
    anilistId: MEDIA_ID,
    userId: session.user.id,
    body: "  what a shit episode  ",
    isSpoiler: true,
  });

  assert.equal(mediaPageComment.error, null);
  assert.equal(mediaPageComment.data?.body, "what a **** episode");
  assert.equal(mediaPageComment.data?.user_id, session.user.id);
  assert.equal(mediaPageComment.data?.is_spoiler, true);
  assert.equal(mediaPageComment.data?.episode_number, null);
  assert.equal(mediaPageComment.data?.parent_id, null);
  assert.equal(mediaPageComment.data?.anilist_id, MEDIA_ID);

  const watchPageComment = await addComment(client, {
    anilistId: MEDIA_ID,
    userId: session.user.id,
    body: "episode thread",
    episodeNumber: 4,
    isSpoiler: false,
  });
  assert.equal(watchPageComment.data?.episode_number, 4);

  const reply = await addComment(client, {
    anilistId: MEDIA_ID,
    userId: session.user.id,
    body: "a reply",
    parentId: "comment-1",
  });
  assert.equal(reply.data?.parent_id, "comment-1");

  const rows = client.rows("comments");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].body, "what a **** episode");
  assert.equal(rows[0].user_id, "user-1");
});

test("addComment refuses an empty body without touching the database", async () => {
  const client = new FakeSupabaseClient();

  const result = await addComment(client, { anilistId: MEDIA_ID, userId: "user-1", body: "    " });

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "empty_body");
  assert.equal(client.rows("comments").length, 0);
});

test("normaliseCommentBody trims and filters profanity", () => {
  assert.equal(normaliseCommentBody("  hi there  "), "hi there");
  assert.equal(normaliseCommentBody("such shit"), "such ****");
  assert.equal(normaliseCommentBody("   "), "");
});

test("soft delete only marks the owner's row and never removes it", async () => {
  const client = new FakeSupabaseClient({
    comments: [
      { id: "mine", anilist_id: MEDIA_ID, user_id: "user-1", body: "hi", parent_id: null, episode_number: null, is_spoiler: false, deleted_at: null, created_at: "", updated_at: "" },
      { id: "theirs", anilist_id: MEDIA_ID, user_id: "user-2", body: "yo", parent_id: null, episode_number: null, is_spoiler: false, deleted_at: null, created_at: "", updated_at: "" },
    ],
  });

  const result = await softDeleteComment(client, { commentId: "mine", userId: "user-1" });
  assert.equal(result.error, null);

  const rows = client.rows("comments");
  assert.equal(rows.length, 2);
  assert.equal(typeof rows.find((row) => row.id === "mine")?.deleted_at, "string");
  assert.equal(rows.find((row) => row.id === "theirs")?.deleted_at, null);

  // someone else's comment is left alone by the ownership filter
  await softDeleteComment(client, { commentId: "theirs", userId: "user-1" });
  assert.equal(client.rows("comments").find((row) => row.id === "theirs")?.deleted_at, null);
});

test("reaction toggle, switch and clear keep one row per user", async () => {
  const client = new FakeSupabaseClient();

  await setReaction(client, { commentId: "c1", userId: "user-1", value: 1 });
  assert.deepEqual(client.rows("comment_reactions").map((row) => [row.comment_id, row.user_id, row.value]), [
    ["c1", "user-1", 1],
  ]);

  // switching to dislike updates the same row
  await setReaction(client, { commentId: "c1", userId: "user-1", value: -1 });
  assert.deepEqual(client.rows("comment_reactions").map((row) => row.value), [-1]);

  // clicking the active reaction again removes it
  await clearReaction(client, { commentId: "c1", userId: "user-1" });
  assert.deepEqual(client.rows("comment_reactions"), []);
});

test("database failures come back as errors, not exceptions", async () => {
  const client = seededClient();
  client.failOn("comment_feed");

  const list = await listComments(client, { anilistId: MEDIA_ID, limit: 3 });
  assert.equal(list.data, null);
  assert.match(list.error?.message ?? "", /unavailable/);

  const count = await countComments(client, { anilistId: MEDIA_ID });
  assert.equal(count.data, null);
  assert.ok(count.error);

  client.heal("comment_feed");
  client.failOn("comments", "You are commenting too fast. Please wait a few seconds.");

  const tooFast = await addComment(client, { anilistId: MEDIA_ID, userId: "user-1", body: "hi" });
  assert.equal(isCommentingTooFast(tooFast.error), true);
  assert.equal(isCommentingTooFast(list.error), false);
});
