// Prompt 22: episode thumbnails served from our own domain.
//
// Search Console flagged `VideoObject.thumbnailUrl` because it pointed at a
// provider image host whose robots.txt blocks Googlebot. /thumb/[id]/[ep] now
// re-serves those bytes (or the OG card) from kumoritv.top, which robots.txt
// leaves open. The modules under test are loaded lazily because this file is
// compiled to CommonJS, where top-level await is unavailable.

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const NodeModule = require("node:module");

// The watch page reads a cookie, so `next/headers` needs the in-memory jar.
const HEADERS_STUB = join(import.meta.dirname, "..", "..", "test-harness", "stubs", "next-headers.ts");
// The watch page imports `getEpisodeSeo` statically; the double reads a fixed
// EpisodeSeo off `globalThis.__episodeSeo`, so a rendered page needs no database.
const EPISODE_SEO_STUB = join(import.meta.dirname, "..", "..", "test-harness", "stubs", "episode-seo.ts");
const originalResolve = NodeModule._resolveFilename;
NodeModule._resolveFilename = function patched(request: string, ...rest: unknown[]) {
  if (request === "next/headers") return HEADERS_STUB;
  if (request === "@/app/lib/seo/episode-seo") return EPISODE_SEO_STUB;
  return originalResolve.call(this, request, ...rest);
};

type ThumbModule = typeof import("@/app/lib/seo/thumb");
let thumbModule: ThumbModule | null = null;
const thumb = async (): Promise<ThumbModule> => (thumbModule ??= await import("@/app/lib/seo/thumb"));

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGPg5hb5jw8zjAwFAO+TSkHmnF6wAAAAAElFTkSuQmCC",
  "base64",
);
const IMAGE_BYTES = new Uint8Array(PNG_BYTES);

const PUBLIC_LOOKUP = async () => [{ address: "203.0.113.10", family: 4 }];

type FakeCall = { url: string; headers: Record<string, string> };

/** Records every request and answers with a fixed response per URL. */
function fakeFetch(
  handler: (call: FakeCall) => Response | Promise<Response> = () =>
    new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } }),
) {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit | undefined).forEach((value, key) => {
      headers[key] = value;
    });
    const call = { url: String(input), headers };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Candidate deps for thumbnailResponse, with everything injectable. */
async function baseDeps(overrides: Record<string, unknown> = {}) {
  const { THUMB_MAX_BYTES } = await thumb();
  return {
    lookup: PUBLIC_LOOKUP,
    fetchImpl: fakeFetch().fetchImpl,
    timeoutMs: 2000,
    maxBytes: THUMB_MAX_BYTES,
    totalBudgetMs: 5000,
    fallback: async () =>
      new Response(IMAGE_BYTES, {
        status: 200,
        headers: { "content-type": "image/png", "cache-control": "public, max-age=300, s-maxage=300" },
      }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. id / ep validation
// ---------------------------------------------------------------------------

test("parseThumbParams accepts only positive decimal integers", async () => {
  const { parseThumbParams } = await thumb();
  assert.deepEqual(parseThumbParams("21", "2"), { id: 21, episode: 2 });
  assert.deepEqual(parseThumbParams(21, 2), { id: 21, episode: 2 });
  assert.deepEqual(parseThumbParams(" 7 ", " 3 "), { id: 7, episode: 3 });

  for (const [id, ep] of [
    ["abc", "2"],
    ["2", "abc"],
    ["", "2"],
    ["2", ""],
    ["0", "2"],
    ["2", "0"],
    ["-1", "2"],
    ["2", "-3"],
    ["1.5", "2"],
    ["2", "1.5"],
    ["1e3", "2"],
    ["0x10", "2"],
    ["99999999999999", "2"],
    [null, "2"],
    ["2", null],
    [undefined, undefined],
  ] as const) {
    assert.equal(
      parseThumbParams(id as never, ep as never),
      null,
      `${String(id)}/${String(ep)} must be rejected`,
    );
  }
});

test("the route answers 404 for a bad id or ep and never touches the network", async () => {
  const { GET } = await import("@/app/thumb/[id]/[ep]/route");
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    return new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch;

  try {
    for (const [id, ep] of [
      ["abc", "2"],
      ["21", "abc"],
      ["0", "2"],
      ["-4", "2"],
      ["21", "2.5"],
      ["", "1"],
    ]) {
      const response = await GET(new Request(`https://kumoritv.top/thumb/${id}/${ep}`), {
        params: { id, ep },
      });
      assert.equal(response.status, 404, `${id}/${ep} should 404`);
    }
    assert.equal(networkCalls, 0, "invalid params must not reach fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the route declares the nodejs runtime and a 15 s budget", async () => {
  const route = await import("@/app/thumb/[id]/[ep]/route");
  assert.equal((route as any).runtime, "nodejs");
  assert.equal((route as any).maxDuration, 15);
  assert.equal(typeof (route as any).GET, "function");
});

// ---------------------------------------------------------------------------
// 2. Candidate order, from our own tables
// ---------------------------------------------------------------------------

test("candidates come from episodes.image_url, then banner, then cover", async () => {
  const { readThumbCandidates } = await thumb();
  const { FakeSupabaseClient } = await import("../../test-harness/fake-supabase");
  const db = new FakeSupabaseClient({
    episodes: [
      { anilist_id: 21, episode_number: 2, image_url: "https://provider.example/ep2.jpg" },
      { anilist_id: 21, episode_number: 3, image_url: "https://provider.example/ep3.jpg" },
    ],
    anime: [
      {
        anilist_id: 21,
        banner_url: "https://s4.anilist.co/banner.jpg",
        cover_url: "https://s4.anilist.co/cover.jpg",
      },
    ],
  });

  assert.deepEqual(await readThumbCandidates(db, 21, 2), [
    "https://provider.example/ep2.jpg",
    "https://s4.anilist.co/banner.jpg",
    "https://s4.anilist.co/cover.jpg",
  ]);
});

test("a missing episode image falls back to the banner, then to the cover", async () => {
  const { readThumbCandidates } = await thumb();
  const { FakeSupabaseClient } = await import("../../test-harness/fake-supabase");

  const bannerOnly = new FakeSupabaseClient({
    episodes: [{ anilist_id: 21, episode_number: 2, image_url: null }],
    anime: [
      {
        anilist_id: 21,
        banner_url: "https://s4.anilist.co/banner.jpg",
        cover_url: "https://s4.anilist.co/cover.jpg",
      },
    ],
  });
  assert.deepEqual(await readThumbCandidates(bannerOnly, 21, 2), [
    "https://s4.anilist.co/banner.jpg",
    "https://s4.anilist.co/cover.jpg",
  ]);

  const coverOnly = new FakeSupabaseClient({
    episodes: [],
    anime: [{ anilist_id: 21, banner_url: null, cover_url: "https://s4.anilist.co/cover.jpg" }],
  });
  assert.deepEqual(await readThumbCandidates(coverOnly, 21, 2), ["https://s4.anilist.co/cover.jpg"]);
});

test("candidate lookup never throws and never asks AniList", async () => {
  const { readThumbCandidates } = await thumb();
  const { FakeSupabaseClient } = await import("../../test-harness/fake-supabase");
  const db = new FakeSupabaseClient({});
  db.failOn("episodes", "boom");
  db.failOn("anime", "boom");

  const originalFetch = globalThis.fetch;
  let anilistCalls = 0;
  globalThis.fetch = (async () => {
    anilistCalls += 1;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    assert.deepEqual(await readThumbCandidates(db, 21, 2), []);
    assert.deepEqual(await readThumbCandidates(null, 21, 2), []);
    assert.equal(anilistCalls, 0, "no network call is made to find the source image");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the first candidate that works wins; later ones are never fetched", async () => {
  const { thumbnailResponse } = await thumb();
  const attempts: string[] = [];
  const { fetchImpl } = fakeFetch((call) => {
    attempts.push(call.url);
    if (call.url.includes("/ep2.jpg")) return new Response("nope", { status: 500 });
    return new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
  });

  const response = await thumbnailResponse(
    { id: "21", ep: "2" },
    (await baseDeps({
      fetchImpl,
      candidates: async () => [
        "https://provider.example/ep2.jpg",
        "https://s4.anilist.co/banner.jpg",
        "https://s4.anilist.co/cover.jpg",
      ],
    })) as never,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(attempts, ["https://provider.example/ep2.jpg", "https://s4.anilist.co/banner.jpg"]);
});

test("an episode image wins over the banner and cover", async () => {
  const { thumbnailResponse } = await thumb();
  const { calls, fetchImpl } = fakeFetch();
  const response = await thumbnailResponse(
    { id: "21", ep: "2" },
    (await baseDeps({
      fetchImpl,
      candidates: async () => ["https://provider.example/ep2.jpg", "https://s4.anilist.co/banner.jpg"],
    })) as never,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://provider.example/ep2.jpg"],
  );
});

// ---------------------------------------------------------------------------
// 3. SSRF guard
// ---------------------------------------------------------------------------

test("private, loopback, link-local and non-https targets are refused before any fetch", async () => {
  const { fetchThumbImage, isPrivateAddress } = await thumb();

  for (const address of [
    "127.0.0.1",
    "127.10.1.2",
    "10.0.0.5",
    "10.255.255.254",
    "192.168.1.10",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.1",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} must count as private`);
    const { calls, fetchImpl } = fakeFetch();
    const result = await fetchThumbImage("https://art.example/x.jpg", {
      lookup: async () => [{ address }],
      fetchImpl,
    });
    assert.equal(result, null, `${address} must be refused`);
    assert.equal(calls.length, 0, `${address} must not be fetched`);
  }

  // A public address is fine, so the guard is not simply refusing everything.
  assert.equal(isPrivateAddress("203.0.113.10"), false);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("http, localhost, bare private IPs and hostile redirect hops are refused", async () => {
  const { assertPublicImageUrl } = await thumb();

  const rejected = [
    "http://cdn.example/a.jpg",
    "ftp://cdn.example/a.jpg",
    "https://localhost/a.jpg",
    "https://user:pass@cdn.example/a.jpg",
    "https://10.0.0.4/a.jpg",
    "https://192.168.0.4/a.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.jpg",
  ];
  for (const url of rejected) {
    await assert.rejects(assertPublicImageUrl(url, { lookup: PUBLIC_LOOKUP }), `${url} must be refused`);
  }

  // A hostname whose DNS answer is private, and one with a private answer mixed in.
  await assert.rejects(
    assertPublicImageUrl("https://rebind.example/a.jpg", {
      lookup: async () => [{ address: "10.1.2.3", family: 4 }],
    }),
  );
  await assert.rejects(
    assertPublicImageUrl("https://mixed.example/a.jpg", {
      lookup: async () => [
        { address: "203.0.113.10", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
  );

  const ok = await assertPublicImageUrl("https://cdn.example/a.jpg", { lookup: PUBLIC_LOOKUP });
  assert.equal(ok.protocol, "https:");
});

test("a redirect to a private address is refused, and the private hop is never requested", async () => {
  const { fetchThumbImage } = await thumb();
  const { calls, fetchImpl } = fakeFetch((call) => {
    if (call.url === "https://cdn.example/start.jpg") {
      return new Response(null, { status: 302, headers: { location: "https://10.0.0.9/secret.jpg" } });
    }
    return new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
  });

  const result = await fetchThumbImage("https://cdn.example/start.jpg", {
    fetchImpl,
    lookup: PUBLIC_LOOKUP,
  });
  assert.equal(result, null);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://cdn.example/start.jpg"],
  );
});

test("a redirect hop whose hostname resolves privately is refused (and never requested)", async () => {
  const { fetchThumbImage } = await thumb();
  const lookup = async (hostname: string) =>
    hostname === "internal.example"
      ? [{ address: "10.0.0.7", family: 4 }]
      : [{ address: "203.0.113.10", family: 4 }];

  const { calls, fetchImpl } = fakeFetch((call) => {
    if (call.url === "https://cdn.example/start.jpg") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://internal.example/hidden.jpg" },
      });
    }
    return new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
  });

  const result = await fetchThumbImage("https://cdn.example/start.jpg", { fetchImpl, lookup });
  assert.equal(result, null);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://cdn.example/start.jpg"],
  );
});

test("a relative redirect on a public host is followed", async () => {
  const { fetchThumbImage } = await thumb();
  const { calls, fetchImpl } = fakeFetch((call) => {
    if (call.url === "https://cdn.example/start.jpg") {
      return new Response(null, { status: 307, headers: { location: "/next.jpg" } });
    }
    return new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
  });

  const result = await fetchThumbImage("https://cdn.example/start.jpg", {
    fetchImpl,
    lookup: PUBLIC_LOOKUP,
  });
  assert.ok(result, "the redirect is followed");
  assert.equal(result!.bytes.byteLength, IMAGE_BYTES.byteLength);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://cdn.example/start.jpg", "https://cdn.example/next.jpg"],
  );
});

test("at most two redirects are followed", async () => {
  const { fetchThumbImage } = await thumb();
  let hop = 0;
  const { calls, fetchImpl } = fakeFetch(() => {
    hop += 1;
    return new Response(null, { status: 302, headers: { location: `https://cdn.example/hop-${hop}.jpg` } });
  });

  const result = await fetchThumbImage("https://cdn.example/start.jpg", {
    fetchImpl,
    lookup: PUBLIC_LOOKUP,
  });
  assert.equal(result, null);
  assert.equal(calls.length, 3, "the initial request plus two redirects");
});

test("the upstream request carries only our user agent and an image accept header", async () => {
  const { fetchThumbImage, THUMB_USER_AGENT } = await thumb();
  const { calls, fetchImpl } = fakeFetch();
  await fetchThumbImage("https://provider.example/ep2.jpg", { fetchImpl, lookup: PUBLIC_LOOKUP });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["user-agent"], THUMB_USER_AGENT);
  assert.equal(calls[0].headers["user-agent"], "KumoriTV");
  assert.equal(calls[0].headers["accept"], "image/*");
  assert.equal(calls[0].headers["cookie"], undefined, "no cookie is forwarded upstream");
});

// ---------------------------------------------------------------------------
// 4. Content-Type and size rules
// ---------------------------------------------------------------------------

test("only image/* responses are accepted", async () => {
  const { fetchThumbImage } = await thumb();
  for (const contentType of ["text/html", "application/json", "text/plain", ""]) {
    const { fetchImpl } = fakeFetch(
      () => new Response("<html>blocked</html>", { status: 200, headers: { "content-type": contentType } }),
    );
    const result = await fetchThumbImage("https://provider.example/ep2.jpg", {
      fetchImpl,
      lookup: PUBLIC_LOOKUP,
    });
    assert.equal(result, null, `content-type ${contentType || "(none)"} must be refused`);
  }

  const { fetchImpl } = fakeFetch(
    () => new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/webp; charset=binary" } }),
  );
  const accepted = await fetchThumbImage("https://provider.example/ep2.jpg", {
    fetchImpl,
    lookup: PUBLIC_LOOKUP,
  });
  assert.equal(accepted?.contentType, "image/webp; charset=binary");
});

test("a body over 3 MB is cut off instead of buffered", async () => {
  const { fetchThumbImage, THUMB_MAX_BYTES } = await thumb();
  const chunkSize = 64 * 1024;
  const chunksAvailable = 100; // 6.25 MB
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunksAvailable) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });

  const { fetchImpl } = fakeFetch(
    () => new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } }),
  );

  const result = await fetchThumbImage("https://provider.example/huge.jpg", {
    fetchImpl,
    lookup: PUBLIC_LOOKUP,
    maxBytes: THUMB_MAX_BYTES,
  });

  assert.equal(result, null);
  assert.equal(THUMB_MAX_BYTES, 3 * 1024 * 1024);
  assert.ok(pulled < chunksAvailable, `stopped reading after ${pulled} of ${chunksAvailable} chunks`);
  assert.ok(pulled <= Math.ceil(THUMB_MAX_BYTES / chunkSize) + 2, `read ${pulled} chunks past the cap`);
});

test("a declared Content-Length over the cap is refused without reading the body", async () => {
  const { fetchThumbImage, THUMB_MAX_BYTES } = await thumb();
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(IMAGE_BYTES, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(THUMB_MAX_BYTES + 1) },
      }),
  );
  const result = await fetchThumbImage("https://provider.example/big.jpg", {
    fetchImpl,
    lookup: PUBLIC_LOOKUP,
  });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// 5. Fallback to the OG card
// ---------------------------------------------------------------------------

test("when nothing works the OG card for the same id/episode is returned", async () => {
  const { thumbnailResponse } = await thumb();
  const asked: Array<{ id: number; episode: number }> = [];
  const response = await thumbnailResponse(
    { id: "21", ep: "2" },
    (await baseDeps({
      fetchImpl: fakeFetch(() => new Response("blocked", { status: 403 })).fetchImpl,
      candidates: async () => ["https://provider.example/ep2.jpg", "https://s4.anilist.co/banner.jpg"],
      fallback: async (input: { id: number; episode: number }) => {
        asked.push(input);
        return new Response(IMAGE_BYTES, {
          status: 200,
          headers: { "content-type": "image/png", "cache-control": "public, max-age=300, s-maxage=300" },
        });
      },
    })) as never,
  );

  assert.deepEqual(asked, [{ id: 21, episode: 2 }]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("no candidates at all also lands on the card", async () => {
  const { thumbnailResponse } = await thumb();
  let fallbacks = 0;
  const response = await thumbnailResponse(
    { id: "21", ep: "2" },
    (await baseDeps({
      candidates: async () => [],
      fallback: async () => {
        fallbacks += 1;
        return new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/png" } });
      },
    })) as never,
  );
  assert.equal(fallbacks, 1);
  assert.equal(response.status, 200);
});

test("a throwing candidate lookup still answers with an image", async () => {
  const { thumbnailResponse } = await thumb();
  const response = await thumbnailResponse(
    { id: "21", ep: "2" },
    (await baseDeps({
      candidates: async () => {
        throw new Error("db down");
      },
    })) as never,
  );
  assert.equal(response.status, 200);
  assert.ok((response.headers.get("content-type") || "").startsWith("image/"));
});

test("the real route falls back to the real OG card when the database has nothing", async () => {
  const { GET } = await import("@/app/thumb/[id]/[ep]/route");
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SITE_URL;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(
        JSON.stringify({
          data: {
            Media: {
              id: 21,
              title: { romaji: "One Piece", english: "One Piece" },
              description: "<p>Pirates.</p>",
              format: "TV",
              bannerImage: "https://s4.anilist.co/banner.jpg",
              coverImage: { extraLarge: "https://s4.anilist.co/cover.jpg" },
              streamingEpisodes: [],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(IMAGE_BYTES, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;

  try {
    const response = await GET(new Request("https://kumoritv.top/thumb/21/2"), {
      params: { id: "21", ep: "2" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-disposition"), null);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("hex"), "89504e47", "a real PNG card");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    if (previousSite !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previousSite;
  }
});

// ---------------------------------------------------------------------------
// 6. Response headers
// ---------------------------------------------------------------------------

test("a proxied image carries the long cache headers, nosniff and no content-disposition", async () => {
  const { thumbnailResponse, thumbImageResponse, THUMB_CACHE_CONTROL } = await thumb();
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(IMAGE_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "set-cookie": "session=leak",
          "content-disposition": 'attachment; filename="evil.jpg"',
          "x-upstream-header": "leak",
        },
      }),
  );

  const response = await thumbnailResponse(
    { id: "21", ep: "2" },
    (await baseDeps({
      fetchImpl,
      candidates: async () => ["https://provider.example/ep2.jpg"],
    })) as never,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800",
  );
  assert.equal(response.headers.get("cache-control"), THUMB_CACHE_CONTROL);
  assert.ok(THUMB_CACHE_CONTROL.includes("max-age=86400"));
  assert.ok(THUMB_CACHE_CONTROL.includes("s-maxage=2592000"));
  assert.ok(THUMB_CACHE_CONTROL.includes("stale-while-revalidate=604800"));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-disposition"), null, "no Content-Disposition");
  assert.equal(response.headers.get("set-cookie"), null, "upstream cookies are not passed through");
  assert.equal(response.headers.get("x-upstream-header"), null, "upstream headers are not passed through");

  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.byteLength, IMAGE_BYTES.byteLength);

  const direct = thumbImageResponse({ bytes: IMAGE_BYTES, contentType: "image/png" });
  assert.equal(direct.status, 200);
  assert.equal(direct.headers.get("cache-control"), THUMB_CACHE_CONTROL);
  assert.equal(direct.headers.get("x-content-type-options"), "nosniff");
  assert.equal(direct.headers.get("content-disposition"), null);
});

// ---------------------------------------------------------------------------
// 7. The watch page emits the /thumb URL for VideoObject
// ---------------------------------------------------------------------------

function walk(node: any, visit: (element: any) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node.$$typeof) visit(node);
  const children = node.props?.children;
  if (children !== undefined) walk(children, visit);
}

const MEDIA_PAYLOAD = {
  Media: {
    id: 21,
    title: { romaji: "One Piece", english: "One Piece", native: "ワンピース", userPreferred: "One Piece" },
    description: "<p>Pirates.</p>",
    format: "TV",
    status: "RELEASING",
    season: "FALL",
    seasonYear: 1999,
    episodes: 1100,
    duration: 24,
    genres: ["Action"],
    bannerImage: "https://s4.anilist.co/banner.jpg",
    coverImage: {
      extraLarge: "https://s4.anilist.co/cover-xl.jpg",
      large: "https://s4.anilist.co/cover.jpg",
      color: "#123456",
    },
    streamingEpisodes: [{ title: "Episode 2 - The Great Swordsman", thumbnail: "https://cdn.example/ep2.jpg" }],
    relations: { nodes: [] },
    recommendations: { edges: [] },
    reviews: { nodes: [] },
    characters: { edges: [] },
    studios: { edges: [] },
    nextAiringEpisode: null,
    isAdult: false,
    type: "ANIME",
    trailer: null,
  },
};

test("VideoObject.thumbnailUrl is our own /thumb URL, and episodeImage is untouched", async () => {
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  const originalFetch = globalThis.fetch;
  const EPISODE_IMAGE = "https://provider.example/ep2.jpg";

  (globalThis as { __episodeSeo?: unknown }).__episodeSeo = {
    episodeTitle: "The Great Swordsman",
    synopsis: "Zoro arrives.",
    thumbnailUrl: EPISODE_IMAGE,
    airedAtISO: "1999-11-24T00:00:00+00:00",
    durationISO: "PT24M",
    hasSub: true,
    hasDub: true,
    rowCreatedAtISO: null,
    source: "db",
  };

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: MEDIA_PAYLOAD }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const page = await import("@/app/watch/[id]/page");
    const tree = await (page.default as (props: any) => Promise<any>)({
      params: { id: "21" },
      searchParams: { ep: "2" },
    });

    let jsonLdData: any = null;
    let episodeImage: unknown;
    walk(tree, (element) => {
      const data = element.props?.data;
      if (data && typeof data === "object" && data["@context"] === "https://schema.org") jsonLdData = data;
      if (element.props && "episodeImage" in element.props) episodeImage = element.props.episodeImage;
    });

    assert.ok(jsonLdData, "the page renders its JSON-LD");
    const video = (jsonLdData["@graph"] as any[]).find((node) => node?.["@type"] === "VideoObject");
    assert.ok(video, "the episode exists in the database, so a VideoObject is emitted");
    assert.equal(video.thumbnailUrl, "https://kumoritv.top/thumb/21/2");
    assert.ok(!String(video.thumbnailUrl).includes("provider.example"), "no third-party host in the thumbnail");
    assert.ok(!String(video.thumbnailUrl).includes("/api/"), "the thumbnail is not under the blocked /api/ path");

    assert.equal(episodeImage, EPISODE_IMAGE, "the client-side episode image prop keeps the raw provider URL");
  } finally {
    globalThis.fetch = originalFetch;
    delete (globalThis as { __episodeSeo?: unknown }).__episodeSeo;
    if (previousSite !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previousSite;
  }
});

test("the watch page source builds the thumbnail from /thumb, not from the provider chain", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("app/watch/[id]/page.tsx", "utf8");
  assert.ok(source.includes("thumbnailUrl: absoluteUrl(`/thumb/${id}/${ep}`)"));
  assert.ok(
    !source.includes("plain(media.bannerImage)"),
    "the JSON-LD no longer falls back to the AniList banner",
  );
  assert.ok(
    source.includes("episodeImage={episodeSeo?.thumbnailUrl || undefined}"),
    "the client-side episode image prop is unchanged",
  );
});

// ---------------------------------------------------------------------------
// 8. robots.txt and sitemaps leave /thumb/ alone
// ---------------------------------------------------------------------------

test("robots.txt does not disallow /thumb", async () => {
  const robots = (await import("@/app/robots")).default;
  const result = robots() as { rules: { allow: string; disallow: string | string[] } };
  const disallow = Array.isArray(result.rules.disallow) ? result.rules.disallow : [result.rules.disallow];
  assert.equal(result.rules.allow, "/");
  assert.equal(
    disallow.some((entry) => entry === "/thumb" || entry.startsWith("/thumb/") || entry === "/thumb/*"),
    false,
    "/thumb/ must stay crawlable",
  );
  assert.ok(disallow.includes("/api/"));
});

test("no sitemap lists /thumb/", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const files: string[] = ["app/sitemap.xml/route.ts", "app/lib/sitemap.ts"];
  for (const entry of await readdir("app/sitemaps", { withFileTypes: true })) {
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(`app/sitemaps/${entry.name}`);
    else if (entry.isDirectory()) {
      for (const nested of await readdir(`app/sitemaps/${entry.name}`)) {
        if (nested.endsWith(".ts") || nested.endsWith(".tsx")) {
          files.push(`app/sitemaps/${entry.name}/${nested}`);
        }
      }
    }
  }
  let checked = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8").catch(() => "");
    if (!source) continue;
    checked += 1;
    assert.equal(source.includes("/thumb/"), false, `${file} must not list /thumb/`);
  }
  assert.ok(checked >= 2, `checked ${checked} sitemap sources`);
});
