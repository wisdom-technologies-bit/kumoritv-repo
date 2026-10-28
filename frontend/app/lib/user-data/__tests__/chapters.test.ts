import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import { createMemoryStorage } from "../storage";
import {
  GUEST_CHAPTERS_KEY,
  LEGACY_GUEST_CHAPTERS_KEY,
  __resetChaptersForTests,
  isRead,
  listRead,
  markRead,
  saveLastPage,
  unmarkRead,
} from "../chapters";
import { mergeGuestDataIntoAccount, mergeMarkerKey } from "../merge";
import { __setDefaultContextForTests } from "../context";

test.beforeEach(() => {
  __resetChaptersForTests();
  __setDefaultContextForTests(null);
});

test.afterEach(() => {
  __setDefaultContextForTests(null);
});

// ---------------------------------------------------------------------- guest

test("guest: marking and unmarking a chapter stays in localStorage", async () => {
  const storage = createMemoryStorage();
  const ctx = { userId: null, client: null, storage };

  assert.equal(await markRead(21, 3, { chapterId: "c-3", page: 12 }, ctx), true);
  assert.equal(await isRead(21, 3, ctx), true);
  assert.equal(await isRead(21, 4, ctx), false);

  const stored = JSON.parse(storage.getItem(GUEST_CHAPTERS_KEY)!);
  assert.equal(stored["21"]["3"].chapterId, "c-3");
  assert.equal(stored["21"]["3"].lastPage, 12);

  assert.equal(await unmarkRead(21, 3, ctx), true);
  assert.equal(await isRead(21, 3, ctx), false);
  assert.equal((await listRead(21, ctx)).length, 0);
});

test("guest: the Prompt 9 key is migrated once and removed", async () => {
  const storage = createMemoryStorage({
    [LEGACY_GUEST_CHAPTERS_KEY]: JSON.stringify({
      "21": [
        { mediaId: 21, chapterNumber: 1, chapterTitle: "Chapter 1" },
        { mediaId: 21, chapterNumber: 2, chapterTitle: "Chapter 2" },
      ],
    }),
  });
  const ctx = { userId: null, client: null, storage };

  const records = await listRead(21, ctx);

  assert.deepEqual(records.map((record) => record.chapterNumber).sort(), [1, 2]);
  assert.equal(storage.getItem(LEGACY_GUEST_CHAPTERS_KEY), null);
  assert.ok(storage.getItem(GUEST_CHAPTERS_KEY));
});

// ------------------------------------------------------------------ signed in

test("signed in: upserts into chapters_read with the owning user id", async () => {
  const client = new FakeSupabaseClient();
  const storage = createMemoryStorage();
  const ctx = { userId: "user-1", client, storage };

  assert.equal(await markRead(21, 12.5, { chapterId: "c-125", page: 30 }, ctx), true);

  const rows = client.rows("chapters_read");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, "user-1");
  assert.equal(rows[0].anilist_id, 21);
  assert.equal(rows[0].chapter_number, 12.5);
  assert.equal(rows[0].chapter_id, "c-125");
  assert.equal(rows[0].last_page, 30);
});

test("signed in: the table is the source of truth for listRead", async () => {
  const client = new FakeSupabaseClient({
    chapters_read: [
      { user_id: "user-1", anilist_id: 21, chapter_number: 1, chapter_id: "c-1", last_page: 20, snapshot: null, read_at: "2026-10-01T10:00:00.000Z" },
      { user_id: "user-1", anilist_id: 21, chapter_number: 2, chapter_id: "c-2", last_page: 21, snapshot: null, read_at: "2026-10-02T10:00:00.000Z" },
    ],
  });
  const ctx = { userId: "user-1", client, storage: createMemoryStorage() };

  const records = await listRead(21, ctx);

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.chapterNumber), [2, 1], "newest first");
  assert.equal(await isRead(21, 2, ctx), true);
});

test("signed in: unmarkRead deletes only that user's row", async () => {
  const client = new FakeSupabaseClient({
    chapters_read: [
      { user_id: "user-1", anilist_id: 21, chapter_number: 1, read_at: "2026-10-01T10:00:00.000Z" },
      { user_id: "user-2", anilist_id: 21, chapter_number: 1, read_at: "2026-10-01T10:00:00.000Z" },
    ],
  });
  const ctx = { userId: "user-1", client, storage: createMemoryStorage() };

  assert.equal(await unmarkRead(21, 1, ctx), true);

  assert.equal(client.rows("chapters_read").length, 1);
  assert.equal(client.rows("chapters_read")[0].user_id, "user-2");
});

// ------------------------------------------------------------------- failures

test("rollback: a failed upsert puts the local copy back", async () => {
  const client = new FakeSupabaseClient();
  const storage = createMemoryStorage();
  const ctx = { userId: "user-1", client, storage };

  await markRead(21, 1, {}, ctx);
  client.failOn("chapters_read", "permission denied");

  assert.equal(await markRead(21, 2, {}, ctx), false);

  const stored = JSON.parse(storage.getItem("kumori_chapters_cache_user-1")!);
  assert.ok(stored["21"]["1"], "the earlier chapter survives");
  assert.equal(stored["21"]["2"], undefined, "the optimistic write was rolled back");
});

test("rollback: a failed delete restores the row locally", async () => {
  const client = new FakeSupabaseClient({
    chapters_read: [{ user_id: "user-1", anilist_id: 21, chapter_number: 1, read_at: "2026-10-01T10:00:00.000Z" }],
  });
  const storage = createMemoryStorage();
  const ctx = { userId: "user-1", client, storage };

  await listRead(21, ctx);
  client.failOn("chapters_read");

  assert.equal(await unmarkRead(21, 1, ctx), false);
  assert.equal(await isRead(21, 1, ctx), true);
});

test("a missing chapters_read table never throws: readers get the local copy", async () => {
  const client = new FakeSupabaseClient();
  client.failOn("chapters_read", 'relation "chapters_read" does not exist');
  const storage = createMemoryStorage();
  const ctx = { userId: "user-1", client, storage };

  assert.deepEqual(await listRead(21, ctx), []);
  assert.equal(await isRead(21, 1, ctx), false);
});

// ------------------------------------------------------------------ last page

test("saveLastPage: at most one write per 15 s, then the newest page is flushed", async () => {
  const client = new FakeSupabaseClient();
  const ctx = { userId: "user-1", client, storage: createMemoryStorage(), now: () => Date.now() };
  // saveLastPage takes no context argument: it reads the session context.
  __setDefaultContextForTests(ctx);

  await saveLastPage(21, 1, 2);
  await saveLastPage(21, 1, 5);
  await saveLastPage(21, 1, 9);

  assert.equal(client.rows("chapters_read").length, 1, "throttled to one write");

  const { flushLastPage } = await import("../chapters");
  await flushLastPage();

  const rows = client.rows("chapters_read");
  assert.equal(rows.at(-1)!.last_page, 9, "the pending position is flushed");
});

test("saveLastPage: guests are not written to Supabase at all", async () => {
  const client = new FakeSupabaseClient();
  const ctx = { userId: null, client: null, storage: createMemoryStorage() };

  await saveLastPage(21, 1, 3);
  await saveLastPage(21, 1, 4);

  assert.equal(client.rows("chapters_read").length, 0);
});

// ---------------------------------------------------------------------- merge

test("merge: guest chapters are unioned into the account, newest wins", async () => {
  const storage = createMemoryStorage({
    [GUEST_CHAPTERS_KEY]: JSON.stringify({
      "21": {
        "1": { anilistId: 21, chapterNumber: 1, chapterId: "c-1", readAt: Date.parse("2026-10-01T10:00:00.000Z") },
        "2": { anilistId: 21, chapterNumber: 2, chapterId: "c-2", readAt: Date.parse("2026-10-05T10:00:00.000Z") },
      },
    }),
  });

  const client = new FakeSupabaseClient({
    chapters_read: [
      {
        user_id: "user-1",
        anilist_id: 21,
        chapter_number: 1,
        chapter_id: "server-1",
        read_at: "2026-10-02T10:00:00.000Z",
      },
    ],
  });
  client.tables.profiles = [
    { id: "user-1", auto_skip: false, auto_next: true, preferred_audio: "sub", subtitle_language: "English" },
  ];

  const result = await mergeGuestDataIntoAccount("user-1", { userId: "user-1", client, storage });

  assert.equal(result.merged, true);
  assert.equal(result.chapters, 1, "only the guest row that is newer is uploaded");

  const rows = client.rows("chapters_read");
  const chapterTwo = rows.find((row) => Number(row.chapter_number) === 2);
  assert.ok(chapterTwo, "the new chapter was added");
  assert.equal(chapterTwo!.chapter_id, "c-2");

  const chapterOne = rows.find((row) => Number(row.chapter_number) === 1);
  assert.equal(chapterOne!.chapter_id, "server-1", "the older guest copy does not overwrite the server");

  assert.equal(storage.getItem(GUEST_CHAPTERS_KEY), null, "the guest copy is cleared");
  assert.equal(storage.getItem(mergeMarkerKey("user-1")), "1");
});
