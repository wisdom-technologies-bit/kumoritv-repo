import assert from "node:assert/strict";
import test from "node:test";

const SITE = "https://kumoritv.vercel.app";

function mediaPayload(overrides: Record<string, unknown> = {}) {
  return {
    Media: {
      id: 21,
      title: {
        romaji: "One Piece",
        english: "One Piece",
        native: "ワンピース",
        userPreferred: "One Piece",
      },
      description: "<p>Pirates hunt the <b>One Piece</b> treasure.</p>",
      format: "TV",
      status: "RELEASING",
      season: "FALL",
      seasonYear: 1999,
      episodes: 1100,
      duration: 24,
      genres: ["Action", "Adventure"],
      startDate: { year: 1999, month: 10, day: 20 },
      endDate: { year: null, month: null, day: null },
      bannerImage: "https://s4.anilist.co/banner.jpg",
      coverImage: {
        extraLarge: "https://s4.anilist.co/cover-xl.jpg",
        large: "https://s4.anilist.co/cover.jpg",
        medium: "https://s4.anilist.co/cover-m.jpg",
        color: "#123456",
      },
      streamingEpisodes: [
        { title: "Episode 2 - The Great Swordsman", thumbnail: "https://cdn.example/ep2.jpg" },
      ],
      relations: { nodes: [] },
      recommendations: { edges: [] },
      reviews: { nodes: [] },
      characters: { edges: [] },
      studios: { edges: [] },
      nextAiringEpisode: null,
      isAdult: false,
      type: "ANIME",
      trailer: null,
      ...overrides,
    },
  };
}

async function withAniList<T>(payload: unknown, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: payload }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    if (previousSite !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previousSite;
  }
}

type Meta = {
  title?: string | { absolute?: string };
  description?: string;
  alternates?: { canonical?: string };
  openGraph?: { type?: string; images?: Array<{ url?: string }>; url?: string };
  twitter?: { card?: string; images?: Array<{ url?: string }> };
  robots?: { index?: boolean; follow?: boolean };
};

test("media page metadata: title, description, canonical and absolute og image", async () => {
  const meta = await withAniList(mediaPayload(), async () => {
    const page = await import("@/app/media/[id]/page");
    return (await page.generateMetadata({ params: { id: 21 } } as never)) as Meta;
  });

  assert.equal(meta.title, "One Piece (1999) - Watch Online, Episodes & Info");
  assert.ok(!String(meta.title).includes("KumoriTV"));
  assert.equal(meta.alternates?.canonical, `${SITE}/media/21`);
  assert.equal(meta.openGraph?.type, "video.tv_show");
  assert.equal(meta.openGraph?.images?.[0]?.url, `${SITE}/og/21`);
  assert.ok(meta.openGraph?.images?.[0]?.url?.startsWith("https://"));
  assert.equal(meta.twitter?.card, "summary_large_image");
  assert.equal(meta.twitter?.images?.[0]?.url, `${SITE}/og/21`);
  assert.equal(meta.robots?.index, true);
  assert.ok(meta.description);
  assert.ok(!meta.description!.includes("<"), "raw HTML must not reach the description");
  assert.ok(meta.description!.length <= 160);
});

test("media page metadata: movies use video.movie and unknown years are omitted", async () => {
  const meta = await withAniList(
    mediaPayload({ format: "MOVIE", seasonYear: null, startDate: { year: null, month: null, day: null } }),
    async () => {
      const page = await import("@/app/media/[id]/page");
      return (await page.generateMetadata({ params: { id: 21 } } as never)) as Meta;
    },
  );
  assert.equal(meta.openGraph?.type, "video.movie");
  assert.equal(meta.title, "One Piece - Watch Online, Episodes & Info");
});

test("watch page metadata: title, description, canonical and og:image", async () => {
  const meta = await withAniList(mediaPayload(), async () => {
    const page = await import("@/app/watch/[id]/page");
    return (await page.generateMetadata({
      params: { id: "21" },
      searchParams: { ep: "2", audio: "dub", t: "120", lang: "pt", episode: "9" },
    } as never)) as Meta;
  });

  assert.equal(meta.title, "Watch One Piece Episode 2: The Great Swordsman");
  assert.ok(!String(meta.title).includes("KumoriTV"));
  assert.ok(meta.description);
  assert.ok(meta.description!.length <= 160);
  assert.ok(meta.description!.startsWith('Watch One Piece Episode 2 "The Great Swordsman" online'));
  assert.equal(meta.alternates?.canonical, `${SITE}/watch/21?ep=2`);
  assert.equal(meta.openGraph?.type, "video.episode");
  assert.equal(meta.openGraph?.url, `${SITE}/watch/21?ep=2`);
  assert.equal(meta.openGraph?.images?.[0]?.url, `${SITE}/og/21/2`);
  assert.ok(meta.openGraph?.images?.[0]?.url?.startsWith("https://"));
  assert.equal(meta.twitter?.card, "summary_large_image");
  assert.equal(meta.twitter?.images?.[0]?.url, `${SITE}/og/21/2`);
  assert.equal(meta.robots?.index, true);
  assert.equal(meta.robots?.follow, true);
});

test("watch page metadata: a bad or missing ep falls back to episode 1", async () => {
  const meta = await withAniList(mediaPayload(), async () => {
    const page = await import("@/app/watch/[id]/page");
    return (await page.generateMetadata({ params: { id: "21" }, searchParams: { ep: "nope" } } as never)) as Meta;
  });
  assert.equal(meta.alternates?.canonical, `${SITE}/watch/21?ep=1`);
  assert.equal(meta.openGraph?.images?.[0]?.url, `${SITE}/og/21/1`);
});

test("watch page metadata: movies ignore the episode parameter", async () => {
  const meta = await withAniList(mediaPayload({ format: "MOVIE" }), async () => {
    const page = await import("@/app/watch/[id]/page");
    return (await page.generateMetadata({ params: { id: "21" }, searchParams: { ep: "7" } } as never)) as Meta;
  });
  assert.equal(meta.title, "Watch One Piece (Movie)");
  assert.equal(meta.alternates?.canonical, `${SITE}/watch/21?ep=1`);
});

test("watch page heading uses getEpisodeSeo instead of the client episodes fetch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("app/watch/[id]/page.tsx", "utf8");
  assert.ok(!source.includes("/api/anime/"), "the self-fetch of the episodes API must be gone");
  assert.ok(!source.includes("AbortSignal.timeout(1500)"), "the 1500ms timeout poll must be gone");
  assert.ok(source.includes("getEpisodeSeo("), "the heading data comes from getEpisodeSeo");
  assert.ok(source.includes("episodeTitle"), "the heading prints the episode title");
  assert.ok(source.includes("<JsonLd data={jsonLd} />"), "structured data is rendered in the body");
  assert.ok(!/\|\s*KumoriTV/.test(source), "no brand suffix inside the page title");
});

test("media page renders structured data in the server body", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("app/media/[id]/page.tsx", "utf8");
  assert.ok(source.includes("<JsonLd data={structuredData} />"));
  assert.ok(!/\|\s*KumoriTV/.test(source), "no brand suffix inside the page title");
});
