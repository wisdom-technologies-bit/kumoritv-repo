// Prompt 38B: the write rules, without a Next request in the way.
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPostWriteError,
  handleCreatePost,
  handleCreateReport,
  type CommunitySession,
} from "../posts-server";

const SESSION: CommunitySession = { userId: "user-1", isAnonymous: false };
const ANON_SESSION: CommunitySession = { userId: "guest-1", isAnonymous: true };

function limiter(allowed = true, retryAfterSeconds = 7) {
  return { check: () => ({ allowed, remaining: 0, retryAfterSeconds }), reset() {}, size: () => 1 };
}

function insertReturning(data: any = { id: "p1", author_id: "user-1", body: "hello", is_spoiler: false, created_at: "2026-11-13T09:00:00.000Z" }, error: any = null) {
  const calls: any[] = [];
  return {
    calls,
    fn: async (row: any) => {
      calls.push(row);
      return { data: error ? null : data, error };
    },
  };
}

test("a guest is refused before anything is validated", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: null,
    raw: { body: "hello" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
  });
  assert.equal(result.status, 401);
  assert.equal(insert.calls.length, 0);
});

test("an anonymous Supabase session cannot post (RLS and API agree)", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: ANON_SESSION,
    raw: { body: "hello" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "sign_in_required");
  assert.equal(insert.calls.length, 0);
});

test("the author is always the session user, never the body", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "hello", author_id: "someone-else" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
  });
  assert.equal(result.status, 201);
  assert.equal(insert.calls[0].author_id, "user-1");
});

test("invalid bodies never reach the database", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "   " },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "empty_body");
  assert.equal(insert.calls.length, 0);
});

test("the in-process limiter answers 429 with retry-after", async () => {
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "hello" },
    ip: "1.1.1.1",
    limiter: limiter(false, 23) as any,
    insert: insertReturning().fn,
  });
  assert.equal(result.status, 429);
  assert.equal(result.headers?.["retry-after"], "23");
});

test("the durable SQL guard messages map onto real answers", async () => {
  const burst = await handleCreatePost({
    session: SESSION,
    raw: { body: "hello" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insertReturning(null, { message: "You are posting too fast. Please wait a moment." }).fn,
  });
  assert.equal(burst.status, 429);

  const hourly = await handleCreatePost({
    session: SESSION,
    raw: { body: "hello" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insertReturning(null, { message: "You have reached the posting limit for this hour." }).fn,
  });
  assert.equal(hourly.status, 429);

  const duplicate = await handleCreatePost({
    session: SESSION,
    raw: { body: "hello" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insertReturning(null, { message: "You just posted that." }).fn,
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, "duplicate_post");

  assert.equal(classifyPostWriteError("something else entirely").status, 500);
});

test("a report from a guest is stored as a hash, never an id", async () => {
  const calls: any[] = [];
  const result = await handleCreateReport({
    session: null,
    raw: {
      target_kind: "post",
      target_id: "10000000-0000-0000-0000-000000000001",
      reason: "spam",
    },
    reporterHash: "hashed-ip",
    limiter: limiter() as any,
    insert: async (row) => {
      calls.push(row);
      return { error: null };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(calls[0].reporter_id, null);
  assert.equal(calls[0].reporter_hash, "hashed-ip");
});

test("a duplicate report is a 409, not a 500", async () => {
  const result = await handleCreateReport({
    session: SESSION,
    raw: { target_kind: "post", target_id: "10000000-0000-0000-0000-000000000001", reason: "spam" },
    reporterHash: "hashed-ip",
    limiter: limiter() as any,
    insert: async () => ({ error: { message: "duplicate key", code: "23505" } }),
  });
  assert.equal(result.status, 409);
});

test("an invalid report never reaches the database", async () => {
  let called = false;
  const result = await handleCreateReport({
    session: SESSION,
    raw: { target_kind: "post", target_id: "nope", reason: "spam" },
    reporterHash: "hashed-ip",
    limiter: limiter() as any,
    insert: async () => {
      called = true;
      return { error: null };
    },
  });
  assert.equal(result.status, 400);
  assert.equal(called, false);
});

// ---------------------------------------------------------------- Phase 3 ----
// A clip attachment: resolved server-side, one attachment per post, and a
// clip-only post still has a body because the table demands one.

function resolver(clip: { id: string; title: string | null } | null, calls: string[] = []) {
  return async (code: string) => {
    calls.push(code);
    return clip;
  };
}

test("a clip code is resolved and only its id is stored", async () => {
  const insert = insertReturning();
  const codes: string[] = [];
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "look at this", clip_code: "abc2345" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver({ id: "clip-1", title: "The best fight" }, codes),
  });
  assert.equal(result.status, 201);
  assert.deepEqual(codes, ["abc2345"]);
  assert.equal(insert.calls.length, 1);
  assert.equal(insert.calls[0].clip_id, "clip-1");
  assert.equal(insert.calls[0].link_url, null);
  assert.equal(insert.calls[0].body, "look at this");
});

test("an unknown or deleted clip is a 400 and writes nothing", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "x", clip_code: "abc2345" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver(null),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "unknown_clip");
  assert.equal(insert.calls.length, 0);
});

test("no resolver at all means no attachment, never an unattached post", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "x", clip_code: "abc2345" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "unknown_clip");
  assert.equal(insert.calls.length, 0);
});

test("a clip-only post gets the clip title as its body", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "", clip_code: "abc2345" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver({ id: "clip-1", title: "  The best fight  " }),
  });
  assert.equal(result.status, 201);
  assert.equal(insert.calls[0].body, "The best fight");
});

test("a clip-only post with an untitled clip says Shared a clip", async () => {
  for (const title of [null, "", "   "]) {
    const insert = insertReturning();
    await handleCreatePost({
      session: SESSION,
      raw: { body: "   ", clip_code: "abc2345" },
      ip: "1.1.1.1",
      limiter: limiter() as any,
      insert: insert.fn,
      resolveClip: resolver({ id: "clip-1", title }),
    });
    assert.equal(insert.calls[0].body, "Shared a clip", `title ${JSON.stringify(title)}`);
  }
});

test("a clip title used as a body is cleaned like any other text", async () => {
  const insert = insertReturning();
  await handleCreatePost({
    session: SESSION,
    raw: { body: "", clip_code: "abc2345" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver({ id: "clip-1", title: "this fight is fucking unreal" }),
  });
  assert.equal(insert.calls[0].clip_id, "clip-1");
  assert.ok(!/\bfucking\b/i.test(insert.calls[0].body));
  assert.match(insert.calls[0].body, /\*/);
});

test("someone else's public clip is a fine attachment: ownership is not consulted", async () => {
  // The resolver is given the code and nothing else: there is nowhere for an
  // owner check to live, which is the point (a clip is a public pointer).
  const insert = insertReturning();
  const codes: string[] = [];
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "someone else's clip", clip_code: "zzz9999" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver({ id: "clip-9", title: null }, codes),
  });
  assert.equal(result.status, 201);
  assert.deepEqual(codes, ["zzz9999"]);
  assert.equal(insert.calls[0].clip_id, "clip-9");
});

test("a plain link is stored as a link and never as a clip", async () => {
  const insert = insertReturning();
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "read this", link_url: "https://example.com/an-article" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver({ id: "clip-1", title: null }),
  });
  assert.equal(result.status, 201);
  assert.equal(insert.calls[0].clip_id, null);
  assert.equal(insert.calls[0].link_url, "https://example.com/an-article");
});

test("a clip URL pasted into link_url is resolved, not stored as a link", async () => {
  const insert = insertReturning();
  const codes: string[] = [];
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "", link_url: "https://kumoritv.top/clip/abc2345" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver({ id: "clip-1", title: "Attached from a link" }, codes),
  });
  assert.equal(result.status, 201);
  assert.deepEqual(codes, ["abc2345"]);
  assert.equal(insert.calls[0].clip_id, "clip-1");
  assert.equal(insert.calls[0].link_url, null);
  assert.equal(insert.calls[0].body, "Attached from a link");
});

test("two attachments are refused before anything is resolved", async () => {
  const insert = insertReturning();
  const codes: string[] = [];
  const result = await handleCreatePost({
    session: SESSION,
    raw: { body: "x", clip_code: "abc2345", link_url: "https://example.com/a" },
    ip: "1.1.1.1",
    limiter: limiter() as any,
    insert: insert.fn,
    resolveClip: resolver({ id: "clip-1", title: null }, codes),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "clip_and_link");
  assert.deepEqual(codes, []);
  assert.equal(insert.calls.length, 0);
});
