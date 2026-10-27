import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import { createMemoryStorage } from "../storage";
import {
  getListCounts,
  getListStatus,
  listByStatus,
  removeFromList,
  setListStatus,
  toAnilistStatus,
  toDbStatus,
} from "../lists";

const media = {
  id: 101,
  title: { romaji: "Frieren" },
  format: "TV",
  description: "magic",
  coverImage: { extraLarge: "xl.jpg", large: "l.jpg" },
};

test("maps all six AniList statuses both ways", () => {
  const pairs: [string, string][] = [
    ["CURRENT", "watching"],
    ["PLANNING", "planning"],
    ["COMPLETED", "completed"],
    ["DROPPED", "dropped"],
    ["PAUSED", "paused"],
    ["REPEATING", "repeating"],
  ];

  for (const [anilist, db] of pairs) {
    assert.equal(toDbStatus(anilist), db);
    assert.equal(toDbStatus(db), db);
    assert.equal(toAnilistStatus(db), anilist);
  }
});

test("guest: set status, read it back, and remove", async () => {
  const storage = createMemoryStorage();
  const ctx = { userId: null, client: null, storage };

  assert.equal(await setListStatus({ snapshot: media, status: "CURRENT", progress: 3 }, ctx), true);
  assert.deepEqual((await getListStatus(101, ctx))?.status, "watching");
  assert.equal((await getListStatus(101, ctx))?.progress, 3);

  assert.equal(await removeFromList(101, ctx), true);
  assert.equal(await getListStatus(101, ctx), null);
});

test("COMPLETED stores the media episode count as progress", async () => {
  const storage = createMemoryStorage();
  const ctx = { userId: null, client: null, storage };

  await setListStatus({ snapshot: media, status: "COMPLETED", progress: 2, totalEpisodes: 28 }, ctx);

  assert.equal((await getListStatus(101, ctx))?.progress, 28);
});

test("signed in: counts and grouping come from the watchlist table", async () => {
  const client = new FakeSupabaseClient();
  const storage = createMemoryStorage();
  const ctx = { userId: "user-1", client, storage };

  await setListStatus({ snapshot: media, status: "CURRENT" }, ctx);
  await setListStatus({
    snapshot: { ...media, id: 202 },
    status: "PLANNING",
  }, ctx);
  await setListStatus({
    snapshot: { ...media, id: 303 },
    status: "COMPLETED",
    totalEpisodes: 12,
  }, ctx);

  assert.equal(client.rows("watchlist").length, 3);
  assert.equal(client.rows("watchlist")[0].status, "watching");

  const counts = await getListCounts(ctx);
  assert.deepEqual(
    { all: counts.all, watching: counts.watching, planning: counts.planning, completed: counts.completed },
    { all: 3, watching: 1, planning: 1, completed: 1 },
  );

  const grouped = await listByStatus(ctx);
  assert.equal(grouped.watching[0].id, 101);
  assert.equal(grouped.completed[0].progress, 12);
});
