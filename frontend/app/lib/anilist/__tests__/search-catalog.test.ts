import assert from "node:assert/strict";
import test from "node:test";
import { searchCatalog } from "../medias.server";

type AniListRequest = { query: string; variables: Record<string, unknown> };

const requests: AniListRequest[] = [];
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const consoleErrors: unknown[][] = [];

function respondWith(body: unknown, status = 200) {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as AniListRequest);

    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

function mediaPage(items: unknown[], total = items.length) {
  return { data: { Page: { pageInfo: { total }, media: items } } };
}

const oneMedia = [
  {
    id: 21,
    genres: ["Adventure"],
    format: "TV",
    season: "FALL",
    seasonYear: 2024,
    title: { romaji: "One Piece", english: "One Piece" },
    coverImage: { large: "https://example.test/cover.jpg" },
  },
];

test.beforeEach(() => {
  requests.length = 0;
  consoleErrors.length = 0;

  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

function lastVariables() {
  assert.ok(requests.length > 0, "AniList was never called");

  return requests[requests.length - 1].variables;
}

test("[adventure] sends genre_in with the canonical name and no tag_in", async () => {
  respondWith(mediaPage(oneMedia, 1064));

  const result = await searchCatalog({ genre: "[adventure]" });

  assert.deepEqual(lastVariables().genre_in, ["Adventure"]);
  assert.equal(lastVariables().tag_in, undefined);
  assert.equal(lastVariables().type, "ANIME");
  assert.equal(lastVariables().perPage, 12);
  assert.equal(result.allResultsLength, 1064);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, "One Piece");
  assert.equal(result.results[0].anilistId, "21");
});

test("[action-comedy] sends both genres", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({ genre: "[action-comedy]" });

  assert.deepEqual(lastVariables().genre_in, ["Action", "Comedy"]);
  assert.equal(lastVariables().tag_in, undefined);
});

test("the media page chip format ([slice of life]) resolves", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({ genre: "[slice of life]" });

  assert.deepEqual(lastVariables().genre_in, ["Slice of Life"]);
});

test("[shoujo] goes to tag_in, never genre_in", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({ genre: "[shoujo]" });

  assert.deepEqual(lastVariables().tag_in, ["Shoujo"]);
  assert.equal(lastVariables().genre_in, undefined);
});

test("[shounen] also goes to tag_in", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({ genre: "[shounen]" });

  assert.deepEqual(lastVariables().tag_in, ["Shounen"]);
  assert.equal(lastVariables().genre_in, undefined);
});

test("genres and demographics can be combined", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({ genre: "[action-shoujo]" });

  assert.deepEqual(lastVariables().genre_in, ["Action"]);
  assert.deepEqual(lastVariables().tag_in, ["Shoujo"]);
});

test("unknown genres are ignored, so nothing empty is sent to AniList", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({ genre: "[not-a-genre]" });

  assert.equal(lastVariables().genre_in, undefined);
  assert.equal(lastVariables().tag_in, undefined);
  assert.equal(lastVariables().sort, "START_DATE_DESC");
});

test("repeated ?genre= params are merged", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({ genre: ["[adventure]", "[comedy]"] });

  assert.deepEqual(lastVariables().genre_in, ["Adventure", "Comedy"]);
});

test("the other filters are still sent untouched", async () => {
  respondWith(mediaPage([]));

  await searchCatalog({
    genre: "[adventure]",
    type: "tv",
    status: "ongoing",
    season: "fall",
    year: 2024,
    title: "  one piece  ",
    sort: "title_asc",
    page: "1",
  });

  const variables = lastVariables();

  assert.deepEqual(variables, {
    search: "one piece",
    seasonYear: 2024,
    season: "FALL",
    format: "TV",
    status: "RELEASING",
    genre_in: ["Adventure"],
    sort: "TITLE_ENGLISH",
    type: "ANIME",
    perPage: 12,
    page: 1,
  });
});

test("page=2 fetches both pages with the same genre variables", async () => {
  respondWith(mediaPage(oneMedia));

  await searchCatalog({ genre: "[adventure]", page: "2" });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.variables.page), [1, 2]);
  assert.deepEqual(requests[1].variables.genre_in, ["Adventure"]);
});

test("an AniList failure logs an error and returns the empty shape", async () => {
  respondWith({ errors: [{ message: "Invalid genre" }] });

  const result = await searchCatalog({ genre: "[horror]" });

  assert.deepEqual(result, { results: [], allResultsLength: 0 });
  assert.equal(requests.length, 1);
  assert.equal(consoleErrors.length, 1, "one error was logged");
  assert.equal(consoleErrors[0][0], "[searchCatalog] AniList request failed");
  assert.equal(typeof consoleErrors[0][1], "string");
  // no tokens or full response bodies in the log
  assert.equal(consoleErrors[0].length, 2);
});

test("an HTTP failure also returns the empty shape", async () => {
  respondWith({}, 500);

  const result = await searchCatalog({ genre: "[supernatural]" });

  assert.deepEqual(result, { results: [], allResultsLength: 0 });
  assert.equal(consoleErrors.length, 1);
});

test("a failed request is not cached: the next call fetches again", async () => {
  respondWith({ errors: [{ message: "boom" }] });

  const failed = await searchCatalog({ genre: "[music]" });

  assert.deepEqual(failed, { results: [], allResultsLength: 0 });
  assert.equal(requests.length, 1);

  respondWith(mediaPage(oneMedia));

  const retried = await searchCatalog({ genre: "[music]" });

  assert.equal(requests.length, 2, "the retry reached AniList again");
  assert.equal(retried.results.length, 1);
});
