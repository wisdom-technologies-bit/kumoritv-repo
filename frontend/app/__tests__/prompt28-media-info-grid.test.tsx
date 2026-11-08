// Prompt 28: the /media/[id] facts strip.
//
// The strip used to be a sibling of the hero; it is now handed to HeadingInfo as
// `infoSlot` and rendered once, inside the hero body, directly under the Play
// pill and the round icon buttons. Only the placement and the decoration
// changed: the same facts, in the same order, are rendered under the same
// conditions, and each one gained a decorative icon.
//
// These tests pin that down:
//   - anime / movie / manga render exactly the items and labels they did before
//     (EPISODES still disappears for NOT_YET_RELEASED, a movie still shows
//     SOURCE instead of STATUS);
//   - every icon is aria-hidden and focusable="false", so the label stays the
//     only thing a screen reader announces;
//   - the strip exists exactly once in the DOM, with its `<title> details`
//     aria-label, even when it is rendered through the hero;
//   - no fact is duplicated into a hidden copy.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, type RenderedTree } from "../../test-harness/render";
import GridHeadingMediaInfo from "@/app/media/[id]/components/PageHeading/GridInfo";
import HeadingInfo from "@/app/media/[id]/components/PageHeading/HeadingInfo";

const TITLE = {
  english: "One Piece",
  romaji: "ONE PIECE",
  native: "ワンピース",
  userPreferred: "ONE PIECE",
};

const COVER = {
  large: "https://example.test/cover-large.jpg",
  extraLarge: "https://example.test/cover-xl.jpg",
};

const ANIME = {
  id: 21,
  title: TITLE,
  format: "TV",
  type: "ANIME",
  status: "RELEASING",
  description: "Pirates.",
  episodes: 1180,
  duration: 24,
  chapters: null,
  volumes: null,
  source: "MANGA",
  coverImage: COVER,
  bannerImage: "https://example.test/banner.jpg",
  genres: ["Action", "Adventure"],
  seasonYear: 1999,
  startDate: { year: 1999, month: 10, day: 20 },
  endDate: { year: null, month: null, day: null },
  nextAiringEpisode: { episode: 1181, timeUntilAiring: 3600 },
  mediaListEntry: null,
  relations: { edges: [] },
  externalLinks: [],
  streamingEpisodes: [],
} as never;

const MOVIE = {
  ...(ANIME as Record<string, unknown>),
  id: 1001,
  format: "MOVIE",
  status: "FINISHED",
  episodes: 1,
  duration: 96,
  source: "ORIGINAL",
  nextAiringEpisode: null,
  startDate: { year: 2001, month: 7, day: 20 },
} as never;

const MANGA = {
  ...(ANIME as Record<string, unknown>),
  id: 13,
  type: "MANGA",
  format: "MANGA",
  status: "FINISHED",
  episodes: null,
  duration: null,
  volumes: 108,
  chapters: 1100,
  nextAiringEpisode: null,
  startDate: { year: 1997, month: 7, day: 22 },
} as never;

const BEFORE_RELEASE = {
  ...(ANIME as Record<string, unknown>),
  id: 2002,
  status: "NOT_YET_RELEASED",
  episodes: null,
  nextAiringEpisode: null,
  startDate: { year: 2027, month: 1, day: 8 },
} as never;

const mounted: RenderedTree[] = [];

async function mount(ui: React.ReactElement) {
  const tree = await render(ui);
  mounted.push(tree);
  return tree;
}

test.afterEach(async () => {
  while (mounted.length) {
    const tree = mounted.pop()!;
    await tree.unmount();
  }
});

function store() {
  // the bell button reads the AniList user out of the redux store
  return configureStore({
    reducer: { UserInfo: (state: unknown = { value: null }) => state },
  });
}

/** [label, value] for every item, in DOM order. */
function facts(container: HTMLElement) {
  return [...container.querySelectorAll("li")].map((item) => {
    const label = item.querySelector("span");
    const value = item.querySelector("p");

    return [label ? label.textContent : null, value ? value.textContent : null];
  });
}

function strip(container: HTMLElement) {
  return container.querySelector('section[id="info_list_container"]') as HTMLElement | null;
}

// ------------------------------------------------------------------ the facts

test("an anime keeps STATUS, EPISODES, RELEASE and LENGTH", async () => {
  const { container } = await mount(<GridHeadingMediaInfo mediaInfo={ANIME} />);

  assert.deepEqual(facts(container), [
    ["STATUS", "RELEASING"],
    ["EPISODES", "1180"],
    ["RELEASE", "October 20, 1999"],
    ["LENGTH", "24 min"],
  ]);
});

test("EPISODES is still hidden for a NOT_YET_RELEASED anime", async () => {
  const { container } = await mount(<GridHeadingMediaInfo mediaInfo={BEFORE_RELEASE} />);

  assert.deepEqual(facts(container), [
    ["STATUS", "TO BE RELEASED"],
    ["RELEASE", "January 8, 2027"],
    ["LENGTH", "24 min"],
  ]);

  assert.equal((container.textContent || "").includes("EPISODES"), false);
});

test("a movie shows SOURCE instead of STATUS, and no EPISODES", async () => {
  const { container } = await mount(<GridHeadingMediaInfo mediaInfo={MOVIE} />);

  assert.deepEqual(facts(container), [
    ["SOURCE", "ORIGINAL"],
    ["RELEASE", "July 20, 2001"],
    ["LENGTH", "96 min"],
  ]);

  assert.equal((container.textContent || "").includes("STATUS"), false);
  assert.equal((container.textContent || "").includes("EPISODES"), false);
});

test("a manga shows STATUS, VOLUMES, RELEASE and CHAPTERS", async () => {
  const { container } = await mount(<GridHeadingMediaInfo mediaInfo={MANGA} />);

  assert.deepEqual(facts(container), [
    ["STATUS", "COMPLETE"],
    ["VOLUMES", "108"],
    ["RELEASE", "July 22, 1997"],
    ["CHAPTERS", "1100"],
  ]);

  assert.equal((container.textContent || "").includes("LENGTH"), false);
});

test("the imdb episode list still wins for the EPISODES value", async () => {
  const { container } = await mount(
    <GridHeadingMediaInfo mediaInfo={ANIME} imdbEpisodes={[{}, {}, {}] as never} />,
  );

  assert.deepEqual(facts(container)[1], ["EPISODES", "3"]);
});

// ------------------------------------------------------------------ the icons

test("every icon is decorative, so the label is what a screen reader reads", async () => {
  for (const mediaInfo of [ANIME, MOVIE, MANGA]) {
    const { container } = await mount(<GridHeadingMediaInfo mediaInfo={mediaInfo} />);

    const items = [...container.querySelectorAll("li")];
    const icons = [...container.querySelectorAll("svg")];

    assert.equal(icons.length, items.length, "one icon per item");

    for (const icon of icons) {
      assert.equal(icon.getAttribute("aria-hidden"), "true");
      assert.equal(icon.getAttribute("focusable"), "false");
      assert.equal(icon.hasAttribute("title"), false);
      assert.equal((icon.textContent || "").trim(), "", "an icon carries no text");
    }

    // each icon sits next to its own label, so nothing is announced twice
    for (const item of items) {
      assert.equal(item.querySelectorAll("svg").length, 1);
      assert.ok((item.querySelector("span")?.textContent || "").length > 0);
    }

    await mounted.pop()!.unmount();
  }
});

test("the icons keep an explicit viewBox, which SVGR drops otherwise", async () => {
  const { container } = await mount(<GridHeadingMediaInfo mediaInfo={MANGA} />);

  for (const icon of container.querySelectorAll("svg")) {
    assert.equal(icon.getAttribute("viewBox"), "0 0 16 16");
  }
});

// ------------------------------------------------------------- one strip only

test("the strip keeps its section, its list and its `<title> details` name", async () => {
  const { container } = await mount(<GridHeadingMediaInfo mediaInfo={ANIME} />);

  const section = strip(container);

  assert.ok(section, "the strip is still a section");
  assert.equal(section!.querySelectorAll("ul").length, 1);
  assert.equal(section!.querySelector("ul")!.getAttribute("aria-label"), `${TITLE.english} details`);
});

test("rendered through the hero, the strip appears exactly once", async () => {
  const { container } = await mount(
    <Provider store={store()}>
      <HeadingInfo
        mediaInfo={ANIME}
        searchParams={{}}
        infoSlot={<GridHeadingMediaInfo mediaInfo={ANIME} />}
      />
    </Provider>,
  );

  assert.equal(container.querySelectorAll('section[id="info_list_container"]').length, 1);
  assert.equal(container.querySelectorAll('ul[aria-label="One Piece details"]').length, 1);

  // every fact appears once: no duplicated, hidden copy of the same data
  const rendered = facts(container.querySelector('section[id="info_list_container"]')!);

  for (const label of ["STATUS", "EPISODES", "RELEASE", "LENGTH"]) {
    const matches = rendered.filter(([name]) => name === label);

    assert.equal(matches.length, 1, `${label} must be rendered exactly once`);
  }

  // and it is inside the hero, after the row with the Play pill and the round
  // buttons, not a sibling of the hero
  const heroActions = container.querySelector('[id="hero_actions"]');
  const info = container.querySelector('section[id="info_list_container"]');

  assert.ok(heroActions);
  assert.ok(info);

  const actionsInDocument = heroActions!.compareDocumentPosition(info!);
  assert.ok(actionsInDocument & Node.DOCUMENT_POSITION_FOLLOWING, "the strip comes after the actions");
  assert.equal(
    info!.closest('[id="hero"]') !== null,
    true,
    "the strip lives inside the hero body",
  );
});
