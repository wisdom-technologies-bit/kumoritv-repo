import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import { createMemoryStorage } from "../storage";
import {
  deleteNotification,
  groupNotifications,
  isSubscribed,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribe,
  unsubscribe,
} from "../notifications";

const media = {
  id: 42,
  title: { romaji: "Dandadan" },
  format: "TV",
  description: "",
  coverImage: { extraLarge: "xl.jpg", large: "l.jpg" },
};

function signedIn() {
  const client = new FakeSupabaseClient();
  const ctx = { userId: "user-1", client, storage: createMemoryStorage() };
  return { client, ctx };
}

test("guest cannot subscribe", async () => {
  const ctx = { userId: null, client: null, storage: createMemoryStorage() };
  assert.equal(await subscribe(media, ctx), false);
  assert.equal(await isSubscribed(42, ctx), false);
  assert.deepEqual(await listNotifications(ctx), { items: [], unreadCount: 0, rows: [] });
});

test("subscribe, check and unsubscribe", async () => {
  const { client, ctx } = signedIn();

  assert.equal(await subscribe(media, ctx), true);
  assert.equal(client.rows("notification_subscriptions").length, 1);
  assert.equal(await isSubscribed(42, ctx), true);

  assert.equal(await unsubscribe(42, ctx), true);
  assert.equal(await isSubscribed(42, ctx), false);
});

test("lists notifications newest first with the unread badge count", async () => {
  const { client, ctx } = signedIn();

  client.tables.notifications = [
    { id: "n1", user_id: "user-1", anilist_id: 42, episode: 1, title: "Dandadan", cover_url: "c.jpg", created_at: "2026-10-01T10:00:00.000Z", read_at: "2026-10-01T11:00:00.000Z" },
    { id: "n2", user_id: "user-1", anilist_id: 42, episode: 2, title: "Dandadan", cover_url: "c.jpg", created_at: "2026-10-08T10:00:00.000Z", read_at: null },
    { id: "n3", user_id: "user-1", anilist_id: 7, episode: 5, title: "Other", cover_url: "o.jpg", created_at: "2026-10-09T10:00:00.000Z", read_at: null },
  ];

  const result = await listNotifications(ctx);

  assert.equal(result.rows.length, 3);
  assert.equal(result.unreadCount, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].mediaId, "7");
  assert.equal(result.items[1].mediaId, "42");
  // episodes are kept ascending inside a group
  assert.deepEqual(result.items[1].episodes.map((episode) => episode.number), [1, 2]);
  assert.equal(result.items[1].title.romaji, "Dandadan");
});

test("mark one, mark all and delete", async () => {
  const { client, ctx } = signedIn();

  client.tables.notifications = [
    { id: "n1", user_id: "user-1", anilist_id: 42, episode: 1, title: "A", cover_url: null, created_at: "2026-10-01T10:00:00.000Z", read_at: null },
    { id: "n2", user_id: "user-1", anilist_id: 42, episode: 2, title: "A", cover_url: null, created_at: "2026-10-02T10:00:00.000Z", read_at: null },
  ];

  assert.equal(await markNotificationRead("n1", ctx), true);
  assert.equal((await listNotifications(ctx)).unreadCount, 1);

  assert.equal(await markAllNotificationsRead(ctx), true);
  assert.equal((await listNotifications(ctx)).unreadCount, 0);

  assert.equal(await deleteNotification("n2", ctx), true);
  assert.equal((await listNotifications(ctx)).rows.length, 1);
});

test("grouping keeps the highest episode as the panel headline", () => {
  const views = groupNotifications([
    { id: "b", user_id: "u", anilist_id: 3, episode: 9, title: "Show", cover_url: null, created_at: "2026-10-02T10:00:00.000Z", read_at: null },
    { id: "a", user_id: "u", anilist_id: 3, episode: 8, title: "Show", cover_url: null, created_at: "2026-10-01T10:00:00.000Z", read_at: null },
  ] as any);

  assert.equal(views.length, 1);
  assert.equal(views[0].episodes[views[0].episodes.length - 1].number, 9);
});
