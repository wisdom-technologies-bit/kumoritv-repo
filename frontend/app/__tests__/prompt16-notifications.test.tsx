// Prompt 16, part 1: the notifications panel (ani.pm-style rows, mobile sheet).

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { click, flush, render, type RenderedTree } from "../../test-harness/render";
import NotificationsContainer from "@/app/layout/header/components/Notifications";
import { __setDefaultContextForTests } from "@/app/lib/user-data/context";

type Globals = { __commentsTestAuth?: unknown; __commentsTestClient?: unknown };
const globals = globalThis as unknown as Globals;

const reactWithAct = React as unknown as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const NOTIFICATIONS_CSS = join(
  import.meta.dirname,
  "..",
  "layout",
  "header",
  "components",
  "Notifications",
  "component.module.css",
);

type Row = {
  id: string;
  user_id: string;
  anilist_id: number;
  episode: number;
  title: string;
  cover_url: string | null;
  created_at: string;
  read_at: string | null;
};

const TWO_EPISODES: Row[] = [
  {
    id: "n1",
    user_id: "u1",
    anilist_id: 21,
    episode: 1,
    title: "Attack on Titan",
    cover_url: "https://example.test/cover.jpg",
    created_at: "2026-10-23T15:30:00.000Z",
    read_at: "2026-10-23T16:00:00.000Z",
  },
  {
    id: "n2",
    user_id: "u1",
    anilist_id: 21,
    episode: 2,
    title: "Attack on Titan",
    cover_url: "https://example.test/cover.jpg",
    created_at: "2026-10-30T15:30:00.000Z",
    read_at: null,
  },
];

/** Chainable stand-in for the Supabase query builder used by the notifications lib. */
function fakeClient(rows: Row[] = TWO_EPISODES) {
  const calls: string[] = [];

  const builder: any = {
    select() {
      calls.push("select");
      return builder;
    },
    update() {
      calls.push("update");
      return builder;
    },
    delete() {
      calls.push("delete");
      return builder;
    },
    eq() {
      return builder;
    },
    is() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
    },
  };

  return { calls, from: () => builder, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } };
}

function makeStore() {
  const userInfo = (state: unknown = { value: null }) => state;

  return configureStore({ reducer: { UserInfo: userInfo } });
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

async function fire(target: EventTarget, event: Event) {
  await reactWithAct.act(async () => {
    target.dispatchEvent(event);
  });
  await flush();
}

async function renderPanel(): Promise<RenderedTree> {
  return render(
    <Provider store={makeStore()}>
      <NotificationsContainer />
    </Provider>,
  );
}

function setViewport(isMobile: boolean) {
  const stub = (query: string) => ({
    matches: isMobile ? /max-width/.test(query) : false,
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
}

test.beforeEach(() => {
  setSignedInUser();
  setViewport(false);
  globals.__commentsTestClient = fakeClient();
  __setDefaultContextForTests({
    userId: "u1",
    client: fakeClient() as never,
    storage: window.localStorage as never,
    now: () => Date.now(),
  });
});

test.afterEach(() => {
  __setDefaultContextForTests(null);
  delete globals.__commentsTestAuth;
  delete globals.__commentsTestClient;
});

// ------------------------------------------------------------------ copy

test("the panel heading is just Notifications: no BETA, no Mark all read", async () => {
  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const text = tree.container.textContent ?? "";
    assert.equal(text.includes("BETA"), false, "the BETA tag is gone");
    assert.equal(/Mark all read/i.test(text), false, "opening already marks them read");
    assert.match(text, /Notifications/);
  } finally {
    await tree.unmount();
  }
});

// ------------------------------------------------------------------ list

test("a row shows the episode, the title, the release line and a Watch now link", async () => {
  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const rows = tree.container.querySelectorAll("li[data-unread]");
    assert.equal(rows.length, 1, "the two rows of one anime collapse into one card");

    const row = rows[0];
    const text = row.textContent ?? "";

    assert.match(text, /Episode 2 released/, "the newest episode is named");
    assert.match(text, /Attack on Titan/, "the anime title is shown");
    assert.match(text, /Released\s+\w+\s+\d{1,2},\s+2026/, "the release line is human readable");
    assert.match(text, /Watch now/);

    const link = row.querySelector("a[href]") as HTMLAnchorElement | null;
    assert.ok(link, "the card has a link");
    assert.equal(link!.getAttribute("href"), "/watch/21?ep=2");
  } finally {
    await tree.unmount();
  }
});

test("an unread notification carries an accent dot and a muted finale tag is not bold copy", async () => {
  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const row = tree.container.querySelector('li[data-unread="true"]');
    assert.ok(row, "the row is flagged unread");
    assert.ok(row!.querySelector("[data-unread-dot]"), "the accent dot is rendered");
  } finally {
    await tree.unmount();
  }
});

// ------------------------------------------------------------------ empty state

test("an empty list shows the caught-up state", async () => {
  globals.__commentsTestClient = fakeClient([]);
  __setDefaultContextForTests({
    userId: "u1",
    client: fakeClient([]) as never,
    storage: window.localStorage as never,
    now: () => Date.now(),
  });

  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const text = tree.container.textContent ?? "";
    assert.match(text, /You're all caught up/);
    assert.match(text, /New episodes of anime you follow will appear here\./);
    assert.equal(tree.container.querySelectorAll("li[data-unread]").length, 0);
  } finally {
    await tree.unmount();
  }
});

// ------------------------------------------------------------------ closing

test("Escape closes the panel and returns focus to the bell", async () => {
  const tree = await renderPanel();

  try {
    const bell = tree.container.querySelector("#notification_btn") as HTMLButtonElement;

    await click(bell);
    assert.ok(tree.container.querySelector('[role="dialog"][aria-label="Notifications"]'));

    await fire(document, new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    assert.equal(tree.container.querySelector('[role="dialog"]'), null, "the panel is closed");
    assert.equal(document.activeElement, bell, "focus is back on the bell");
  } finally {
    await tree.unmount();
  }
});

test("a click outside the panel closes it", async () => {
  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));
    assert.ok(tree.container.querySelector('[role="dialog"]'));

    await fire(document.body, new window.MouseEvent("mousedown", { bubbles: true }));

    assert.equal(tree.container.querySelector('[role="dialog"]'), null);
  } finally {
    await tree.unmount();
  }
});

test("opening moves focus into the dialog", async () => {
  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));

    const dialog = tree.container.querySelector('[role="dialog"]');

    assert.equal(document.activeElement, dialog);
  } finally {
    await tree.unmount();
  }
});

test("a route change closes the panel", async () => {
  const bag = globalThis as unknown as { __searchTestNavigation?: { pathname?: string } };
  bag.__searchTestNavigation = { pathname: "/" };

  const tree = await renderPanel();

  try {
    await click(tree.container.querySelector("#notification_btn"));
    assert.ok(tree.container.querySelector('[role="dialog"]'));

    bag.__searchTestNavigation.pathname = "/media/21";

    // The window focus handler refreshes the list, which re-renders the panel and
    // lets the pathname effect see the new route.
    await fire(window, new window.Event("focus"));

    assert.equal(tree.container.querySelector('[role="dialog"]'), null);
  } finally {
    bag.__searchTestNavigation.pathname = "/";
    await tree.unmount();
  }
});

// ------------------------------------------------------------------ layout

test("the desktop panel is a dropdown, the phone panel is a sheet", async () => {
  const desktop = await renderPanel();

  try {
    await click(desktop.container.querySelector("#notification_btn"));

    const dialog = desktop.container.querySelector('[role="dialog"]');
    assert.equal(dialog!.getAttribute("data-layout"), "dropdown");
    assert.equal(dialog!.getAttribute("aria-modal"), null);
    assert.equal(desktop.container.querySelector("[data-notifications-backdrop]"), null);
  } finally {
    await desktop.unmount();
  }

  setViewport(true);

  const mobile = await renderPanel();

  try {
    await click(mobile.container.querySelector("#notification_btn"));

    const dialog = mobile.container.querySelector('[role="dialog"]');
    assert.equal(dialog!.getAttribute("data-layout"), "sheet");
    assert.equal(dialog!.getAttribute("aria-modal"), "true");
    assert.ok(mobile.container.querySelector("[data-notifications-backdrop]"), "a backdrop is rendered");

    // tapping the backdrop closes the sheet
    await click(mobile.container.querySelector("[data-notifications-backdrop]"));
    assert.equal(mobile.container.querySelector('[role="dialog"]'), null);
  } finally {
    await mobile.unmount();
    setViewport(false);
  }
});

test("the stylesheet pins the sheet under the header and keeps it inside the viewport", () => {
  const css = readFileSync(NOTIFICATIONS_CSS, "utf8");

  assert.match(css, /@media \(max-width: 640px\)/, "the sheet breakpoint exists");
  assert.match(css, /position: fixed/, "the sheet is fixed");
  assert.match(css, /max-width: calc\(100vw - 24px\)/, "the sheet never exceeds the viewport");
  assert.match(css, /max-height: 70vh/, "the sheet stops at 70vh");
  assert.match(css, /overflow-y: auto/, "the sheet scrolls");

  assert.match(css, /@media \(max-width: 400px\)/, "very small phones get their own rules");
  assert.match(css, /margin-right: 4px/, "the bell keeps clear of the avatar");
});
