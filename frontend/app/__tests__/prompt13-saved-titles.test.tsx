import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { click, flush, render, type RenderedTree } from "../../test-harness/render";
import { FakeSupabaseClient } from "../../test-harness/fake-supabase";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import MediasContainer from "@/app/my-lists/components/MediasContainer";
import PlaylistItemsResults from "@/app/favourites/components/PlaylistItemsResults";
import { Button as AddToFavouritesButton } from "@/app/components/Buttons/AddToFavourites";
import { __setDefaultContextForTests, clearSessionCache } from "@/app/lib/user-data/context";
import { normaliseSnapshot, normaliseTitle } from "@/app/lib/user-data/normalise";
import { displayTitle } from "@/app/lib/titles";

const FRIEREN = {
  english: "Frieren: Beyond Journey's End",
  romaji: "Sousou no Frieren",
  native: "葬送のフリーレン",
  userPreferred: "Sousou no Frieren",
};

const ZOM = {
  english: "Zom 100: Bucket List of the Dead",
  romaji: "Zom 100: Zombie ni Naru made ni Shinitakunai",
  native: "ゾン100〜ゾンビになるまでにしたい100のこと〜",
  userPreferred: "Zom 100: Zombie ni Naru made ni Shinitakunai",
};

const ROOT = join(import.meta.dirname, "..", "..");
const mounted: RenderedTree[] = [];

async function mount(ui: React.ReactElement) {
  const tree = await render(ui);
  mounted.push(tree);
  return tree;
}

function store() {
  return configureStore({
    reducer: {
      UserInfo: (state: unknown = { value: null }) => state,
      ShowLoginModal: (state: unknown = { value: false }) => state,
    },
  });
}

type Globals = { __commentsTestAuth?: unknown; __commentsTestClient?: unknown };
const globals = globalThis as unknown as Globals;

function signedIn(client: unknown) {
  globals.__commentsTestAuth = {
    user: { id: "user-1" },
    profile: { id: "user-1", username: "kumori" },
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
  globals.__commentsTestClient = client;
  __setDefaultContextForTests({
    userId: "user-1",
    client,
    storage: window.localStorage,
    now: () => Date.now(),
  } as never);
  clearSessionCache();
}

function snapshotOf(id: number, title: typeof FRIEREN, format = "TV") {
  return {
    id,
    title,
    format,
    description: `${title.english} description`,
    coverImage: {
      large: `https://example.test/${id}-l.jpg`,
      extraLarge: `https://example.test/${id}-xl.jpg`,
    },
  };
}

test.beforeEach(() => {
  window.localStorage.clear();
  __setDefaultContextForTests(null);
});

test.afterEach(async () => {
  while (mounted.length) {
    const tree = mounted.pop()!;
    await tree.unmount();
  }
  __setDefaultContextForTests(null);
});

// -------------------------------------------------------------------- my lists

test("my lists renders stored snapshots with their english title", async () => {
  // A row saved before this rule: userPreferred still holds the romaji title.
  const client = new FakeSupabaseClient({
    watchlist: [
      {
        user_id: "user-1",
        anilist_id: 154587,
        status: "watching",
        progress: 7,
        snapshot: snapshotOf(154587, FRIEREN),
        updated_at: "2026-10-01T10:00:00.000Z",
      },
    ],
  });
  signedIn(client);

  const tree = await mount(
    <Provider store={store()}>
      <MediasContainer mediaFetched={undefined} />
    </Provider>,
  );

  await flush();
  await flush();
  const text = tree.container.textContent ?? "";

  assert.match(text, /Frieren: Beyond Journey's End/);
  assert.equal(text.includes("Sousou no Frieren"), false, "the romaji title must not be shown");
});

test("my lists keeps the stored romaji userPreferred working through displayTitle", async () => {
  const legacyTitles = [
    { ...FRIEREN, userPreferred: FRIEREN.romaji },
    { ...ZOM, userPreferred: ZOM.romaji },
  ];

  const client = new FakeSupabaseClient({
    watchlist: legacyTitles.map((title, index) => ({
      user_id: "user-1",
      anilist_id: 100 + index,
      status: "watching",
      progress: 1,
      snapshot: snapshotOf(100 + index, title),
      updated_at: `2026-10-0${index + 1}T10:00:00.000Z`,
    })),
  });
  signedIn(client);

  const tree = await mount(
    <Provider store={store()}>
      <MediasContainer mediaFetched={undefined} />
    </Provider>,
  );

  await flush();
  await flush();
  const text = tree.container.textContent ?? "";

  assert.match(text, /Frieren: Beyond Journey's End/);
  assert.match(text, /Zom 100: Bucket List of the Dead/);
  assert.equal(text.includes("Sousou no Frieren"), false);
});

// ------------------------------------------------------------------ favourites

test("favourites renders english titles from legacy snapshots", async () => {
  const client = new FakeSupabaseClient({
    favourites: [
      { user_id: "user-1", anilist_id: 154587, snapshot: snapshotOf(154587, FRIEREN), created_at: "2026-10-01T10:00:00.000Z" },
      { user_id: "user-1", anilist_id: 100, snapshot: snapshotOf(100, ZOM), created_at: "2026-10-02T10:00:00.000Z" },
    ],
  });
  signedIn(client);

  const tree = await mount(
    <Provider store={store()}>
      <PlaylistItemsResults params={{ format: "TV", sort: "title_asc" }} />
    </Provider>,
  );

  await flush();
  await flush();
  await flush();
  await flush();
  const text = tree.container.textContent ?? "";

  assert.match(text, /Frieren: Beyond Journey's End/);
  assert.match(text, /Zom 100: Bucket List of the Dead/);
  assert.equal(text.includes("Sousou no Frieren"), false);
});

const FORMAT_TAGS = /^(ANIME|MANGA|TV|MOVIE|SPECIAL|OVA|ONA|MUSIC)$/;

function listedTitles(container: HTMLElement) {
  return [...container.querySelectorAll("a")]
    .map((anchor) => anchor.textContent?.trim() ?? "")
    .filter((text) => text.length > 0 && !FORMAT_TAGS.test(text));
}

test("favourites sorts by the displayed english title, case-insensitively", async () => {
  // "frieren" starts lowercase on purpose: sorting the romaji titles would put
  // "Zom 100 ..." first, and sorting case-sensitively would put it first too.
  const lowerFrieren = { ...FRIEREN, english: "frieren: beyond journey's end" };
  const client = new FakeSupabaseClient({
    favourites: [
      { user_id: "user-1", anilist_id: 154587, snapshot: snapshotOf(154587, lowerFrieren), created_at: "2026-10-01T10:00:00.000Z" },
      { user_id: "user-1", anilist_id: 100, snapshot: snapshotOf(100, ZOM), created_at: "2026-10-02T10:00:00.000Z" },
    ],
  });
  signedIn(client);

  const ascending = await mount(
    <Provider store={store()}>
      <PlaylistItemsResults params={{ format: "TV", sort: "title_asc" }} />
    </Provider>,
  );
  await flush();
  await flush();
  const ascendingTitles = listedTitles(ascending.container);

  assert.deepEqual(ascendingTitles, [
    "frieren: beyond journey's end",
    "Zom 100: Bucket List of the Dead",
  ]);

  await ascending.unmount();
  mounted.pop();

  const descending = await mount(
    <Provider store={store()}>
      <PlaylistItemsResults params={{ format: "TV", sort: "title_desc" }} />
    </Provider>,
  );

  await flush();
  await flush();
  assert.deepEqual(listedTitles(descending.container), [
    "Zom 100: Bucket List of the Dead",
    "frieren: beyond journey's end",
  ]);
});

// ------------------------------------------------------------ snapshot writers

test("normalise keeps all three title fields and defaults userPreferred to english", () => {
  const title = normaliseTitle(FRIEREN);

  assert.equal(title.english, FRIEREN.english);
  assert.equal(title.romaji, FRIEREN.romaji);
  assert.equal(title.native, FRIEREN.native);
  assert.equal(title.userPreferred, FRIEREN.english);

  // A plain string (very old rows) still works.
  assert.deepEqual(normaliseTitle("One Piece"), { romaji: "One Piece", userPreferred: "One Piece" });

  // Whitespace-only fields fall through the chain.
  const blanks = normaliseTitle({ english: "  ", romaji: "Sousou no Frieren", native: null, userPreferred: null });
  assert.equal(blanks.userPreferred, "Sousou no Frieren");
});

test("normaliseSnapshot builds a userPreferred from displayTitle", () => {
  const snapshot = normaliseSnapshot({
    id: 154587,
    title: FRIEREN,
    format: "TV",
    description: "x",
    coverImage: { large: "l.jpg", extraLarge: "xl.jpg" },
  });

  assert.ok(snapshot);
  assert.equal(snapshot.title.userPreferred, FRIEREN.english);
  assert.equal(snapshot.title.romaji, FRIEREN.romaji);
  assert.equal(snapshot.title.native, FRIEREN.native);
});

test("AddToFavourites writes a snapshot whose userPreferred is the english title", async () => {
  const client = new FakeSupabaseClient({ favourites: [] });
  signedIn(client);

  const mediaInfo = {
    id: 154587,
    title: FRIEREN,
    format: "TV",
    type: "ANIME",
    description: "A journey after the journey.",
    coverImage: { large: "https://example.test/l.jpg", extraLarge: "https://example.test/xl.jpg" },
  };

  const tree = await mount(
    <Provider store={store()}>
      <AddToFavouritesButton mediaInfo={mediaInfo as never} />
    </Provider>,
  );

  const button = tree.container.querySelector("button");
  assert.ok(button, `the favourite button renders (${tree.container.innerHTML.slice(0, 300)})`);

  await click(button);

  const row = client.tables.favourites[0] as { snapshot?: { title?: Record<string, string> } } | undefined;

  assert.ok(row?.snapshot?.title, "a favourites row was written");
  assert.equal(row.snapshot.title.userPreferred, FRIEREN.english);
  assert.equal(row.snapshot.title.romaji, FRIEREN.romaji);
  assert.equal(row.snapshot.title.native, FRIEREN.native);
});

test("every snapshot builder sets userPreferred through displayTitle", () => {
  const builders = [
    "app/components/Buttons/AddToFavourites/index.tsx",
    "app/components/Buttons/AddToList/index.tsx",
    "app/components/MediaCards/MediaCard/MediaActionOptionsButton/OptionsPanel/index.tsx",
    "app/lib/user-data/normalise.ts",
  ];

  for (const path of builders) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.match(source, /userPreferred:\s*displayTitle\(/, `${path} must build userPreferred with displayTitle`);
  }
});
