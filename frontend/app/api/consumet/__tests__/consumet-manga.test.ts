import assert from "node:assert/strict";
import test from "node:test";
import manga from "../consumetManga";
import { getMangaChaptersWithStatus } from "../consumetManga";

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
let requestedUrls: string[] = [];

type Route = { status: number; body: unknown };
let routes: Record<string, Route> = {};

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost:3000");
    requestedUrls.push(url.pathname);
    const route = routes[url.pathname];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const chaptersBody = {
  status: "ready",
  chapters: [
    { id: "c-2", chapterNumber: "2", volumeNumber: "1", title: "Two", pages: 18 },
    { id: "c-1", chapterNumber: "1", volumeNumber: "1", title: "1", pages: 40 },
  ],
};

test.beforeEach(() => {
  requestedUrls = [];
  console.error = () => {};
  routes = {};
  installFetch();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

test("getMangaChapters: same sorted shape as the old backend", async () => {
  routes["/api/manga/21/chapters"] = { status: 200, body: chaptersBody };

  const chapters = await manga.getMangaChapters({ id: 21 });

  assert.ok(chapters);
  assert.deepEqual(chapters!.map((chapter) => chapter.chapterNumber), ["1", "2"]);
  assert.deepEqual(Object.keys(chapters![0]).sort(), ["chapterNumber", "id", "pages", "title", "volumeNumber"]);
  assert.deepEqual(requestedUrls, ["/api/manga/21/chapters"]);
});

test("getMangaChapters: an unavailable title is null, exactly like a failure", async () => {
  routes["/api/manga/21/chapters"] = { status: 200, body: { status: "unavailable", chapters: [] } };

  assert.equal(await manga.getMangaChapters({ id: 21 }), null);
});

test("getMangaChapters: an error response is null", async () => {
  routes["/api/manga/21/chapters"] = { status: 200, body: { status: "error", chapters: [] } };

  assert.equal(await manga.getMangaChapters({ id: 21 }), null);
});

test("getMangaChapters: a 500 from our own route is null, not a throw", async () => {
  routes["/api/manga/21/chapters"] = { status: 500, body: { message: "boom" } };

  assert.equal(await manga.getMangaChapters({ id: 21 }), null);
});

test("getMangaChapters: a network failure is null", async () => {
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  assert.equal(await manga.getMangaChapters({ id: 21 }), null);
});

test("getChapterPages: returns the pages array on success", async () => {
  routes["/api/manga/chapter/3c652754-fbf7-4465-be54-f61e50eadc5a"] = {
    status: 200,
    body: { status: "ready", pages: [{ page: 1, img: "https://uploads.mangadex.org/data/abc/1.jpg" }] },
  };

  const pages = await manga.getChapterPages({ chapterId: "3c652754-fbf7-4465-be54-f61e50eadc5a" });

  assert.deepEqual(pages, [{ page: 1, img: "https://uploads.mangadex.org/data/abc/1.jpg" }]);
});

test("getChapterPages: null when the chapter has no pages", async () => {
  routes["/api/manga/chapter/3c652754-fbf7-4465-be54-f61e50eadc5a"] = {
    status: 200,
    body: { status: "unavailable", pages: [] },
  };

  assert.equal(await manga.getChapterPages({ chapterId: "3c652754-fbf7-4465-be54-f61e50eadc5a" }), null);
});

test("getMangaChaptersWithStatus keeps the status for the UI", async () => {
  routes["/api/manga/21/chapters"] = { status: 200, body: { status: "unavailable", chapters: [] } };

  const result = await getMangaChaptersWithStatus(21);

  assert.equal(result!.status, "unavailable");
  assert.deepEqual(result!.chapters, []);
});

test("searchMedia maps catalog results back to the old search shape", async () => {
  routes["/api/anilist/medias"] = {
    status: 200,
    body: {
      results: [
        { id: "30013", title: "Sousou no Frieren", coverImage: { large: "l.jpg", extraLarge: "xl.jpg" } },
      ],
    },
  };

  const results = await manga.searchMedia({ query: "frieren" });

  assert.ok(results);
  assert.equal(results![0].id, "30013");
  assert.equal(results![0].title, "Sousou no Frieren");
  assert.equal(results![0].image, "xl.jpg");
  assert.equal(typeof results![0].lastChapter, "string");
});
