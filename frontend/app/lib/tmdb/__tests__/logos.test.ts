// Pure helpers behind the TMDB title-logo sync: language/vote selection, the
// TMDB id that comes out of our own `mappings` jsonb, URL hardening, and the
// request flow (fallback, 429, 5xx, disabled).

import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchLogoFor,
  logoUrl,
  pickBestLogo,
  tmdbConfigured,
  tmdbIdFromMappings,
} from "@/app/lib/tmdb/logos";

const originalFetch = globalThis.fetch;
const originalKey = process.env.TMDB_API_KEY;
const originalToken = process.env.TMDB_READ_ACCESS_TOKEN;

function setKeys({ key, token }: { key?: string; token?: string }) {
  delete process.env.TMDB_API_KEY;
  delete process.env.TMDB_READ_ACCESS_TOKEN;

  if (key !== undefined) process.env.TMDB_API_KEY = key;
  if (token !== undefined) process.env.TMDB_READ_ACCESS_TOKEN = token;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalKey === undefined) delete process.env.TMDB_API_KEY;
  else process.env.TMDB_API_KEY = originalKey;

  if (originalToken === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
  else process.env.TMDB_READ_ACCESS_TOKEN = originalToken;
});

// ---------------------------------------------------------------- pickBestLogo

test("pickBestLogo prefers english logos", () => {
  const logo = pickBestLogo([
    { file_path: "/japanese.png", aspect_ratio: 3, width: 900, iso_639_1: "ja", vote_average: 9 },
    { file_path: "/english.png", aspect_ratio: 3.2, width: 800, iso_639_1: "en", vote_average: 5 },
    { file_path: "/neutral.png", aspect_ratio: 3, width: 1000, iso_639_1: null, vote_average: 7 },
  ]);

  assert.deepEqual(logo, { path: "/english.png", aspectRatio: 3.2, width: 800 });
});

test("pickBestLogo falls back to a logo with no language, then anything", () => {
  const neutral = pickBestLogo([
    { file_path: "/korean.png", aspect_ratio: 3, width: 900, iso_639_1: "ko", vote_average: 9 },
    { file_path: "/neutral.png", aspect_ratio: 3, width: 1000, iso_639_1: null, vote_average: 1 },
  ]);

  assert.equal(neutral?.path, "/neutral.png");

  const last = pickBestLogo([
    { file_path: "/korean.png", aspect_ratio: 3, width: 900, iso_639_1: "ko", vote_average: 2 },
    { file_path: "/french.png", aspect_ratio: 3, width: 900, iso_639_1: "fr", vote_average: 4 },
  ]);

  assert.equal(last?.path, "/french.png", "votes decide inside the last group");
});

test("pickBestLogo sorts by votes, then width", () => {
  const byVotes = pickBestLogo([
    { file_path: "/a.png", aspect_ratio: 3, width: 1000, iso_639_1: "en", vote_average: 3 },
    { file_path: "/b.png", aspect_ratio: 3, width: 500, iso_639_1: "en", vote_average: 8 },
  ]);

  assert.equal(byVotes?.path, "/b.png");

  const byWidth = pickBestLogo([
    { file_path: "/small.png", aspect_ratio: 3, width: 400, iso_639_1: "en", vote_average: 5 },
    { file_path: "/wide.png", aspect_ratio: 3, width: 1200, iso_639_1: "en", vote_average: 5 },
  ]);

  assert.equal(byWidth?.path, "/wide.png");
});

test("pickBestLogo ignores entries that cannot be a logo", () => {
  const logo = pickBestLogo([
    { file_path: null, aspect_ratio: 3, width: 900, iso_639_1: "en" },
    { file_path: "/square.png", aspect_ratio: 0.5, width: 900, iso_639_1: "en" },
    { file_path: "/banner.png", aspect_ratio: 9, width: 900, iso_639_1: "en" },
    { file_path: "/tiny.png", aspect_ratio: 3, width: 120, iso_639_1: "en" },
    { file_path: "/../../evil.png", aspect_ratio: 3, width: 900, iso_639_1: "en" },
    { file_path: "/good.png", aspect_ratio: 2.5, width: 640, iso_639_1: "en" },
  ]);

  assert.equal(logo?.path, "/good.png");

  assert.equal(pickBestLogo([]), null);
  assert.equal(pickBestLogo(null), null);
  assert.equal(pickBestLogo("nope"), null);
});

// ---------------------------------------------------------- tmdbIdFromMappings

test("tmdbIdFromMappings reads the Anivexa id", () => {
  assert.equal(tmdbIdFromMappings({ themoviedbId: 37854 }), 37854);
  assert.equal(tmdbIdFromMappings({ themoviedbId: "37854" }), 37854);
  assert.equal(tmdbIdFromMappings({ tmdbId: 1399 }), 1399);
  assert.equal(tmdbIdFromMappings(JSON.stringify({ themoviedbId: 21 })), 21);
});

test("tmdbIdFromMappings rejects anything that is not an id", () => {
  assert.equal(tmdbIdFromMappings(null), null);
  assert.equal(tmdbIdFromMappings(undefined), null);
  assert.equal(tmdbIdFromMappings({}), null);
  assert.equal(tmdbIdFromMappings({ themoviedbId: null }), null);
  assert.equal(tmdbIdFromMappings({ themoviedbId: "abc" }), null);
  assert.equal(tmdbIdFromMappings({ themoviedbId: 0 }), null);
  assert.equal(tmdbIdFromMappings({ themoviedbId: -5 }), null);
  assert.equal(tmdbIdFromMappings({ themoviedbId: 3.5 }), null);
  assert.equal(tmdbIdFromMappings("{not json"), null);
  assert.equal(tmdbIdFromMappings([{ themoviedbId: 5 }]), null);
});

// ---------------------------------------------------------------------- logoUrl

test("logoUrl builds a public TMDB image url", () => {
  assert.equal(logoUrl("/abc123.png"), "https://image.tmdb.org/t/p/w500/abc123.png");
  assert.equal(logoUrl("/abc123.png", "w780"), "https://image.tmdb.org/t/p/w780/abc123.png");
  assert.equal(logoUrl("/abc123.png", "nonsense"), "https://image.tmdb.org/t/p/w500/abc123.png");
});

test("logoUrl refuses anything that is not a TMDB file path", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "abc.png",
    "https://evil.test/logo.png",
    "//evil.test/logo.png",
    "/../secret.png",
    "/abc123.png?x=1",
    "/abc123.exe",
    "/abc/def.png",
  ]) {
    assert.equal(logoUrl(bad as unknown as string), null, `${String(bad)} must be refused`);
  }
});

// -------------------------------------------------------------------- disabled

test("nothing is fetched when TMDB is not configured", async () => {
  setKeys({});

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}");
  }) as typeof fetch;

  assert.equal(tmdbConfigured(), false);
  assert.deepEqual(await fetchLogoFor({ tmdbId: 21, format: "TV" }), { status: "disabled" });
  assert.equal(calls, 0, "a disabled helper makes no request");
});

// --------------------------------------------------------------- fetchLogoFor

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("fetchLogoFor returns the best english logo", async () => {
  setKeys({ key: "test-v3-key" });

  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return jsonResponse({
      logos: [
        { file_path: "/ja.png", aspect_ratio: 3, width: 800, iso_639_1: "ja", vote_average: 9 },
        { file_path: "/en.png", aspect_ratio: 3.5, width: 900, iso_639_1: "en", vote_average: 6 },
      ],
    });
  }) as typeof fetch;

  const result = await fetchLogoFor({ tmdbId: 21, format: "TV" });

  assert.deepEqual(result, { status: "found", logo: { path: "/en.png", aspectRatio: 3.5, width: 900 } });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/tv\/21\/images/);
  assert.match(urls[0], /include_image_language=en%2Cnull/);
});

test("fetchLogoFor tries movie first for a MOVIE, then tv on a 404", async () => {
  setKeys({ key: "test-v3-key" });

  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes("/movie/")) return new Response("not found", { status: 404 });

    return jsonResponse({ logos: [{ file_path: "/tv.png", aspect_ratio: 2, width: 600, iso_639_1: "en" }] });
  }) as typeof fetch;

  const result = await fetchLogoFor({ tmdbId: 999, format: "MOVIE" });

  assert.equal(result.status, "found");
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/movie\/999\/images/);
  assert.match(urls[1], /\/tv\/999\/images/);
});

test("fetchLogoFor answers none when TMDB has nothing usable", async () => {
  setKeys({ token: "v4-token" });

  globalThis.fetch = (async () => jsonResponse({ logos: [] })) as typeof fetch;

  assert.deepEqual(await fetchLogoFor({ tmdbId: 21, format: "TV" }), { status: "none" });
});

test("fetchLogoFor answers none for a missing id without calling TMDB", async () => {
  setKeys({ key: "test-v3-key" });

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as typeof fetch;

  assert.deepEqual(await fetchLogoFor({ tmdbId: null, format: "TV" }), { status: "none" });
  assert.equal(calls, 0);
});

test("fetchLogoFor honours 429 Retry-After", async () => {
  setKeys({ key: "test-v3-key" });

  globalThis.fetch = (async () =>
    new Response("slow down", {
      status: 429,
      headers: { "Retry-After": "12" },
    })) as typeof fetch;

  const result = await fetchLogoFor({ tmdbId: 21, format: "TV" });

  assert.deepEqual(result, { status: "rate_limited", retryAfterMs: 12000 });
});

test("fetchLogoFor reports an error for a 5xx", async () => {
  setKeys({ key: "test-v3-key" });

  globalThis.fetch = (async () => new Response("boom", { status: 503 })) as typeof fetch;

  const result = await fetchLogoFor({ tmdbId: 21, format: "TV" });

  assert.equal(result.status, "error");
});

test("the API key never appears in an error message", async () => {
  const secret = "super-secret-v3-key";
  setKeys({ key: secret });

  // A network failure whose message quotes the request URL (what Node does).
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    throw new TypeError(`request to ${String(input)} failed`);
  }) as typeof fetch;

  const result = await fetchLogoFor({ tmdbId: 21, format: "TV" });

  assert.equal(result.status, "error");
  assert.equal(JSON.stringify(result).includes(secret), false, "the key is never surfaced");
  assert.equal(JSON.stringify(result).includes("api_key"), false);
});

test("a v4 token is sent as a bearer header, never in the url", async () => {
  setKeys({ token: "v4-token-value" });

  const seen: Array<{ url: string; auth: string | null }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url: String(input), auth: headers.Authorization ?? null });

    return jsonResponse({ logos: [] });
  }) as typeof fetch;

  await fetchLogoFor({ tmdbId: 21, format: "TV" });

  assert.equal(seen[0].auth, "Bearer v4-token-value");
  assert.equal(seen[0].url.includes("v4-token-value"), false);
});
