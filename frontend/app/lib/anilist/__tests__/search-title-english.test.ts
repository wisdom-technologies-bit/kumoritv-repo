import assert from "node:assert/strict";
import test from "node:test";
import { searchCatalog } from "../medias.server";

// Regression: /search used to show romaji titles even though searchCatalog mapped
// `title` to `item.title.userPreferred`. AniList fills userPreferred with the
// romaji title for anonymous requests, so the mapping itself was the romaji
// source. The fixture keeps english != romaji to catch a regression either way.

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

const FRIEREN = {
  id: 154587,
  title: {
    english: "Frieren: Beyond Journey's End",
    romaji: "Sousou no Frieren",
    native: "葬送のフリーレン",
    userPreferred: "Sousou no Frieren",
  },
  coverImage: { large: "https://example.test/frieren.jpg" },
  genres: ["Adventure", "Drama"],
  format: "TV",
  type: "ANIME",
  season: "FALL",
  seasonYear: 2023,
};

function respondWith(media: unknown[]) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: { Page: { pageInfo: { total: media.length }, media } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

test.beforeEach(() => {
  console.error = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

test("searchCatalog maps the english title, not the romaji userPreferred", async () => {
  respondWith([FRIEREN]);

  const result = await searchCatalog({ title: "frieren" });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, "Frieren: Beyond Journey's End");
  assert.notEqual(result.results[0].title, "Sousou no Frieren");
  assert.equal(result.results[0].allResultsLength ?? result.allResultsLength, 1);
});

test("searchCatalog still labels results when only romaji exists", async () => {
  respondWith([{ ...FRIEREN, title: { romaji: "Sousou no Frieren", userPreferred: "Sousou no Frieren" } }]);

  const result = await searchCatalog({ title: "frieren" });

  assert.equal(result.results[0].title, "Sousou no Frieren");
});

test("searchCatalog keeps a searchable placeholder when a result has no title", async () => {
  respondWith([{ ...FRIEREN, title: {} }]);

  const result = await searchCatalog({ title: "frieren" });

  assert.equal(result.results[0].title, "Not Available");
});
