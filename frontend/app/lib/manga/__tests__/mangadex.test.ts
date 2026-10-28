import assert from "node:assert/strict";
import test from "node:test";
import {
  __setAdminClientForTests,
  buildPageUrls,
  getChapterPages,
  getChaptersForAniListMedia,
  listChapters,
  resolveMangaDexId,
} from "../mangadex";

// --------------------------------------------------------------- fake supabase

class FakeAdminClient {
  sources: Record<string, Record<string, unknown>> = {};
  upserts: Record<string, unknown>[] = [];

  from(table: string) {
    const client = this;
    return {
      select() {
        return {
          eq(_column: string, value: number) {
            return {
              async maybeSingle() {
                if (table !== "manga_sources") return { data: null, error: null };
                return { data: client.sources[String(value)] ?? null, error: null };
              },
            };
          },
        };
      },
      async upsert(row: Record<string, unknown>) {
        if (table === "manga_sources") {
          client.sources[String(row.anilist_id)] = row;
          client.upserts.push(row);
        }
        return { error: null };
      },
    };
  }
}

// ------------------------------------------------------------------ fake fetch

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

const originalFetch = globalThis.fetch;
let handler: Handler = () => undefined;
let fetched: string[] = [];

function installFetch(next: Handler) {
  handler = next;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    fetched.push(url.toString());
    const response = await handler(url, init);
    if (!response) throw new Error(`unexpected fetch: ${url.toString()}`);
    return response;
  }) as typeof fetch;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function mangadexManga(id: string, attributes: Record<string, unknown>) {
  return { id, type: "manga", attributes };
}

function chapter(id: string, chapterNumber: string | null, pages: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "chapter",
    attributes: {
      chapter: chapterNumber,
      volume: "1",
      title: "",
      pages,
      externalUrl: null,
      publishAt: "2024-01-01T00:00:00+00:00",
      ...extra,
    },
  };
}

test.beforeEach(() => {
  fetched = [];
  __setAdminClientForTests(new FakeAdminClient());
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  __setAdminClientForTests(undefined);
});

// -------------------------------------------------------------------- resolve

test("resolve: accepts only the entry whose links.al is this AniList id", async () => {
  const admin = new FakeAdminClient();
  __setAdminClientForTests(admin);

  installFetch((url) => {
    if (url.pathname !== "/manga") return undefined;
    return json({
      data: [
        mangadexManga("wrong-entry", { title: { en: "Frieren" }, links: { al: "99999" }, year: 2020 }),
        mangadexManga("right-entry", { title: { en: "Frieren" }, links: { al: "21" }, year: 2020 }),
      ],
    });
  });

  assert.equal(await resolveMangaDexId(21, ["Frieren"]), "right-entry");
  assert.equal(admin.upserts[0].mangadex_id, "right-entry");
  assert.equal(admin.upserts[0].not_found, false);
});

test("resolve: falls back to an exact normalised title plus the same year", async () => {
  installFetch((url) => {
    if (url.pathname !== "/manga") return undefined;
    return json({
      data: [
        // no links.al, wrong year
        mangadexManga("older-run", { title: { en: "Frieren: Beyond Journey's End" }, year: 2015 }),
        // no links.al, right year, different title
        mangadexManga("other-title", { title: { en: "Frieren Anthology" }, year: 2020 }),
        // no links.al, right title via altTitles, right year
        mangadexManga("title-match", {
          title: { ja: "葬送のフリーレン" },
          altTitles: [{ en: "Frieren  beyond journey's end" }],
          year: 2020,
        }),
      ],
    });
  });

  assert.equal(
    await resolveMangaDexId(21, ["Frieren: Beyond Journey's End"], { year: 2020 }),
    "title-match",
  );
});

test("resolve: nothing matches, so it is cached as not found", async () => {
  const admin = new FakeAdminClient();
  __setAdminClientForTests(admin);

  installFetch((url) => {
    if (url.pathname !== "/manga") return undefined;
    return json({ data: [mangadexManga("someone-else", { title: { en: "Different" }, links: { al: "1" } })] });
  });

  assert.equal(await resolveMangaDexId(21, ["Frieren"]), null);
  assert.equal(admin.upserts.at(-1)!.not_found, true);
  assert.equal(admin.upserts.at(-1)!.mangadex_id, null);
});

test("resolve: a fresh not_found row short-circuits without searching", async () => {
  const admin = new FakeAdminClient();
  admin.sources["21"] = {
    anilist_id: 21,
    mangadex_id: null,
    title: "Frieren",
    not_found: true,
    checked_at: new Date().toISOString(),
  };
  __setAdminClientForTests(admin);

  installFetch(() => json({ data: [] }));

  assert.equal(await resolveMangaDexId(21, ["Frieren"]), null);
  assert.equal(fetched.length, 0, "a fresh not_found row must not search again");
});

test("resolve: a not_found row older than 24h is re-checked", async () => {
  const admin = new FakeAdminClient();
  admin.sources["21"] = {
    anilist_id: 21,
    mangadex_id: null,
    title: "Frieren",
    not_found: true,
    checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  };
  __setAdminClientForTests(admin);

  installFetch((url) => {
    if (url.pathname !== "/manga") return undefined;
    return json({ data: [mangadexManga("now-there", { title: { en: "Frieren" }, links: { al: "21" } })] });
  });

  assert.equal(await resolveMangaDexId(21, ["Frieren"]), "now-there");
  assert.ok(fetched.length > 0);
});

test("resolve: a cached hit is returned without touching MangaDex", async () => {
  const admin = new FakeAdminClient();
  admin.sources["21"] = {
    anilist_id: 21,
    mangadex_id: "cached-entry",
    title: "Frieren",
    not_found: false,
    checked_at: new Date().toISOString(),
  };
  __setAdminClientForTests(admin);

  installFetch(() => json({ data: [] }));

  assert.equal(await resolveMangaDexId(21, ["Frieren"]), "cached-entry");
  assert.equal(fetched.length, 0);
});

test("resolve: the search request carries the documented parameters", async () => {
  installFetch((url) => {
    if (url.pathname !== "/manga") return undefined;
    return json({ data: [] });
  });

  await resolveMangaDexId(21, ["Frieren"]);

  const url = new URL(fetched[0]);
  assert.equal(url.searchParams.get("title"), "Frieren");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("order[relevance]"), "desc");
  assert.deepEqual(url.searchParams.getAll("contentRating[]"), [
    "safe",
    "suggestive",
    "erotica",
    "pornographic",
  ]);
});

// ------------------------------------------------------------------- chapters

test("listChapters: drops external and page-less chapters, dedupes and sorts numerically", async () => {
  installFetch((url) => {
    if (url.pathname !== "/manga/md-1/feed") return undefined;
    return json({
      total: 6,
      data: [
        chapter("c10", "10", 18),
        chapter("c1", "1", 40),
        chapter("c2", "2", 20),
        chapter("c105", "10.5", 22),
        chapter("c1-better", "1", 45, { publishAt: "2024-05-01T00:00:00+00:00" }),
        chapter("external", "3", 0, { externalUrl: "https://example.test/chapter-3" }),
        chapter("empty", "4", 0),
      ],
    });
  });

  const chapters = await listChapters("md-1");

  assert.deepEqual(chapters.map((item) => item.chapterNumber), ["1", "2", "10", "10.5"]);
  assert.equal(chapters[0].id, "c1-better", "the entry with the most pages wins");
  assert.equal(chapters[0].pages, 45);
  assert.ok(!chapters.some((item) => item.id === "external" || item.id === "empty"));
});

test("listChapters: one-shots without a chapter number become 0 and keep the number as title", async () => {
  installFetch((url) => {
    if (url.pathname !== "/manga/md-1/feed") return undefined;
    return json({ total: 2, data: [chapter("one-shot", null, 30), chapter("c2", "2", 10, { title: "A walk" })] });
  });

  const chapters = await listChapters("md-1");

  assert.deepEqual(chapters.map((item) => item.chapterNumber), ["0", "2"]);
  assert.equal(chapters[0].title, "0");
  assert.equal(chapters[1].title, "A walk");
});

test("listChapters: paginates until the total is reached", async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => chapter(`c-${index + 1}`, String(index + 1), 10));

  installFetch((url) => {
    if (url.pathname !== "/manga/md-1/feed") return undefined;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    assert.equal(url.searchParams.get("limit"), "500");
    assert.ok(url.searchParams.getAll("translatedLanguage[]").includes("en"));
    assert.equal(url.searchParams.get("includeExternalUrl"), "0");
    if (offset === 0) return json({ total: 520, data: firstPage });
    return json({ total: 520, data: [chapter("c-501", "501", 10), ...Array.from({ length: 19 }, (_, index) => chapter(`c-${index + 502}`, String(index + 502), 10))] });
  });

  const chapters = await listChapters("md-1");

  assert.equal(chapters.length, 520);
  assert.equal(fetched.length, 2);
  assert.ok(new URL(fetched[1]).searchParams.get("offset") === "500");
});

test("listChapters: one 429 is retried once and honours Retry-After", async () => {
  let attempts = 0;
  installFetch((url) => {
    if (url.pathname !== "/manga/md-1/feed") return undefined;
    attempts += 1;
    if (attempts === 1) return json({ result: "error" }, 429, { "Retry-After": "0.01" });
    return json({ total: 1, data: [chapter("c1", "1", 12)] });
  });

  const chapters = await listChapters("md-1");

  assert.equal(attempts, 2);
  assert.equal(chapters.length, 1);
});

test("listChapters: a second 5xx gives up", async () => {
  let attempts = 0;
  installFetch(() => {
    attempts += 1;
    return json({ result: "error" }, 503, { "Retry-After": "0.01" });
  });

  await assert.rejects(() => listChapters("md-1"), /MangaDex HTTP 503|MangaDex request failed/);
  assert.equal(attempts, 2, "exactly one retry");
});

test("timeout: an aborted request surfaces as the error status, never a throw", async () => {
  installFetch((url) => {
    if (url.pathname === "/manga") {
      return json({ data: [mangadexManga("md-1", { title: { en: "Frieren" }, links: { al: "21" } })] });
    }
    if (url.pathname === "/manga/md-1/feed") {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    }
    return undefined;
  });

  const result = await getChaptersForAniListMedia(21, ["Frieren"]);

  assert.equal(result.status, "error");
  assert.deepEqual(result.chapters, []);
});

test("unavailable: no MangaDex match gives the unavailable status", async () => {
  installFetch((url) => {
    if (url.pathname !== "/manga") return undefined;
    return json({ data: [] });
  });

  const result = await getChaptersForAniListMedia(21, ["Frieren"]);

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.chapters, []);
});

// ---------------------------------------------------------------------- pages

test("buildPageUrls: builds the At-Home data URLs with 1-based page numbers", () => {
  const pages = buildPageUrls("https://uploads.mangadex.org", "hash123", ["a.jpg", "b.png"]);

  assert.deepEqual(pages, [
    { page: 1, img: "https://uploads.mangadex.org/data/hash123/a.jpg" },
    { page: 2, img: "https://uploads.mangadex.org/data/hash123/b.png" },
  ]);
});

test("getChapterPages: reads baseUrl/state from the At-Home server", async () => {
  installFetch((url) => {
    if (!url.pathname.startsWith("/at-home/server/")) return undefined;
    return json({
      result: "ok",
      baseUrl: "https://cmdxd98sb0x3yprd.mangadex.network",
      chapter: { hash: "abc", data: ["1.jpg", "2.jpg"], dataSaver: ["s1.jpg"] },
    });
  });

  const pages = await getChapterPages("3c652754-fbf7-4465-be54-f61e50eadc5a");

  assert.equal(pages.length, 2);
  assert.equal(
    pages[1].img,
    "https://cmdxd98sb0x3yprd.mangadex.network/data/abc/2.jpg",
  );
});

test("getChapterPages: a chapter with no files is an error, not an empty gallery", async () => {
  installFetch(() => json({ result: "ok", baseUrl: "https://x", chapter: { hash: "abc", data: [] } }));

  await assert.rejects(() => getChapterPages("3c652754-fbf7-4465-be54-f61e50eadc5a"));
});
