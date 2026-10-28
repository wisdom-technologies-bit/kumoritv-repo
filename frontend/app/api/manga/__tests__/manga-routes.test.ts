import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as getChapters } from "../[anilistId]/chapters/route";
import { GET as getPages } from "../chapter/[chapterId]/route";
import { __setAdminClientForTests } from "@/app/lib/manga/mangadex";

const CHAPTER_ID = "3c652754-fbf7-4465-be54-f61e50eadc5a";
const originalFetch = globalThis.fetch;

const anilistMedia = {
  data: {
    Media: {
      id: 21,
      title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End", native: "葬送のフリーレン", userPreferred: "Frieren: Beyond Journey's End" },
      synonyms: ["Frieren at the Funeral"],
      startDate: { year: 2020, month: 4, day: 28 },
      format: "MANGA",
      type: "MANGA",
    },
  },
};

type Handler = (url: URL) => Response | undefined;
let handler: Handler = () => undefined;

function installFetch(next: Handler) {
  handler = next;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const response = handler(url);
    if (!response) throw new Error(`unexpected fetch: ${url.toString()}`);
    return response;
  }) as typeof fetch;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function adminStub() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      upsert: async () => ({ error: null }),
    }),
  };
}

test.beforeEach(() => {
  __setAdminClientForTests(adminStub() as never);
  installFetch((url) => {
    if (url.hostname === "graphql.anilist.co") return json(anilistMedia);
    if (url.pathname === "/manga") {
      return json({ data: [{ id: "md-1", type: "manga", attributes: { title: { en: "Frieren" }, links: { al: "21" } } }] });
    }
    if (url.pathname === "/manga/md-1/feed") {
      return json({
        total: 2,
        data: [
          { id: "c-1", type: "chapter", attributes: { chapter: "1", volume: "1", title: "", pages: 40, externalUrl: null, publishAt: "2024-01-01T00:00:00+00:00" } },
          { id: "c-2", type: "chapter", attributes: { chapter: "2", volume: "1", title: "The road", pages: 18, externalUrl: null, publishAt: "2024-02-01T00:00:00+00:00" } },
        ],
      });
    }
    if (url.pathname === `/at-home/server/${CHAPTER_ID}`) {
      return json({ result: "ok", baseUrl: "https://uploads.mangadex.org", chapter: { hash: "abc", data: ["1.jpg", "2.jpg"], dataSaver: [] } });
    }
    return undefined;
  });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  __setAdminClientForTests(undefined);
});

test("chapters route: ready with chapters, 200 and the documented cache headers", async () => {
  const response = await getChapters(new NextRequest("http://localhost:3000/api/manga/21/chapters"), {
    params: { anilistId: "21" },
  });

  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("Cache-Control")), /s-maxage=600/);
  assert.match(String(response.headers.get("Cache-Control")), /stale-while-revalidate=3600/);

  const body = (await response.json()) as {
    status: string;
    chapters: { id: string; chapterNumber: string; title: string; pages: number }[];
  };

  assert.equal(body.status, "ready");
  assert.deepEqual(body.chapters, [
    { id: "c-1", chapterNumber: "1", volumeNumber: "1", title: "1", pages: 40 },
    { id: "c-2", chapterNumber: "2", volumeNumber: "1", title: "The road", pages: 18 },
  ]);
});

test("chapters route: unavailable when MangaDex has nothing for the title", async () => {
  installFetch((url) => {
    if (url.hostname === "graphql.anilist.co") return json(anilistMedia);
    if (url.pathname === "/manga") return json({ data: [] });
    return undefined;
  });

  const response = await getChapters(new NextRequest("http://localhost:3000/api/manga/21/chapters"), {
    params: { anilistId: "21" },
  });

  const body = (await response.json()) as { status: string; chapters: unknown[] };
  assert.equal(response.status, 200);
  assert.equal(body.status, "unavailable");
  assert.deepEqual(body.chapters, []);
});

test("chapters route: an error carries a JSON body and a shorter cache", async () => {
  installFetch((url) => {
    if (url.hostname === "graphql.anilist.co") return json(anilistMedia);
    if (url.pathname === "/manga") return json({ data: [{ id: "md-1", type: "manga", attributes: { links: { al: "21" } } }] });
    return json({ result: "error" }, 500);
  });

  const response = await getChapters(new NextRequest("http://localhost:3000/api/manga/21/chapters"), {
    params: { anilistId: "21" },
  });

  const body = (await response.json()) as { status: string };
  assert.equal(response.status, 200);
  assert.equal(body.status, "error");
  assert.match(String(response.headers.get("Cache-Control")), /s-maxage=60\b/);
});

test("chapters route: rejects a non-numeric id with 400 and a JSON body", async () => {
  const response = await getChapters(new NextRequest("http://localhost:3000/api/manga/abc/chapters"), {
    params: { anilistId: "abc" },
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as { status: string; message: string };
  assert.equal(body.status, "error");
  assert.ok(body.message.length > 0);
});

test("chapter route: ready pages for a valid uuid", async () => {
  const response = await getPages(new NextRequest(`http://localhost:3000/api/manga/chapter/${CHAPTER_ID}`), {
    params: { chapterId: CHAPTER_ID },
  });

  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("Cache-Control")), /s-maxage=60/);

  const body = (await response.json()) as { status: string; pages: { page: number; img: string }[] };
  assert.equal(body.status, "ready");
  assert.deepEqual(body.pages[0], { page: 1, img: "https://uploads.mangadex.org/data/abc/1.jpg" });
});

test("chapter route: rejects a malformed chapter id", async () => {
  const response = await getPages(new NextRequest("http://localhost:3000/api/manga/chapter/not-a-uuid"), {
    params: { chapterId: "not-a-uuid" },
  });

  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { status: string }).status, "error");
});

test("chapter route: a 404 from MangaDex reads as unavailable, not as a crash", async () => {
  installFetch((url) => {
    if (url.pathname.startsWith("/at-home/server/")) return json({ result: "error" }, 404);
    return undefined;
  });

  const response = await getPages(new NextRequest(`http://localhost:3000/api/manga/chapter/${CHAPTER_ID}`), {
    params: { chapterId: CHAPTER_ID },
  });

  const body = (await response.json()) as { status: string; pages: unknown[] };
  assert.equal(response.status, 200);
  assert.equal(body.status, "unavailable");
  assert.deepEqual(body.pages, []);
});
