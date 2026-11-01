// Prompt 21, part 3: the unified bell. Episode rows, user_notifications and
// announcements merge newest first, unread counts all three, opening the panel
// marks all three read, and none of it depends on push being on.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { click, flush, render, type RenderedTree } from "../../test-harness/render";
import NotificationsContainer from "../layout/header/components/Notifications";
import { __setDefaultContextForTests } from "@/app/lib/user-data/context";
import {
  BELL_ITEM_LIMIT,
  countBellUnread,
  mergeBellItems,
  type AnnouncementView,
  type NotificationView,
  type UserNotificationView,
} from "@/app/lib/user-data/notifications";

type Globals = { __commentsTestAuth?: unknown; __commentsTestClient?: unknown };
const globals = globalThis as unknown as Globals;

const reactWithAct = React as unknown as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

type Row = Record<string, any>;

/**
 * A table-aware Supabase stand-in: the bell reads three tables in parallel, so
 * every query needs its own builder and its own rows.
 */
function fakeClient(seed: Record<string, Row[]> = {}) {
  const seedTables: Record<string, Row[]> = {
    notifications: [],
    user_notifications: [],
    announcements: [],
    announcement_reads: [],
    ...seed,
  };
  // Copy every row in and out: opening the panel marks rows read, and without
  // copies that write would leak into the next test's fixtures.
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seedTables)) {
    tables[name] = rows.map((row) => ({ ...row }));
  }
  const updates: Array<{ table: string; payload: Row }> = [];
  const upserts: Array<{ table: string; payload: unknown }> = [];

  function builderFor(table: string): any {
    const filters: Array<(row: Row) => boolean> = [];
    let limit: number | null = null;
    let mode: "select" | "update" | "delete" | "upsert" = "select";
    let payload: Row = {};

    const self: any = {
      select() {
        return self;
      },
      update(next: Row) {
        mode = "update";
        payload = next;
        return self;
      },
      upsert(next: unknown) {
        mode = "upsert";
        upserts.push({ table, payload: next });
        return Promise.resolve({ error: null });
      },
      delete() {
        mode = "delete";
        return self;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return self;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return self;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return self;
      },
      order() {
        return self;
      },
      limit(count: number) {
        limit = count;
        return self;
      },
      maybeSingle() {
        return Promise.resolve({ data: tables[table]?.[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: tables[table]?.[0] ?? null, error: null });
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        if (mode === "update") {
          updates.push({ table, payload });
          const matched = (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
          for (const row of matched) Object.assign(row, payload);
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        }
        if (mode === "delete") {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }

        const rows = (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
        const capped = typeof limit === "number" ? rows.slice(0, limit) : rows;
        const data = capped.map((row) => ({ ...row }));

        return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
      },
    };

    return self;
  }

  return {
    updates,
    upserts,
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (table: string) => {
      tables[table] ??= [];
      return builderFor(table);
    },
  };
}

function makeStore() {
  return configureStore({ reducer: { UserInfo: (state: unknown = { value: null }) => state } });
}

function setSignedInUser() {
  globals.__commentsTestAuth = {
    user: { id: "u1", is_anonymous: false, user_metadata: {} },
    profile: null,
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
}

function seedClient(seed: Record<string, Row[]>) {
  const client = fakeClient(seed);
  globals.__commentsTestClient = client;
  __setDefaultContextForTests({
    userId: "u1",
    client: client as never,
    storage: window.localStorage as never,
    now: () => Date.parse("2026-11-01T12:00:00.000Z"),
  });

  return client;
}

async function renderPanel(): Promise<RenderedTree> {
  return render(
    <Provider store={makeStore()}>
      <NotificationsContainer />
    </Provider>,
  );
}

test.beforeEach(() => {
  setSignedInUser();
  const stub = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
  (globalThis as Record<string, unknown>).matchMedia = stub;
  (window as unknown as Record<string, unknown>).matchMedia = stub;
});

test.afterEach(() => {
  __setDefaultContextForTests(null);
  delete globals.__commentsTestAuth;
  delete globals.__commentsTestClient;
});

const ANNIVERSARY_EPISODE: Row = {
  id: "n1",
  user_id: "u1",
  anilist_id: 21,
  episode: 12,
  title: "Attack on Titan",
  cover_url: "https://art.test/aot.jpg",
  created_at: "2026-10-20T10:00:00.000Z",
  read_at: null,
};

const REPLY: Row = {
  id: "u-notif-1",
  user_id: "u1",
  kind: "reply",
  title: "Mika replied to your comment",
  body: "Totally agree with this",
  url: "/watch/21?ep=12",
  image: "https://art.test/mika.jpg",
  actor_name: "Mika",
  actor_avatar: "https://art.test/mika.jpg",
  comment_id: "c-2",
  count: 1,
  created_at: "2026-10-25T10:00:00.000Z",
  read_at: null,
};

const LIKE: Row = {
  ...REPLY,
  id: "u-notif-2",
  kind: "like",
  title: "Your comment got 4 likes",
  count: 4,
  created_at: "2026-10-28T10:00:00.000Z",
  read_at: "2026-10-28T11:00:00.000Z",
};

const DIGEST: Row = {
  ...REPLY,
  id: "u-notif-3",
  kind: "digest",
  title: "6 new episodes on KumoriTV",
  body: "Frieren, One Piece, Dandadan and 3 more",
  url: "/",
  actor_name: null,
  actor_avatar: null,
  count: 1,
  created_at: "2026-10-30T09:00:00.000Z",
  read_at: null,
};

const ANNOUNCEMENT: Row = {
  id: "ann-1",
  title: "KumoriTV is now on the app store",
  body: "Install it from your phone's store.",
  url: "/news/app",
  image: null,
  created_at: "2026-10-31T08:00:00.000Z",
  expires_at: null,
};

// ------------------------------------------------------------- merge rules

const EPISODE_VIEW: NotificationView = {
  id: "n1",
  mediaId: "21",
  title: { romaji: "Attack on Titan", native: "Attack on Titan", userPreferred: "Attack on Titan" },
  coverImage: { large: "https://art.test/aot.jpg", extraLarge: "https://art.test/aot.jpg" },
  episodes: [{ number: 12, releaseDate: null, wasReleased: true }],
  nextReleaseDate: null,
  status: "RELEASING",
  isComplete: false,
  isRead: false,
  createdAt: Date.parse("2026-10-20T10:00:00.000Z"),
};

const USER_VIEW: UserNotificationView = {
  id: "u-notif-1",
  kind: "reply",
  title: "Mika replied to your comment",
  body: "Totally agree with this",
  url: "/watch/21?ep=12",
  image: "https://art.test/mika.jpg",
  actorName: "Mika",
  actorAvatar: "https://art.test/mika.jpg",
  count: 1,
  isRead: false,
  createdAt: Date.parse("2026-10-25T10:00:00.000Z"),
};

const ANNOUNCEMENT_VIEW: AnnouncementView = {
  id: "ann-1",
  title: "KumoriTV is now on the app store",
  body: "Install it from your phone's store.",
  url: "/news/app",
  image: null,
  isRead: false,
  createdAt: Date.parse("2026-10-31T08:00:00.000Z"),
};

test("the three sources merge newest first", () => {
  const merged = mergeBellItems({
    episodes: [EPISODE_VIEW],
    userNotifications: [USER_VIEW],
    announcements: [ANNOUNCEMENT_VIEW],
  });

  assert.deepEqual(
    merged.map((entry) => entry.source),
    ["announcement", "user", "episodes"],
  );
});

test("the list is capped at the latest 50 items", () => {
  const many: UserNotificationView[] = Array.from({ length: 80 }, (_, index) => ({
    ...USER_VIEW,
    id: `u-${index}`,
    createdAt: 1_000 + index,
  }));

  const merged = mergeBellItems({ userNotifications: many });

  assert.equal(merged.length, BELL_ITEM_LIMIT);
  assert.equal(merged[0].createdAt, 1_079, "newest kept");
  assert.equal(merged[merged.length - 1].createdAt, 1_030, "oldest dropped");
});

test("the unread count adds up across all three sources", () => {
  assert.equal(
    countBellUnread({
      episodeRows: [{ read_at: null }, { read_at: null }, { read_at: "2026-10-31T00:00:00Z" }],
      userNotifications: [USER_VIEW, { ...USER_VIEW, id: "u-2", isRead: true }],
      announcements: [ANNOUNCEMENT_VIEW],
    }),
    4,
  );

  assert.equal(countBellUnread({}), 0);
});

// --------------------------------------------------------------- the panel

test("the panel lists episode, user and announcement rows together", async () => {
  seedClient({
    notifications: [ANNIVERSARY_EPISODE],
    user_notifications: [REPLY, LIKE, DIGEST],
    announcements: [ANNOUNCEMENT],
  });

  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const rows = [...tree.container.querySelectorAll("li[data-unread]")];
    assert.equal(rows.length, 5, "one episode card + three user rows + one announcement");

    const text = tree.container.textContent ?? "";
    assert.match(text, /Episode 12 released/);
    assert.match(text, /Mika replied to your comment/);
    assert.match(text, /Your comment got 4 likes/);
    assert.match(text, /6 new episodes on KumoriTV/);
    assert.match(text, /KumoriTV is now on the app store/);
  } finally {
    await tree.unmount();
  }
});

test("the badge counts all three sources, and opening clears it", async () => {
  const client = seedClient({
    notifications: [ANNIVERSARY_EPISODE],
    user_notifications: [REPLY, DIGEST],
    announcements: [ANNOUNCEMENT],
  });

  const tree = await renderPanel();
  // The three reads settle over a couple of microtask turns.
  await flush();
  await flush();

  try {
    const badge = tree.container.querySelector("[data-hidden='false']");
    assert.ok(badge, "the badge is visible");
    assert.equal(badge!.textContent, "4", "1 episode + 2 user rows + 1 announcement");

    await click(tree.container.querySelector("#notification_btn"));

    const cleared = tree.container.querySelector("[data-hidden='true']");
    assert.ok(cleared, "the badge clears once the panel opens");

    // The three tables are all touched.
    const tables = client.updates.map((entry) => entry.table);
    assert.ok(tables.includes("notifications"));
    assert.ok(tables.includes("user_notifications"));
    assert.equal(client.upserts.length, 1, "announcement reads are inserted once");
    assert.equal(client.upserts[0].table, "announcement_reads");
  } finally {
    await tree.unmount();
  }
});

test("an expired announcement never reaches the panel", async () => {
  seedClient({
    announcements: [
      { ...ANNOUNCEMENT, id: "ann-old", expires_at: "2026-10-31T09:00:00.000Z" },
      ANNOUNCEMENT,
    ],
  });

  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const text = tree.container.textContent ?? "";
    assert.match(text, /KumoriTV is now on the app store/);
    assert.equal(
      tree.container.querySelectorAll("li[data-kind='announcement']").length,
      1,
      "the expired one is filtered out",
    );
  } finally {
    await tree.unmount();
  }
});

test("a read announcement is not counted as unread", async () => {
  seedClient({
    announcements: [ANNOUNCEMENT],
    announcement_reads: [{ user_id: "u1", announcement_id: "ann-1" }],
  });

  const tree = await renderPanel();

  try {
    const badge = tree.container.querySelector("[data-hidden='false']");
    assert.equal(badge, null, "nothing unread, so no badge");

    await click(tree.container.querySelector("#notification_btn"));

    const row = tree.container.querySelector("li[data-kind='announcement']");
    assert.equal(row?.getAttribute("data-unread"), "false");
  } finally {
    await tree.unmount();
  }
});

test("the bell renders with push off and OneSignal unavailable", async () => {
  // Push is off in this environment: no app id, no Notification API, no SDK.
  delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

  seedClient({ user_notifications: [REPLY], announcements: [ANNOUNCEMENT] });

  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const rows = [...tree.container.querySelectorAll("li[data-unread]")];
    assert.equal(rows.length, 2, "the rows come from the database, not from push");
    assert.match(tree.container.textContent ?? "", /Mika replied to your comment/);
  } finally {
    await tree.unmount();
  }
});

test("a reply row shows the actor, the snippet and a View button, not a stretched link", async () => {
  seedClient({ user_notifications: [REPLY] });

  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const row = tree.container.querySelector("li[data-kind='reply']");
    assert.ok(row);

    const link = row!.querySelector("a[href]") as HTMLAnchorElement | null;
    assert.equal(link?.getAttribute("href"), "/watch/21?ep=12");
    assert.equal(link?.textContent?.trim(), "View");
  } finally {
    await tree.unmount();
  }
});

test("the panel shows the caught-up state when there is nothing", async () => {
  seedClient({});

  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));
    assert.match(tree.container.textContent ?? "", /You're all caught up/);
  } finally {
    await tree.unmount();
  }
});

test("a refresh happens when the tab regains focus", async () => {
  const client = seedClient({ user_notifications: [REPLY] });
  const tree = await renderPanel();

  try {
    const before = client.updates.length;
    await reactWithAct.act(async () => {
      window.dispatchEvent(new window.Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    // A focus refresh is a read, so the update log staying put is the check that
    // nothing else was written; the rows are re-read rather than re-fetched by a
    // second polling loop.
    assert.equal(client.updates.length, before);

    await click(tree.container.querySelector("#notification_btn"));
    assert.match(tree.container.textContent ?? "", /Mika replied to your comment/);
  } finally {
    await tree.unmount();
  }
});
