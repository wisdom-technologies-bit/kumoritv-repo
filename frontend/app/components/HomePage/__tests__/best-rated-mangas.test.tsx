import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { flush, render } from "../../../../test-harness/render";
import NavigationThroughMedias from "../NavigationThroughMedias";

// The homepage section only reads these two slices.
const userInfoReducer = (state: unknown = { value: null }) => state;
const loginModalReducer = (state: unknown = { value: false }) => state;

const store = configureStore({
  reducer: { UserInfo: userInfoReducer, ShowLoginModal: loginModalReducer },
});

const mangas = Array.from({ length: 12 }, (_, index) => ({
  id: 30000 + index,
  title: { romaji: `Manga ${index + 1}`, userPreferred: `Manga ${index + 1}` },
  coverImage: { large: `https://example.test/manga-${index}.jpg` },
  format: "MANGA",
  genres: ["Fantasy"],
  seasonYear: 2020,
  trending: index,
  favourites: 100 - index,
}));

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
let requested: string[] = [];

test.beforeEach(() => {
  requested = [];
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost:3000");
    requested.push(url.search);

    return new Response(JSON.stringify({ results: mangas }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

async function renderMangaSection() {
  return render(
    <Provider store={store}>
      <NavigationThroughMedias
        headingTitle={"Best Rated Mangas"}
        route={"#"}
        mediaFormat="MANGA"
        sortBy={"FAVOURITES_DESC"}
        onDarkBackground
      />
    </Provider>,
  );
}

test("the mangas section asks for MANGA type + MANGA format, sorted by favourites, page 1 of 20", async () => {
  const tree = await renderMangaSection();
  await flush();

  try {
    const search = new URLSearchParams(requested[0]);

    assert.equal(search.get("fn"), "getMediaForThisFormat");
    assert.equal(search.get("type"), "MANGA");
    assert.equal(search.get("format"), "MANGA");
    assert.equal(search.get("sort"), "FAVOURITES_DESC");
    assert.equal(search.get("page"), "1");
    assert.equal(search.get("perPage"), "20");
    assert.equal(search.get("showAdultContent"), null, "adult filtering is not requested");
  } finally {
    await tree.unmount();
  }
});

test("the mangas section renders at least 10 covers linking to /media/{id}", async () => {
  const tree = await renderMangaSection();
  await flush();

  try {
    const links = Array.from(tree.container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/media/"));

    assert.ok(links.length >= 10, `expected 10+ media links, got ${links.length}`);
    assert.ok(links.includes("/media/30001"));
  } finally {
    await tree.unmount();
  }
});

test("manga cards carry the manga label and the manga icon, not the anime one", async () => {
  const tree = await renderMangaSection();
  await flush();

  try {
    const text = tree.container.textContent ?? "";
    assert.match(text, /MANGA/);

    const mangaIcons = Array.from(tree.container.querySelectorAll("svg")).filter(
      (icon) => icon.getAttribute("alt") === "Manga Icon",
    );
    const animeIcons = Array.from(tree.container.querySelectorAll("svg")).filter(
      (icon) => icon.getAttribute("alt") === "Tv Icon",
    );

    assert.ok(mangaIcons.length >= 10, `expected manga icons, got ${mangaIcons.length}`);
    assert.equal(animeIcons.length, 0, "no card may claim to be an anime");
  } finally {
    await tree.unmount();
  }
});
