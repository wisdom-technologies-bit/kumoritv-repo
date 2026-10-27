import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import { createMemoryStorage } from "../storage";
import {
  GUEST_FAVOURITES_KEY,
  addFavourite,
  isFavourite,
  listFavourites,
  removeFavourite,
} from "../favourites";

const media = {
  id: 21,
  title: { romaji: "One Piece", english: "One Piece", native: "ワンピース" },
  format: "TV",
  description: "pirates",
  coverImage: { extraLarge: "xl.jpg", large: "l.jpg" },
};

test("guest: add, list, check and remove favourites locally", async () => {
  const storage = createMemoryStorage();
  const ctx = { userId: null, client: null, storage };

  assert.equal(await addFavourite(media, ctx), true);
  assert.equal(await isFavourite(21, ctx), true);
  assert.equal((await listFavourites(ctx))[0].title.romaji, "One Piece");
  assert.deepEqual(JSON.parse(storage.getItem(GUEST_FAVOURITES_KEY)!)[0].coverImage, {
    extraLarge: "xl.jpg",
    large: "l.jpg",
  });

  assert.equal(await removeFavourite(21, ctx), true);
  assert.equal(await isFavourite(21, ctx), false);
});

test("signed in: writes the favourites table and ignores duplicates", async () => {
  const client = new FakeSupabaseClient();
  const storage = createMemoryStorage();
  const ctx = { userId: "user-1", client, storage };

  assert.equal(await addFavourite(media, ctx), true);
  assert.equal(await addFavourite(media, ctx), true);

  const rows = client.rows("favourites");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, "user-1");
  assert.equal(rows[0].anilist_id, 21);

  const listed = await listFavourites(ctx);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].format, "TV");
});

test("signed in: a failing table falls back to the local copy and rolls back", async () => {
  const client = new FakeSupabaseClient();
  const storage = createMemoryStorage();
  const ctx = { userId: "user-1", client, storage };

  await addFavourite(media, ctx);
  assert.equal((await listFavourites(ctx)).length, 1);

  client.failOn("favourites");
  assert.equal(await removeFavourite(21, ctx), false);

  // removal failed so the favourite is still there, from the cached copy
  const listed = await listFavourites(ctx);
  assert.equal(listed.length, 1);
});
