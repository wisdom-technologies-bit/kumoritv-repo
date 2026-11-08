import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, flush, render, type RenderedTree } from "../../test-harness/render";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { FakeSupabaseClient } from "../../test-harness/fake-supabase";
import * as MediaCard from "@/app/components/MediaCards/MediaCard";
import KeepWatchingEpisodeInfo from "@/app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo";
import MediaRelatedContainer from "@/app/media/[id]/components/MediaRelatedContainer";
import HeadingTextAndMediaLogo from "@/app/media/[id]/components/PageHeading/HeadingInfo/MediaTitleOrLogo";
import PlayBtn from "@/app/media/[id]/components/WatchPlayBtn";
import ResultsContainer from "@/app/search/components/ResultsContainer";
import NotificationsContainer from "@/app/layout/header/components/Notifications";
import { searchCatalog } from "@/app/lib/anilist/medias.server";
import { __resetProgressSyncForTests } from "@/app/lib/user-data/progress";
import { __setDefaultContextForTests, clearSessionCache } from "@/app/lib/user-data/context";

// The regression fixture: english, romaji and native all differ, and AniList's
// anonymous `userPreferred` is the romaji title.
const TITLE = {
  english: "Frieren: Beyond Journey's End",
  romaji: "Sousou no Frieren",
  native: "葬送のフリーレン",
  userPreferred: "Sousou no Frieren",
};

const ENGLISH = TITLE.english;
const ROMAJI = TITLE.romaji;
const NATIVE = TITLE.native;

const MEDIA = {
  id: 154587,
  title: TITLE,
  format: "TV",
  type: "ANIME",
  status: "FINISHED",
  description: "A journey after the journey.",
  episodes: 28,
  duration: 24,
  chapters: null,
  volumes: null,
  source: "MANGA",
  coverImage: { large: "https://example.test/frieren.jpg", extraLarge: "https://example.test/frieren-xl.jpg" },
  bannerImage: null,
  genres: ["Adventure"],
  seasonYear: 2023,
  startDate: { year: 2023, month: 9, day: 29 },
  endDate: { year: 2024, month: 3, day: 22 },
  nextAiringEpisode: null,
  mediaListEntry: null,
  relations: { edges: [] },
  externalLinks: [],
  streamingEpisodes: [],
} as never;

const ANILIST_CATALOG_ITEM = {
  id: 154587,
  title: TITLE,
  coverImage: { large: "https://example.test/frieren.jpg", extraLarge: "https://example.test/frieren-xl.jpg" },
  genres: ["Adventure"],
  format: "TV",
  type: "ANIME",
  season: "FALL",
  seasonYear: 2023,
};

type Globals = { __commentsTestClient?: unknown; __commentsTestAuth?: unknown };
const globals = globalThis as unknown as Globals;

function setSignedIn(client: unknown) {
  // `resolveSessionUserId` asks the injected fake client for its session, so the
  // signed-in path is presented through the context seam instead.
  __setDefaultContextForTests({
    userId: "user-1",
    client,
    storage: window.localStorage,
    now: () => Date.now(),
  } as never);
  clearSessionCache();
  globals.__commentsTestAuth = {
    user: { id: "user-1" },
    profile: { id: "user-1", username: "kumori" },
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
}

function setGuest() {
  __setDefaultContextForTests(null);
  globals.__commentsTestAuth = { user: null, profile: null, isAnonymous: false, loading: false, signOut: async () => {} };
  globals.__commentsTestClient = null;
}

const mounted: RenderedTree[] = [];

async function mount(ui: React.ReactElement) {
  const tree = await render(ui);
  mounted.push(tree);
  return tree;
}

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

test.beforeEach(() => {
  window.localStorage.clear();
  __resetProgressSyncForTests();
  setGuest();
  console.error = () => {};
});

test.afterEach(async () => {
  while (mounted.length) {
    const tree = mounted.pop()!;
    await tree.unmount();
  }
  __setDefaultContextForTests(null);
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

function assertNoRomaji(haystack: string, where: string) {
  assert.equal(haystack.includes(ROMAJI), false, `${where} must not show the romaji title`);
}

// ---------------------------------------------------------------- media cards

test("MediaCard shows the english title", async () => {
  const tree = await mount(
    <MediaCard.Container onDarkMode>
      <MediaCard.MediaImgLink
        hideOptionsButton
        mediaInfo={MEDIA}
        title={ENGLISH}
        formatOrType="TV"
        url="https://example.test/frieren.jpg"
        mediaId="154587"
      />
      <MediaCard.LinkTitle title={ENGLISH} anilistId="154587" />
    </MediaCard.Container>,
  );

  const text = tree.container.textContent ?? "";

  assert.match(text, /Frieren: Beyond Journey's End/);
  assertNoRomaji(text, "the media card");
  // The card's own alt text is prefixed, but the title inside it is the english one.
  assert.match(tree.container.querySelector("img")?.getAttribute("alt") ?? "", /Cover Art for Frieren: Beyond Journey's End/);

  await tree.unmount();
});

// ---------------------------------------------------------- search page chain

test("the search page renders english titles end to end", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: { Page: { pageInfo: { total: 1 }, media: [ANILIST_CATALOG_ITEM] } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  // 1) the server mapping (/search/page.tsx -> searchCatalog)
  const catalog = await searchCatalog({ title: "frieren" });

  assert.equal(catalog.results[0].title, ENGLISH);

  // 2) what ResultsContainer paints from it
  const tree = await mount(<ResultsContainer mediasList={catalog.results} totalLength={catalog.allResultsLength} />);
  const text = tree.container.textContent ?? "";

  assert.match(text, /Frieren: Beyond Journey's End/);
  assertNoRomaji(text, "the search results");
  assert.match(tree.container.querySelector("img")?.getAttribute("alt") ?? "", /Cover Art for Frieren: Beyond Journey's End/);

  await tree.unmount();
});

test("the search page sorts out a romaji userPreferred coming from AniList", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          Page: {
            pageInfo: { total: 1 },
            // AniList's anonymous shape: userPreferred is the romaji title.
            media: [{ ...ANILIST_CATALOG_ITEM, title: { english: null, romaji: ROMAJI, native: NATIVE, userPreferred: ROMAJI } }],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const catalog = await searchCatalog({ title: "frieren" });

  // No english title exists, so the display rule falls back to romaji, never to
  // "whatever userPreferred happened to hold".
  assert.equal(catalog.results[0].title, ROMAJI);

  const tree = await mount(<ResultsContainer mediasList={catalog.results} totalLength={1} />);

  assert.match(tree.container.textContent ?? "", /Sousou no Frieren/);

  await tree.unmount();
});

// --------------------------------------------------------------- keep watching

test("keep watching shows the english title on the link, the remove button and the poster", async () => {
  const animeInfo = {
    id: 154587,
    title: TITLE,
    format: "TV",
    episode: 7,
    episodeImg: "https://example.test/ep7.jpg",
    episodeDuration: 1440,
    episodeTimeLastStop: 300,
  } as never;

  const tree = await mount(<KeepWatchingEpisodeInfo animeInfo={animeInfo} deleteFromListHook={() => {}} />);
  const text = tree.container.textContent ?? "";

  assert.match(text, /Frieren: Beyond Journey's End/);
  assertNoRomaji(text, "the keep watching row");

  const poster = tree.container.querySelector("img");
  assert.equal(poster?.getAttribute("alt"), ENGLISH);
  assert.equal(poster?.getAttribute("title"), ENGLISH);

  const remove = tree.container.querySelector("button");
  assert.match(remove?.getAttribute("title") ?? "", new RegExp(`Remove ${ENGLISH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} from`));

  await tree.unmount();
});

// -------------------------------------------------------------------- related

test("the related row shows english titles", async () => {
  const tree = await mount(<MediaRelatedContainer mediaList={[MEDIA] as never} />);
  const text = tree.container.textContent ?? "";

  assertNoRomaji(text, "the related row");

  await tree.unmount();
});

// -------------------------------------------------------------- media heading

test("the media heading is the english title with the native title above it", async () => {
  const tree = await mount(<HeadingTextAndMediaLogo imdbMediaLogos={undefined} mediaTitles={TITLE as never} />);
  const heading = tree.container.querySelector("h1");
  const small = tree.container.querySelector("small");

  // Prompt 25 stopped forcing `.toUpperCase()` on the string: the DOM keeps the
  // natural title (better for snippets and screen readers) and casing is a CSS
  // decision. The native line above the heading is unchanged.
  assert.equal(heading?.textContent, ENGLISH);
  assert.equal(small?.textContent, NATIVE);

  await tree.unmount();
});

test("the media heading hides a secondary line that would repeat the heading", async () => {
  const tree = await mount(
    <HeadingTextAndMediaLogo imdbMediaLogos={undefined} mediaTitles={{ romaji: ROMAJI, native: "", english: "" } as never} />,
  );

  assert.equal(tree.container.querySelector("h1")?.textContent, ROMAJI);
  assert.equal(tree.container.querySelector("small"), null);

  await tree.unmount();
});

test("the logo variant keeps the english title as the image alt", async () => {
  const tree = await mount(
    <HeadingTextAndMediaLogo
      imdbMediaLogos={[{ url: "https://example.test/logo.png", aspectRatio: 3 }] as never}
      mediaTitles={TITLE as never}
    />,
  );

  assert.equal(tree.container.querySelector("h1")?.textContent, ENGLISH);
  assert.equal(tree.container.querySelector("img")?.getAttribute("alt"), ENGLISH);

  await tree.unmount();
});

// ------------------------------------------------------------- grid info tile

test("the play button labels the episode in english", async () => {
  // Prompt 25 moved the play pill out of the info strip and into the hero
  // actions row, so the button is mounted directly instead of through the tile.
  const tree = await mount(
    <PlayBtn mediaId={154587} mediaTitle={ENGLISH} mediaFormat="TV" mediaEpisodes={28} />,
  );
  const button = tree.container.querySelector<HTMLButtonElement>("li.action_btn button");

  assert.ok(button, "the action button renders");
  assert.equal(button.getAttribute("title"), `Watch ${ENGLISH}`);
  assert.equal(button.getAttribute("aria-label"), "Watch Episode 1");
  assertNoRomaji(JSON.stringify([...tree.container.querySelectorAll("[title]")].map((el) => el.getAttribute("title"))), "the play titles");

  await tree.unmount();
});

// -------------------------------------------------------------- notifications

test("notification rows render with displayTitle applied", async () => {
  const client = new FakeSupabaseClient({
    notifications: [
      {
        id: "n-1",
        user_id: "user-1",
        anilist_id: 154587,
        episode: 7,
        // Fanout rows carry the title object; older ones carry a plain string.
        title: { english: ENGLISH, romaji: ROMAJI, native: NATIVE, userPreferred: ROMAJI },
        cover_url: "https://example.test/frieren.jpg",
        created_at: "2026-10-20T10:00:00.000Z",
        read_at: null,
      },
    ],
  });
  setSignedIn(client);
  globals.__commentsTestClient = client;

  const store = configureStore({
    reducer: {
      UserInfo: (state: unknown = { value: null }) => state,
      ShowLoginModal: (state: unknown = { value: false }) => state,
    },
  });

  const tree = await mount(
    <Provider store={store}>
      <NotificationsContainer />
    </Provider>,
  );
  const button = tree.container.querySelector("button");

  assert.ok(button, "the bell renders");
  await click(button);
  await flush();

  const text = tree.container.textContent ?? "";
  assert.match(text, /Frieren: Beyond Journey's End/);
  assertNoRomaji(text, "the notifications panel");

  await tree.unmount();
});
