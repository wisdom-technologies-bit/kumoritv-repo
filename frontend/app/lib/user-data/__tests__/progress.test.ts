import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import { installBrowserShim, tick } from "../../../../test-harness/browser";
import { createMemoryStorage } from "../storage";
import { __setDefaultContextForTests } from "../context";
import {
  SERVER_WRITE_INTERVAL_MS,
  __resetProgressSyncForTests,
  buildContinueWatchingMediaData,
  flushProgress,
  getProgress,
  isProgressCompleted,
  isWatched,
  listContinueWatching,
  markWatched,
  mergeServerRowsIntoLocal,
  saveProgress,
  shouldResume,
} from "../progress";

function signedInClient() {
  const client = new FakeSupabaseClient();
  const storage = installBrowserShim(createMemoryStorage());
  __resetProgressSyncForTests();
  __setDefaultContextForTests({ userId: "user-1", client, storage, now: () => Date.now() });
  return { client, storage };
}

test("local progress behaves exactly like the old store", () => {
  installBrowserShim(createMemoryStorage());
  __resetProgressSyncForTests();
  __setDefaultContextForTests({ userId: null, client: null, storage: null, now: () => Date.now() });

  saveProgress(1, { episode: 2, time: 60, duration: 1400, audio: "sub", title: "Frieren" });
  assert.equal(getProgress(1)?.episode, 2);
  assert.equal(getProgress(1)?.time, 60);

  markWatched(1, 2, true);
  assert.equal(isWatched(1, 2), true);

  assert.equal(listContinueWatching()[0].id, 1);
  assert.equal(shouldResume(60, 1400), true);
  assert.equal(shouldResume(3, 1400), false);
});

test("completed is true from 90% of the duration", () => {
  assert.equal(isProgressCompleted(1079, 1200), false);
  assert.equal(isProgressCompleted(1080, 1200), true);
  assert.equal(isProgressCompleted(500, 0), false);
});

test("guest progress never touches Supabase", async () => {
  const client = new FakeSupabaseClient();
  installBrowserShim(createMemoryStorage());
  __resetProgressSyncForTests();
  __setDefaultContextForTests({ userId: null, client, storage: null, now: () => Date.now() });

  saveProgress(5, { episode: 1, time: 100, duration: 1200, audio: "sub" });
  markWatched(5, 1, true);
  await flushProgress();

  assert.equal(client.rows("watch_progress").length, 0);
});

test("signed in: at most one write per 15s while playing, then flush writes the newest state", async () => {
  const { client } = signedInClient();

  saveProgress(7, { episode: 1, time: 10, duration: 1200, audio: "sub", title: "Show" });
  await tick();

  saveProgress(7, { episode: 1, time: 60, duration: 1200, audio: "sub", title: "Show" });
  await tick();
  saveProgress(7, { episode: 1, time: 90, duration: 1200, audio: "sub", title: "Show" });
  await tick();

  const rows = client.rows("watch_progress");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].position_seconds, 10);
  assert.equal(rows[0].snapshot.title, "Show");
  assert.ok(SERVER_WRITE_INTERVAL_MS === 15000);

  await flushProgress();
  assert.equal(client.rows("watch_progress")[0].position_seconds, 90);
});

test("signed in: markWatched writes completed immediately", async () => {
  const { client } = signedInClient();

  markWatched(9, 3, true);
  await tick();

  const row = client.rows("watch_progress")[0];
  assert.equal(row.episode_number, 3);
  assert.equal(row.completed, true);

  markWatched(9, 3, false);
  await tick();

  assert.equal(client.rows("watch_progress")[0].completed, false);
});

test("continue-watching takes the latest row per anime, skipping completed and < 5s", () => {
  const rows = [
    { anilist_id: 1, episode_number: 1, position_seconds: 30, duration_seconds: 1200, audio: "sub", completed: false, snapshot: { title: "Old", cover: "old.jpg" }, updated_at: "2026-10-01T10:00:00.000Z" },
    { anilist_id: 1, episode_number: 2, position_seconds: 120, duration_seconds: 1200, audio: "dub", completed: false, snapshot: { title: "New", cover: "new.jpg" }, updated_at: "2026-10-02T10:00:00.000Z" },
    { anilist_id: 2, episode_number: 4, position_seconds: 300, duration_seconds: 1200, audio: "sub", completed: true, snapshot: { title: "Done", cover: "done.jpg" }, updated_at: "2026-10-03T10:00:00.000Z" },
    { anilist_id: 3, episode_number: 1, position_seconds: 4, duration_seconds: 1200, audio: "sub", completed: false, snapshot: { title: "Too short", cover: null }, updated_at: "2026-10-04T10:00:00.000Z" },
  ];

  const result = buildContinueWatchingMediaData(rows as any);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
  assert.equal(result[0].episode, "2");
  assert.equal(result[0].episodeTimeLastStop, 120);
  assert.equal(result[0].dub, true);
  assert.equal(result[0].title.romaji, "New");
  assert.equal(result[0].episodeImg, "new.jpg");
  // legacy fields the original cards read
  assert.equal(result[0].source, "gogoanime");
  assert.equal(result[0].episodeId, "");
  assert.equal(result[0].type, "TV");
});

test("server rows merge into local by newest updated_at and union watched episodes", () => {
  installBrowserShim(createMemoryStorage());
  __resetProgressSyncForTests();

  const changed = mergeServerRowsIntoLocal([
    { anilist_id: 10, episode_number: 4, position_seconds: 200, duration_seconds: 1200, audio: "sub", completed: true, snapshot: { title: "Show", cover: "c.jpg" }, updated_at: "2026-10-05T10:00:00.000Z" },
    { anilist_id: 10, episode_number: 5, position_seconds: 30, duration_seconds: 1200, audio: "sub", completed: false, snapshot: { title: "Show", cover: "c.jpg" }, updated_at: "2026-10-04T10:00:00.000Z" },
  ]);

  assert.equal(changed, 1);
  const record = getProgress(10);
  assert.equal(record?.episode, 4);
  assert.equal(record?.time, 200);
  assert.deepEqual(record?.watched, [4]);
  assert.equal(record?.title, "Show");
});
