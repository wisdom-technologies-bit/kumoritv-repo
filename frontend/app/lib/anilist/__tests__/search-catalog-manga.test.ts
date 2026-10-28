import assert from "node:assert/strict";
import test from "node:test";
import { searchCatalog } from "../medias.server";

type AniListCall = { query: string; variables: Record<string, unknown> };

const calls: AniListCall[] = [];
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

const oneManga = [
  {
    id: 30013,
    genres: ["Adventure", "Fantasy"],
    format: "MANGA",
    season: null,
    seasonYear: null,
    title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End" },
    coverImage: { large: "https://example.test/manga.jpg" },
  },
];

function respondWith() {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as AniListCall);
    return new Response(
      JSON.stringify({ data: { Page: { pageInfo: { total: 1 }, media: oneManga } } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}

function lastVariables(): Record<string, unknown> {
  assert.ok(calls.length > 0, "AniList was never called");
  return calls[calls.length - 1].variables;
}

test.beforeEach(() => {
  calls.length = 0;
  console.error = () => {};
  respondWith();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

test("type=manga asks AniList for MANGA type and MANGA format", async () => {
  const result = await searchCatalog({ type: "manga" });

  const variables = lastVariables();
  assert.equal(variables.type, "MANGA");
  assert.equal(variables.format, "MANGA");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].format, "MANGA");
  // results link to /media/{id} through the AniList id they carry
  assert.equal(result.results[0].id, "30013");
  assert.equal(result.results[0].anilistId, "30013");
});

test("type=novel asks for the NOVEL format, type=one_shot for ONE_SHOT", async () => {
  await searchCatalog({ type: "novel" });
  assert.equal(lastVariables().type, "MANGA");
  assert.equal(lastVariables().format, "NOVEL");

  calls.length = 0;
  await searchCatalog({ type: "one_shot" });
  assert.equal(lastVariables().type, "MANGA");
  assert.equal(lastVariables().format, "ONE_SHOT");
});

test("type=tv stays ANIME with the TV format", async () => {
  await searchCatalog({ type: "tv" });

  assert.equal(lastVariables().type, "ANIME");
  assert.equal(lastVariables().format, "TV");
});

test("type=movie/ova keep their own anime formats", async () => {
  await searchCatalog({ type: "movie" });
  assert.equal(lastVariables().type, "ANIME");
  assert.equal(lastVariables().format, "MOVIE");

  calls.length = 0;
  await searchCatalog({ type: "ova" });
  assert.equal(lastVariables().type, "ANIME");
  assert.equal(lastVariables().format, "OVA");
});

test("sort values linked from the site map to AniList sorts", async () => {
  await searchCatalog({ type: "manga", sort: "trending_desc" });
  assert.equal(lastVariables().sort, "TRENDING_DESC");

  calls.length = 0;
  await searchCatalog({ type: "manga", sort: "score_desc" });
  assert.equal(lastVariables().sort, "SCORE_DESC");

  calls.length = 0;
  await searchCatalog({ sort: "releases_desc" });
  assert.equal(lastVariables().sort, "START_DATE_DESC");

  calls.length = 0;
  await searchCatalog({ sort: "releases_asc" });
  assert.equal(lastVariables().sort, "START_DATE");
});

test("genre parsing still works for mangas", async () => {
  await searchCatalog({ type: "manga", genre: "[adventure]" });

  const variables = lastVariables();
  assert.equal(variables.type, "MANGA");
  assert.equal(variables.format, "MANGA");
  assert.deepEqual(variables.genre_in, ["Adventure"]);
});

test("mangas ignore the season", async () => {
  await searchCatalog({ type: "manga", season: "FALL" });

  assert.equal(lastVariables().season, undefined);
});
