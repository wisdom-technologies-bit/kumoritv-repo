/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures and stub transports carry deliberately malformed payloads */
// Validation, caching, single flight, breaker, limiter and the 429 pause.

import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetAniStateForTests,
  getAniStream,
  negativeTtlMs,
  validateAniStream,
  isAllowedUpstreamUrl,
} from "@/app/lib/ani/client";
import { ERRORS, SUB_STREAM } from "./standin";

const BASE_ENV = {
  ANI_API_BASE_URL: "https://ani-api.test",
  ANI_API_KEY: "test-key-SENTINEL-never-print",
  ANI_PROVIDER_ENABLED: "1",
  ANI_PROVIDER_PERCENT: "100",
  ANI_DUB_ENABLED: "0",
  ANI_API_TIMEOUT_MS: "2000",
  ANI_MAX_CONCURRENCY: "4",
  ANI_RATE_PER_MIN: "40",
};

function withEnv(values: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch double that answers from a queue and counts calls. */
function stubFetch(replies: Reply[] | ((url: string) => Reply)) {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : String(input?.url || "");
    calls.push(url);
    const reply = typeof replies === "function" ? replies(url) : replies.shift() || { status: 500 };
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...(reply.headers || {}) },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const streamFor = (overrides: Record<string, any> = {}) => {
  const body = structuredClone(SUB_STREAM);
  return Object.assign(body, overrides);
};

// ---------------------------------------------------------------- validation

test("a verified, https, playable response validates", () => {
  const result = validateAniStream(streamFor(), { malId: 21, episode: 1, started: Date.now() });
  assert.equal(result.ok, true);
});

test("an unverified stream is skipped, never guessed", () => {
  const body = streamFor();
  body.mal.stream_verified = false;
  const result = validateAniStream(body, { malId: 21, episode: 1, started: Date.now() });
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, "unverified_stream");
});

test("a mal id or episode that disagrees with the request is refused", () => {
  const wrongId = streamFor();
  wrongId.mal.mal_id = 22;
  assert.equal(
    (validateAniStream(wrongId, { malId: 21, episode: 1, started: Date.now() }) as any).reason,
    "stream_mismatch",
  );
  const wrongEpisode = streamFor();
  wrongEpisode.mal.mal_episode = 2;
  assert.equal(
    (validateAniStream(wrongEpisode, { malId: 21, episode: 1, started: Date.now() }) as any).reason,
    "stream_mismatch",
  );
});

test("a non-hls stream, a bad master host or no playable variant is refused", () => {
  assert.equal(
    (validateAniStream(streamFor({ stream_type: "dash" }), { malId: 21, episode: 1, started: Date.now() }) as any)
      .reason,
    "not_hls",
  );
  assert.equal(
    (validateAniStream(streamFor({ master_url: "http://hls.dramahot.top/x/master.m3u8" }), {
      malId: 21,
      episode: 1,
      started: Date.now(),
    }) as any).reason,
    "master_host_not_allowed",
  );
  assert.equal(
    (validateAniStream(streamFor({ master_url: "https://evil.example/master.m3u8" }), {
      malId: 21,
      episode: 1,
      started: Date.now(),
    }) as any).reason,
    "master_host_not_allowed",
  );
  const noPlayable = streamFor();
  noPlayable.variants = noPlayable.variants.map((variant: any) => ({ ...variant, playable: false }));
  assert.equal(
    (validateAniStream(noPlayable, { malId: 21, episode: 1, started: Date.now() }) as any).reason,
    "no_playable_variant",
  );
});

test("only the documented upstream hosts are accepted, lookalikes are not", () => {
  assert.equal(isAllowedUpstreamUrl("https://hls.dramahot.top/a/master.m3u8"), true);
  assert.equal(isAllowedUpstreamUrl("https://hls1.drama1.cfd/a/seg_00000.ts.jpg"), true);
  assert.equal(isAllowedUpstreamUrl("https://evil-drama1.cfd/a/seg.ts"), false);
  assert.equal(isAllowedUpstreamUrl("https://dramahot.top.evil.example/a/master.m3u8"), false);
  assert.equal(isAllowedUpstreamUrl("http://hls.dramahot.top/a/master.m3u8"), false);
});

test("negative cache windows follow the failure type", () => {
  assert.equal(negativeTtlMs("mal_not_found"), 30 * 60_000);
  assert.equal(negativeTtlMs("mal_not_mapped"), 30 * 60_000);
  assert.equal(negativeTtlMs("mal_ambiguous"), 30 * 60_000);
  assert.equal(negativeTtlMs("mal_episode_not_found"), 30 * 60_000);
  assert.equal(negativeTtlMs("mal_episode_mismatch"), 60_000);
  assert.equal(negativeTtlMs("upstream_error"), 60_000);
  assert.equal(negativeTtlMs("auth"), 0);
  assert.equal(negativeTtlMs("timeout"), 0);
  assert.equal(negativeTtlMs("rate_limited"), 0);
});

// ------------------------------------------------------- cache and single flight

test("a success is cached for ten minutes, and refresh=1 bypasses it", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const fetchStub = stubFetch([{ status: 200, body: streamFor() }, { status: 200, body: streamFor() }]);
  try {
    const first = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal(first.ok, true);
    const second = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal(second.ok, true);
    assert.equal((second as any).cached, true);
    assert.equal(fetchStub.calls.length, 1);
    assert.match(fetchStub.calls[0], /audio=sub/);
    assert.match(fetchStub.calls[0], /quality=best/);

    await getAniStream({ malId: 21, episode: 1, audio: "sub", refresh: true });
    assert.equal(fetchStub.calls.length, 2);
    assert.match(fetchStub.calls[1], /refresh=true/);
  } finally {
    fetchStub.restore();
    restore();
  }
});

test("the api key is sent as X-API-Key and never appears in a result", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const seen: Record<string, string> = {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    Object.assign(seen, init?.headers || {});
    return new Response(JSON.stringify(streamFor()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal(seen["x-api-key"], BASE_ENV.ANI_API_KEY);
    assert.equal(seen["user-agent"], "KumoriTV");
    assert.equal(JSON.stringify(result).includes(BASE_ENV.ANI_API_KEY), false);
  } finally {
    globalThis.fetch = real;
    restore();
  }
});

test("ten simultaneous callers share one upstream request", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const fetchStub = stubFetch([{ status: 200, body: streamFor() }]);
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => getAniStream({ malId: 21, episode: 1, audio: "sub" })),
    );
    assert.ok(results.every((result) => result.ok));
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
    restore();
  }
});

test("a permanent mapping failure is remembered; a transient one is not", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const fetchStub = stubFetch([
    { status: 404, body: ERRORS.MAL_NOT_MAPPED },
    { status: 500, body: { code: "INTERNAL" } },
    { status: 200, body: streamFor() },
  ]);
  try {
    assert.equal((await getAniStream({ malId: 52299, episode: 1, audio: "sub" })).ok, false);
    assert.equal((await getAniStream({ malId: 52299, episode: 1, audio: "sub" })).ok, false);
    assert.equal(fetchStub.calls.length, 1, "MAL_NOT_MAPPED is cached for 30 minutes");

    // A 500 is cached for a minute only, and is not retried (only 502/503/504 are).
    assert.equal((await getAniStream({ malId: 21, episode: 1, audio: "sub" })).ok, false);
    assert.equal(fetchStub.calls.length, 2);
    assert.equal((await getAniStream({ malId: 21, episode: 1, audio: "sub" })).ok, false);
    assert.equal(fetchStub.calls.length, 2, "a 60 second negative cache, not a permanent one");
  } finally {
    fetchStub.restore();
    restore();
  }
});

test("one retry on a transient 503, and none on a 4xx", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const fetchStub = stubFetch([
    { status: 503, body: ERRORS.MAL_TITLE_SOURCE_UNAVAILABLE },
    { status: 503, body: ERRORS.MAL_TITLE_SOURCE_UNAVAILABLE },
  ]);
  try {
    const result = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal(result.ok, false);
    assert.equal(fetchStub.calls.length, 2, "exactly one retry");
  } finally {
    fetchStub.restore();
    restore();
  }

  const fourEnv = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const four = stubFetch([{ status: 404, body: ERRORS.MAL_NOT_FOUND }]);
  try {
    const result = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal((result as any).reason, "mal_not_found");
    assert.equal(four.calls.length, 1, "a 4xx is an answer, not a hiccup");
  } finally {
    four.restore();
    fourEnv();
  }
});

test("a network error is retried once and reported as network_error", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    const result = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal((result as any).reason, "network_error");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = real;
    restore();
  }
});

test("a 401 is an auth failure and is not retried", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const fetchStub = stubFetch([{ status: 401, body: ERRORS.UNAUTHORIZED }]);
  try {
    const result = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal((result as any).reason, "auth");
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
    restore();
  }
});

// ----------------------------------------------------------- breaker and limiter

test("five failures in a minute open the breaker, which then skips instantly", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const fetchStub = stubFetch(() => ({ status: 500, body: { code: "INTERNAL" } }));
  try {
    for (let episode = 1; episode <= 5; episode++)
      await getAniStream({ malId: 21, episode, audio: "sub" });
    const opened = await getAniStream({ malId: 21, episode: 6, audio: "sub" });
    assert.equal((opened as any).reason, "breaker_open");
    assert.equal(fetchStub.calls.length, 5, "the open breaker costs no upstream call");
  } finally {
    fetchStub.restore();
    restore();
  }
});

test("a 429 pauses the provider for Retry-After instead of hammering it", async () => {
  const restore = withEnv(BASE_ENV);
  __resetAniStateForTests();
  const fetchStub = stubFetch([
    { status: 429, body: ERRORS.RATE_LIMITED, headers: { "retry-after": "30" } },
  ]);
  try {
    const first = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal((first as any).reason, "rate_limited");
    const second = await getAniStream({ malId: 21, episode: 2, audio: "sub" });
    assert.equal((second as any).reason, "paused");
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
    restore();
  }
});

test("the token bucket refuses to queue viewers when it is empty", async () => {
  const restore = withEnv({ ...BASE_ENV, ANI_RATE_PER_MIN: "1" });
  __resetAniStateForTests();
  const fetchStub = stubFetch(() => ({ status: 200, body: streamFor() }));
  try {
    const first = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal(first.ok, true);
    const second = await getAniStream({ malId: 21, episode: 2, audio: "sub" });
    assert.equal((second as any).reason, "saturated");
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
    restore();
  }
});

test("the concurrency cap refuses to queue viewers either", async () => {
  const restore = withEnv({ ...BASE_ENV, ANI_MAX_CONCURRENCY: "1" });
  __resetAniStateForTests();
  const real = globalThis.fetch;
  let release: (() => void) | undefined;
  globalThis.fetch = (async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return new Response(JSON.stringify(streamFor()), { status: 200 });
  }) as typeof fetch;
  try {
    const running = getAniStream({ malId: 21, episode: 1, audio: "sub" });
    const refused = await getAniStream({ malId: 21, episode: 2, audio: "sub" });
    assert.equal((refused as any).reason, "saturated");
    release?.();
    assert.equal((await running).ok, true);
  } finally {
    globalThis.fetch = real;
    restore();
  }
});

test("the provider is off when it is not enabled or not configured", async () => {
  const off = withEnv({ ...BASE_ENV, ANI_PROVIDER_ENABLED: "0" });
  __resetAniStateForTests();
  const fetchStub = stubFetch([]);
  try {
    const result = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal((result as any).reason, "disabled");
    assert.equal(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
    off();
  }

  const unconfigured = withEnv({ ...BASE_ENV, ANI_API_KEY: undefined });
  __resetAniStateForTests();
  const second = stubFetch([]);
  try {
    const result = await getAniStream({ malId: 21, episode: 1, audio: "sub" });
    assert.equal((result as any).reason, "not_configured");
    assert.equal(second.calls.length, 0);
  } finally {
    second.restore();
    unconfigured();
  }
});
