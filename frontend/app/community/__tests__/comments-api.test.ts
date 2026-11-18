// Phase 6, part E: the comment write gate.
//
// After the lockdown file the browser has no INSERT grant on public.comments, so
// these rules are the only thing between a request and a row. They are tested
// here without a database; the SQL half (the guard's limits, the reply-target
// rule) is proved in test-harness/phase6-sql-check.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCommentWriteError,
  handleCreateComment,
  handleDeleteComment,
  handleUpdateComment,
  validateCreateComment,
} from "@/app/lib/comments/comments-server";

const POST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const COMMENT_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const USER = "11111111-1111-4111-8111-111111111111";

const limiter = { check: () => ({ allowed: true, retryAfterSeconds: 0 }) };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    target_type: "anime" as const,
    post_id: null,
    announcement_id: null,
    anilist_id: 101,
    episode_number: 3,
    parent_id: null,
    user_id: USER,
    body: "hello",
    is_spoiler: false,
    created_at: "2026-11-18T10:00:00Z",
    ...overrides,
  };
}

test("an anime comment carries the anilist id, never a post id", () => {
  const parsed = validateCreateComment({ anilistId: 101, episodeNumber: 3, body: "  hi  " });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.target, { kind: "anime", anilistId: 101, episodeNumber: 3 });
  assert.equal(parsed.value.body, "hi");
});

test("a community comment needs a real uuid target", () => {
  assert.equal(validateCreateComment({ targetKind: "post", targetId: "nope", body: "hi" }).ok, false);
  const ok = validateCreateComment({ targetKind: "post", targetId: POST_ID, body: "hi" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value.target, { kind: "post", id: POST_ID });
});

test("empty and oversized bodies are refused before anything else", () => {
  const empty = validateCreateComment({ anilistId: 101, body: "   " });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.error, "empty_body");

  const long = validateCreateComment({ anilistId: 101, body: "x".repeat(401) });
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.error, "body_too_long");
});

test("profanity is refused and the body is never echoed back", () => {
  const parsed = validateCreateComment({ anilistId: 101, body: "you are a shit" });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.error, "profane");
  assert.doesNotMatch(parsed.message, /shit/i);
});

test("a guest session cannot comment, and neither can a signed-out one", async () => {
  const insert = async () => ({ data: row(), error: null });
  const signedOut = await handleCreateComment({
    session: null,
    raw: { anilistId: 101, body: "hi" },
    ip: "1.2.3.4",
    limiter,
    limit: 10,
    insert,
  });
  assert.equal(signedOut.status, 401);

  const guest = await handleCreateComment({
    session: { userId: USER, isAnonymous: true },
    raw: { anilistId: 101, body: "hi" },
    ip: "1.2.3.4",
    limiter,
    limit: 10,
    insert,
  });
  assert.equal(guest.status, 403);
});

test("user_id comes from the session, never from the body", async () => {
  let written: Record<string, unknown> | null = null;
  const result = await handleCreateComment({
    session: { userId: USER, isAnonymous: false },
    raw: { anilistId: 101, body: "hi", user_id: "attacker" },
    ip: "1.2.3.4",
    limiter,
    limit: 10,
    insert: async (input) => {
      written = input as unknown as Record<string, unknown>;
      return { data: row(), error: null };
    },
  });
  assert.equal(result.status, 201);
  assert.equal((written as unknown as Record<string, unknown>).user_id, USER);
});

test("the in-memory limit answers 429 with retry-after", async () => {
  const result = await handleCreateComment({
    session: { userId: USER, isAnonymous: false },
    raw: { anilistId: 101, body: "hi" },
    ip: "1.2.3.4",
    limiter: { check: () => ({ allowed: false, retryAfterSeconds: 12 }) },
    limit: 10,
    insert: async () => ({ data: row(), error: null }),
  });
  assert.equal(result.status, 429);
  assert.equal(result.headers?.["retry-after"], "12");
});

test("the durable codes become sentences, and an unknown failure stays a 500", () => {
  const minute = classifyCommentWriteError("rate_limit:comments_minute");
  assert.equal(minute.status, 429);
  assert.match(String(minute.body.message), /Give it a minute/);

  const hour = classifyCommentWriteError("rate_limit:comments_hour");
  assert.equal(hour.status, 429);

  const gap = classifyCommentWriteError("You are commenting too fast. Please wait a few seconds.");
  assert.equal(gap.status, 429);

  const parent = classifyCommentWriteError("Invalid reply target.");
  assert.equal(parent.status, 400);
  assert.equal(parent.body.error, "invalid_parent");

  assert.equal(classifyCommentWriteError("something else entirely").status, 500);
});

test("the spoiler toggle only moves the flag, and only on your own comment", async () => {
  let seen: { commentId: string; userId: string; isSpoiler: boolean } | null = null;
  const ok = await handleUpdateComment({
    session: { userId: USER, isAnonymous: false },
    commentId: COMMENT_ID,
    raw: { isSpoiler: true },
    update: async (args) => {
      seen = args;
      return { data: { id: COMMENT_ID, is_spoiler: true }, error: null };
    },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(seen, { commentId: COMMENT_ID, userId: USER, isSpoiler: true });

  const missing = await handleUpdateComment({
    session: { userId: USER, isAnonymous: false },
    commentId: COMMENT_ID,
    raw: {},
    update: async () => ({ data: null, error: null }),
  });
  assert.equal(missing.status, 400);

  const notMine = await handleUpdateComment({
    session: { userId: USER, isAnonymous: false },
    commentId: COMMENT_ID,
    raw: { isSpoiler: true },
    update: async () => ({ data: null, error: null }),
  });
  assert.equal(notMine.status, 404, "someone else's comment is not confirmed to exist");
});

test("delete is a soft delete of your own comment, stamped server-side", async () => {
  let args: { commentId: string; userId: string; at: string } | null = null;
  const result = await handleDeleteComment({
    session: { userId: USER, isAnonymous: false },
    commentId: COMMENT_ID,
    remove: async (input) => {
      args = input;
      return { data: { id: COMMENT_ID }, error: null };
    },
    now: () => new Date("2026-11-18T12:00:00Z"),
  });
  assert.equal(result.status, 200);
  assert.equal((args as unknown as { at: string }).at, "2026-11-18T12:00:00.000Z");
  assert.equal((args as unknown as { userId: string }).userId, USER);

  const notMine = await handleDeleteComment({
    session: { userId: USER, isAnonymous: false },
    commentId: COMMENT_ID,
    remove: async () => ({ data: null, error: null }),
  });
  assert.equal(notMine.status, 404);

  const signedOut = await handleDeleteComment({
    session: null,
    commentId: COMMENT_ID,
    remove: async () => ({ data: null, error: null }),
  });
  assert.equal(signedOut.status, 401);
});

test("a malformed id is a 404, never a database call", async () => {
  let called = false;
  const result = await handleDeleteComment({
    session: { userId: USER, isAnonymous: false },
    commentId: "not-a-uuid",
    remove: async () => {
      called = true;
      return { data: null, error: null };
    },
  });
  assert.equal(result.status, 404);
  assert.equal(called, false);
});
