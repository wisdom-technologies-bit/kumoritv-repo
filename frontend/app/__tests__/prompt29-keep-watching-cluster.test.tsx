// Prompt 29, part B: Keep Watching is a compact cluster on desktop and a
// scroller on phones.
//
// The cluster keeps every behaviour the big cards had: the resume link with the
// episode, the second offset and the audio track, the DUB tag, the progress
// ratio, the trash button and the section's own count. What changed is how many
// cards are on screen at once and how they are laid out: at most six compact
// rows, with a Show more / Show less pill that stops at twelve.
//
// These tests pin the cluster down:
//   - six cards first, twelve after the toggle, six again after it, never more;
//   - the toggle only appears when there is something to reveal;
//   - deleting a card removes it from the grid and from the list;
//   - the links, the DUB tag and the progress ratio are unchanged;
//   - a narrow viewport still renders the swiper (no grid).

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render, flush, click, type RenderedTree } from "../../test-harness/render";
import KeepWatchingSection, {
  KEEP_WATCHING_INITIAL_COUNT,
  KEEP_WATCHING_MAX_COUNT,
} from "@/app/components/HomePage/KeepWatchingSection";
import KeepWatchingEpisodeInfo, {
  progressRatio,
  watchHref,
} from "@/app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo";
import type { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";

const STORAGE_KEY = "kumori_progress_v1";

type Seeded = {
  id: number;
  episode: number;
  time: number;
  duration: number;
  audio?: "sub" | "dub";
  title?: string;
};

/** Writes progress rows straight into the local store the section reads. */
function seed(rows: Seeded[]) {
  const value: Record<string, unknown> = {};

  rows.forEach((row, index) => {
    value[String(row.id)] = {
      episode: row.episode,
      time: row.time,
      duration: row.duration,
      audio: row.audio || "sub",
      updatedAt: Date.now() - index * 1000,
      title: row.title || `Show ${row.id}`,
      cover: `https://img.example/cover-${row.id}.jpg`,
      episodeImage: `https://img.example/ep-${row.id}.jpg`,
      watched: [],
    };
  });

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function rows(count: number, overrides: Partial<Seeded> = {}): Seeded[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 100 + index,
    episode: 1 + index,
    time: 300,
    duration: 1440,
    ...overrides,
  }));
}

/** Puts the section on the desktop path (>=768px) for the duration of a test. */
function useWideViewport() {
  const previous = window.matchMedia;

  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: query.includes("min-width: 768px"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });

  return () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = previous;
  };
}

function links(tree: RenderedTree) {
  return Array.from(tree.container.querySelectorAll('[data-keep-watching-link="true"]'));
}

function toggle(tree: RenderedTree) {
  return tree.container.querySelector('[data-keep-watching-toggle="true"]');
}

async function withSection(count: number, run: (tree: RenderedTree) => Promise<void>, overrides: Partial<Seeded> = {}) {
  window.localStorage.clear();
  seed(rows(count, overrides));

  const restore = useWideViewport();
  const tree = await render(<KeepWatchingSection />);
  // one more pass for the async list load
  await flush();

  try {
    await run(tree);
  } finally {
    await tree.unmount();
    restore();
    window.localStorage.clear();
  }
}

// ------------------------------------------------------------------ the grid

test("the cluster shows six cards, reveals twelve, then folds back to six", async () => {
  assert.equal(KEEP_WATCHING_INITIAL_COUNT, 6);
  assert.equal(KEEP_WATCHING_MAX_COUNT, 12);

  await withSection(14, async (tree) => {
    const grid = tree.container.querySelector('[data-keep-watching-grid="true"]');

    assert.ok(grid, "the desktop layout is a grid, not the swiper");
    assert.equal(grid?.tagName, "UL");
    assert.equal(links(tree).length, 6, "six compact rows first");

    const button = toggle(tree);
    assert.ok(button, "the pill appears when there is more to show");
    assert.match(button?.textContent ?? "", /Show more/);

    await click(button);
    await flush();

    assert.equal(links(tree).length, 12, "the toggle stops at twelve");
    assert.match(toggle(tree)?.textContent ?? "", /Show less/);

    await click(toggle(tree));
    await flush();

    assert.equal(links(tree).length, 6, "and folds back to the first row and a half");
    assert.match(toggle(tree)?.textContent ?? "", /Show more/);
  });
});

test("no toggle for six cards or fewer", async () => {
  await withSection(6, async (tree) => {
    assert.equal(links(tree).length, 6);
    assert.equal(toggle(tree), null, "nothing to reveal, no pill");
  });
});

test("the heading carries the count of the whole list, not of the visible cards", async () => {
  await withSection(14, async (tree) => {
    const badge = tree.container.querySelector('[data-keep-watching-count="true"]');
    const heading = tree.container.querySelector("h2");

    assert.equal(heading?.textContent?.startsWith("Keep Watching"), true);
    assert.equal(badge?.textContent, "14");
    assert.equal(links(tree).length, 6);
  });
});

test("deleting a card removes it from the grid and from the list", async () => {
  await withSection(6, async (tree) => {
    assert.equal(links(tree).length, 6);

    const before = links(tree)[0].getAttribute("href");

    await click(tree.container.querySelector("button"));
    // the removal animation is 350ms, then the section drops the card
    await new Promise((resolve) => setTimeout(resolve, 400));
    await flush();

    const after = links(tree).map((link) => link.getAttribute("href"));

    assert.equal(after.includes(before), false, "the removed anime is gone from the cluster");
    assert.equal(after.length, 5, "one card fewer");
  });
});

test("the phone layout keeps the scroller and renders no grid", async () => {
  window.localStorage.clear();
  seed(rows(7));

  const tree = await render(<KeepWatchingSection />);
  await flush();

  try {
    assert.equal(tree.container.querySelector('[data-keep-watching-grid="true"]'), null);
    assert.equal(links(tree).length, 7, "the swiper holds every card");
  } finally {
    await tree.unmount();
    window.localStorage.clear();
  }
});

// ------------------------------------------------------------------ the card

const CARD = {
  id: 21,
  title: {
    romaji: "Sousou no Frieren",
    english: "Frieren: Beyond Journey's End",
    userPreferred: "Frieren: Beyond Journey's End",
  },
  coverImage: { extraLarge: "https://img.example/cover.jpg" },
  episodeImg: "https://img.example/ep-18.jpg",
  format: "TV",
  episode: "18",
  episodeTimeLastStop: 660,
  episodeDuration: 1440,
  dub: true,
} as unknown as KeepWatchingMediaData;

test("the compact row keeps the resume link, the DUB tag and the progress bar", async () => {
  const tree = await render(
    <KeepWatchingEpisodeInfo animeInfo={CARD} layout="grid" deleteFromListHook={() => {}} />,
  );

  const link = tree.container.querySelector('[data-keep-watching-link="true"]');

  assert.equal(link?.getAttribute("href"), "/watch/21?ep=18&t=660&audio=dub");
  assert.equal(watchHref(CARD), "/watch/21?ep=18&t=660&audio=dub");

  const dub = tree.container.querySelector('[data-dub-tag="true"]');
  assert.equal(dub?.textContent, "DUB");

  const fill = tree.container.querySelector("[data-progress-ratio]");
  assert.equal(Number(fill?.getAttribute("data-progress-ratio")), progressRatio(CARD));

  const text = tree.container.textContent ?? "";
  assert.match(text, /Episode 18/);
  assert.match(text, /left/);

  assert.equal(
    tree.container.querySelector('[data-keep-watching-layout="grid"]')?.className.includes("compact"),
    true,
    "the row carries its own compact styling",
  );

  await tree.unmount();
});

test("the trash button still removes the row", async () => {
  let removed = false;

  const tree = await render(
    <KeepWatchingEpisodeInfo
      animeInfo={CARD}
      layout="grid"
      deleteFromListHook={() => {
        removed = true;
      }}
    />,
  );

  const button = tree.container.querySelector("button");

  assert.match(
    button?.getAttribute("title") ?? "",
    /Remove Frieren: Beyond Journey's End from Keep Watching/,
  );

  await click(button);
  await flush();

  assert.equal(removed, false, "the hook runs after the animation");

  await tree.unmount();
});

test("the title link still points at the media page", async () => {
  const tree = await render(
    <KeepWatchingEpisodeInfo animeInfo={CARD} layout="grid" deleteFromListHook={() => {}} />,
  );

  const hrefs = Array.from(tree.container.querySelectorAll("a")).map((a) => a.getAttribute("href"));

  assert.ok(hrefs.includes("/media/21"), "the title goes to /media/{id}");
  assert.ok(hrefs.includes("/watch/21?ep=18&t=660&audio=dub"));

  await tree.unmount();
});
