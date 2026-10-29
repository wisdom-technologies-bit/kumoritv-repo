import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../medias/route";

type AniListCall = { query: string; variables: Record<string, unknown> };

const calls: AniListCall[] = [];
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

function respondWith(body: unknown, status = 200) {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as AniListCall);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

function request(query: string) {
  return new NextRequest(`http://localhost:3000/api/anilist/medias?${query}`);
}

function lastVariables(): Record<string, unknown> {
  assert.ok(calls.length > 0, "AniList was never called");
  return calls[calls.length - 1].variables;
}

test.beforeEach(() => {
  calls.length = 0;
  console.error = () => {};
  respondWith({ data: { Page: { media: [] } } });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

test("getMediaForThisFormat: adult titles are hidden by default", async () => {
  const response = await GET(request("fn=getMediaForThisFormat&type=ANIME"));

  assert.equal(response.status, 200);
  assert.equal(lastVariables().isAdult, false);
});

test("getMediaForThisFormat: showAdultContent=true omits isAdult entirely", async () => {
  const response = await GET(request("fn=getMediaForThisFormat&type=ANIME&showAdultContent=true"));

  assert.equal(response.status, 200);
  const variables = lastVariables();
  // `isAdult: true` would return adult titles ONLY, so the argument is omitted.
  assert.ok(!("isAdult" in variables), `isAdult leaked: ${JSON.stringify(variables)}`);
  assert.equal(variables.isAdult, undefined);
});

test("getMediaForThisFormat: showAdultContent=false keeps them hidden", async () => {
  await GET(request("fn=getMediaForThisFormat&type=ANIME&showAdultContent=false"));

  assert.equal(lastVariables().isAdult, false);
});

test("getMediaForThisFormat: type=MANGA without a format sends no TV", async () => {
  await GET(request("fn=getMediaForThisFormat&type=MANGA&sort=FAVOURITES_DESC"));

  const variables = lastVariables();
  assert.equal(variables.type, "MANGA");
  assert.equal(variables.format, undefined);
  assert.equal(variables.sort, "FAVOURITES_DESC");
});

test("getMediaForThisFormat: type=ANIME without a format still sends TV", async () => {
  await GET(request("fn=getMediaForThisFormat&type=ANIME"));

  assert.equal(lastVariables().format, "TV");
});

test("getMediaForThisFormat: format=MANGA and the manga-only formats are allowed", async () => {
  for (const format of ["MANGA", "NOVEL", "ONE_SHOT"]) {
    calls.length = 0;
    const response = await GET(request(`fn=getMediaForThisFormat&type=MANGA&format=${format}`));
    assert.equal(response.status, 200);
    assert.equal(lastVariables().format, format);
  }
});

test("getMediaForThisFormat: the page parameter reaches the server function as pageNumber", async () => {
  await GET(request("fn=getMediaForThisFormat&type=ANIME&page=3"));

  assert.equal(lastVariables().page, 3);
});

test("fn=search hides adult results by default", async () => {
  const response = await GET(request("fn=search&query=monster&perPage=5"));

  assert.equal(response.status, 200);
  assert.equal(lastVariables().isAdult, false);
});

test("fn=search omits isAdult when showAdultContent=true", async () => {
  await GET(request("fn=search&query=monster&showAdultContent=true"));

  assert.ok(!("isAdult" in lastVariables()));
});

test("fn=search still hides adult titles when showAdultContent=false", async () => {
  await GET(request("fn=search&query=monster&showAdultContent=false"));

  assert.equal(lastVariables().isAdult, false);
});
