import assert from "node:assert/strict";
import test from "node:test";
import {
  OG_CACHE_CONTROL,
  OG_FALLBACK_CACHE_CONTROL,
  ogImageResponse,
  ogImageUrl,
  type OgDeps,
} from "@/app/lib/seo/og-image";
import type { EpisodeSeo } from "@/app/lib/seo/episode-seo";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGPg5hb5jw8zjAwFAO+TSkHmnF6wAAAAAElFTkSuQmCC";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;

const seo = (overrides: Partial<EpisodeSeo> = {}): EpisodeSeo => ({
  episodeTitle: "The Great Swordsman",
  synopsis: "Zoro arrives.",
  thumbnailUrl: "https://cdn.example/ep2.jpg",
  airedAtISO: "1999-11-17T00:00:00+00:00",
  durationISO: "PT24M",
  hasSub: true,
  hasDub: true,
  source: "db",
  ...overrides,
});

function deps(overrides: Partial<OgDeps> = {}): Partial<OgDeps> {
  return {
    episodeSeo: async () => seo(),
    media: async () => ({
      title: { english: "One Piece", romaji: "One Piece" },
      bannerImage: "https://cdn.example/banner.jpg",
      coverImage: { extraLarge: "https://cdn.example/cover.jpg" },
      format: "TV",
      seasonYear: 1999,
    }),
    imageDataUri: async () => PNG_DATA_URI,
    wordmarkDataUri: async () => null,
    ...overrides,
  };
}

async function readPng(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString("hex"), "89504e47", "PNG magic bytes");
  assert.ok(bytes.length > 500, `png too small: ${bytes.length}`);
  return bytes;
}

test("episode card with a good thumbnail is a PNG cached for a day at the edge", async () => {
  const response = await ogImageResponse({ id: "21", episode: "2" }, deps());
  await readPng(response);
  assert.equal(response.headers.get("cache-control"), OG_CACHE_CONTROL);
  assert.ok(OG_CACHE_CONTROL.includes("s-maxage=86400"));
  assert.ok(OG_CACHE_CONTROL.includes("max-age=3600"));
  assert.ok(OG_CACHE_CONTROL.includes("stale-while-revalidate=604800"));
});

test("upstream image failure still returns a PNG but with the short cache", async () => {
  const response = await ogImageResponse(
    { id: "21", episode: "2" },
    deps({ imageDataUri: async () => null }),
  );
  await readPng(response);
  assert.equal(response.headers.get("cache-control"), OG_FALLBACK_CACHE_CONTROL);
  assert.ok(OG_FALLBACK_CACHE_CONTROL.includes("s-maxage=300"));
});

test("a rejected image fetch (timeout path) still returns a PNG", async () => {
  const response = await ogImageResponse(
    { id: "21", episode: "2" },
    deps({
      imageDataUri: async () => {
        throw new Error("The operation was aborted due to timeout");
      },
    }),
  );
  await readPng(response);
  assert.equal(response.headers.get("cache-control"), OG_FALLBACK_CACHE_CONTROL);
});

test("invalid params render the generic brand card with status 200", async () => {
  for (const input of [{ id: "abc" }, { id: "-1" }, { id: "" }, { id: "12.5" }]) {
    const response = await ogImageResponse(input, deps());
    await readPng(response);
    assert.equal(response.headers.get("cache-control"), OG_CACHE_CONTROL);
  }
});

test("data source failures never break the card", async () => {
  const boom = async () => {
    throw new Error("upstream down");
  };
  const response = await ogImageResponse(
    { id: "21", episode: "2" },
    deps({ episodeSeo: boom, media: boom, wordmarkDataUri: boom }),
  );
  await readPng(response);
  assert.equal(response.headers.get("cache-control"), OG_FALLBACK_CACHE_CONTROL);
});

test("series card uses the banner and only needs an id", async () => {
  const response = await ogImageResponse({ id: "21" }, deps());
  await readPng(response);
  assert.equal(response.headers.get("cache-control"), OG_CACHE_CONTROL);
});

test("ogImageUrl always points at an absolute non-/api path", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(ogImageUrl(21), "https://kumoritv.top/og/21");
  assert.equal(ogImageUrl(21, 5), "https://kumoritv.top/og/21/5");
  assert.equal(ogImageUrl(21, "abc"), "https://kumoritv.top/og/21/1");
  assert.ok(!ogImageUrl(21, 2).includes("/api/"));
  if (previous !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previous;
});

test("the real route handlers answer with a PNG when fetch is stubbed", async () => {
  const { GET: seriesRoute } = await import("@/app/og/[id]/route");
  const { GET: episodeRoute } = await import("@/app/og/[id]/[ep]/route");
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(
        JSON.stringify({
          data: {
            Media: {
              id: 21,
              title: { romaji: "One Piece", english: "One Piece", native: "ワンピース", userPreferred: "One Piece" },
              description: "<p>Pirates.</p>",
              format: "TV",
              seasonYear: 1999,
              bannerImage: "https://cdn.example/banner.jpg",
              coverImage: { extraLarge: "https://cdn.example/cover.jpg" },
              streamingEpisodes: [
                { title: "Episode 2 - The Great Swordsman", thumbnail: "https://cdn.example/ep2.jpg" },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;

  try {
    const episodeResponse = await episodeRoute(new Request("https://kumoritv.top/og/21/2"), {
      params: { id: "21", ep: "2" },
    });
    await readPng(episodeResponse);
    const seriesResponse = await seriesRoute(new Request("https://kumoritv.top/og/21"), {
      params: { id: "21" },
    });
    await readPng(seriesResponse);
    const invalid = await seriesRoute(new Request("https://kumoritv.top/og/abc"), {
      params: { id: "abc" },
    });
    await readPng(invalid);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
