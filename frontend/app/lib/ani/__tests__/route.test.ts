/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures and stub transports carry deliberately malformed payloads */
// The watch route with ani ahead of Anivexa: first success, every fallback,
// explicit mode, the dub gate, the rollout bucket, and the flag-off snapshot.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANIVEXA_PROVIDER,
  TEST_ANI_KEY,
  startWatchHarness,
  type WatchHarness,
} from "./watch-harness";
import { verifyToken } from "@/app/lib/proxy/signing";
import { aniBucket } from "@/app/lib/ani/config";
import { SUB_STREAM } from "./standin";

const here = dirname(fileURLToPath(import.meta.url));
const MASTER_SNAPSHOT = JSON.parse(
  readFileSync(join(here, "fixtures", "watch-anivexa-only.snapshot.json"), "utf8"),
);

let harness: WatchHarness;

before(async () => {
  harness = await startWatchHarness();
});

after(async () => {
  await harness.close();
});

const tokenOf = (url: string) =>
  decodeURIComponent(new URLSearchParams(url.split("?")[1]).get("t") || "");

// ------------------------------------------------------------- ani goes first

test("ani is tried first, wins, and Anivexa is never asked", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";

  const { status, body } = await harness.call({ audio: "sub", sublang: "first" });

  assert.equal(status, 200);
  assert.equal(body.provider, "ani");
  assert.equal(body.server, "Kumori");
  assert.equal(body.type, "hls");
  assert.equal(body.hasBackup, true, "Anivexa stays one click away");
  assert.deepEqual(body.servers, [{ id: "kumori", label: "Kumori", active: true }]);
  assert.equal(body.serverId, "kumori");
  assert.equal(body.intro, null);
  assert.equal(body.outro, null);
  assert.deepEqual(body.availableAudio, ["sub", "dub"]);
  assert.match(body.url, /^\/api\/proxy\/manifest\?t=/);

  assert.equal(harness.standin.state.aniCalls.length, 1);
  assert.equal(harness.standin.state.anivexaCalls, 0);
  assert.deepEqual(harness.standin.state.episodePatches, [], "ani is never written back");

  const call = harness.standin.state.aniCalls[0];
  assert.match(call.url, /^\/v1\/streams\/mal\/21\/episode\/1\?/);
  assert.match(call.url, /audio=sub/);
  assert.match(call.url, /quality=best/);
  assert.equal(call.apiKey, TEST_ANI_KEY);
});

test("every provider subtitle track is selectable, with its provider label", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";

  const { body } = await harness.call({ audio: "sub", sublang: "subs-en" });

  assert.deepEqual(
    body.subtitles.map((track: any) => track.label),
    ["English", "English - Signs", "Arabic", "Portuguese - Brazil"],
  );
  assert.deepEqual(
    body.subtitles.map((track: any) => track.lang),
    ["en", "en", "ar", "pt"],
  );
  // The converted SRT track is offered too, and every url is ours.
  assert.ok(
    body.subtitles.every((track: any) => track.url.startsWith("/api/proxy/subtitle?t=")),
  );
  assert.equal(body.subtitles.filter((track: any) => track.default).length, 1);
  assert.ok(body.subtitles.every((track: any) => !("verified" in track)));
});

test("the browser gets our raw master url behind a token, never the key", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";

  const { body } = await harness.call({ audio: "sub", sublang: "token" });
  const token = tokenOf(body.url);
  const payload = await verifyToken(token);

  assert.equal(payload.u, SUB_STREAM.master_url);
  assert.equal(payload.h?.referer, "https://zokoanime.video/");
  assert.equal(token.includes(TEST_ANI_KEY), false);
  assert.equal(JSON.stringify(payload).includes(TEST_ANI_KEY), false);
  assert.equal(JSON.stringify(body).includes(TEST_ANI_KEY), false);

  const subtitle = await verifyToken(tokenOf(body.subtitles[0].url));
  assert.equal(subtitle.u, SUB_STREAM.subtitles[0].url);
  assert.equal(JSON.stringify(subtitle).includes(TEST_ANI_KEY), false);
});

// --------------------------------------------------------------- the fallbacks

const FALLBACKS: [string, any][] = [
  ["a mapping the API does not have", "mal_not_mapped"],
  ["a missing or invalid key", "auth"],
  ["the provider's own rate limit", "rate"],
  ["a 500 from the provider", "error"],
  ["a stream it could not verify", "unverified"],
  ["a stream for a different episode", "mismatch"],
  ["an episode mismatch code", "mal_episode_mismatch"],
  ["an episode that does not exist", "mal_not_found"],
  ["a title source that is down", "title_source"],
];

for (const [label, mode] of FALLBACKS) {
  test(`falls through to Anivexa on ${label}`, async () => {
    await harness.reset();
    process.env.ANI_PROVIDER_ENABLED = "1";
    harness.standin.state.aniMode = mode;

    const { status, body } = await harness.call({
      audio: "sub",
      sublang: `fallback-${mode}`,
    });

    assert.equal(status, 200);
    assert.equal(body.provider, ANIVEXA_PROVIDER);
    // A transient 503 is retried once, so "asked" can be one or two calls.
    assert.ok(harness.standin.state.aniCalls.length >= 1, "ani was asked");
    assert.equal(harness.standin.state.anivexaCalls, 1, "and Anivexa answered");
  });
}

// ------------------------------------------------------------- explicit mode

test("provider=ani never falls back silently", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";
  harness.standin.state.aniMode = "mal_not_mapped";

  const { status, body } = await harness.call({
    audio: "sub",
    sublang: "explicit-fail",
    provider: "ani",
  });

  assert.equal(status, 502);
  assert.equal(body.error, "no_playable_stream");
  assert.equal(body.provider, "ani");
  assert.equal(body.tried[0].provider, "ani");
  assert.equal(body.tried[0].reason, "mal_not_mapped");
  assert.equal(harness.standin.state.anivexaCalls, 0);
  assert.equal(JSON.stringify(body).includes(TEST_ANI_KEY), false);
});

test("provider=ani works when the API does", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";

  const { status, body } = await harness.call({
    audio: "sub",
    sublang: "explicit-ok",
    provider: "ani",
  });

  assert.equal(status, 200);
  assert.equal(body.provider, "ani");
});

test("exclude=ani never calls the API", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";

  const { status, body } = await harness.call({
    audio: "sub",
    sublang: "excluded",
    exclude: "ani",
  });

  assert.equal(status, 200);
  assert.equal(body.provider, ANIVEXA_PROVIDER);
  assert.equal(harness.standin.state.aniCalls.length, 0);
});

test("an Anivexa provider request never touches ani", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";

  const { body } = await harness.call({
    audio: "sub",
    sublang: "pinned",
    provider: ANIVEXA_PROVIDER,
  });

  assert.equal(body.provider, ANIVEXA_PROVIDER);
  assert.equal(harness.standin.state.aniCalls.length, 0);
});

// ------------------------------------------------------------------- refresh

test("refresh=1 bypasses the route cache and asks the API for a fresh stream", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";

  await harness.call({ audio: "sub", sublang: "refresh" });
  assert.equal(harness.standin.state.aniCalls.length, 1);

  // Cached for ten minutes: the second call costs no upstream request.
  const cached = await harness.call({ audio: "sub", sublang: "refresh" });
  assert.equal(cached.body.provider, "ani");
  assert.equal(harness.standin.state.aniCalls.length, 1);

  const refreshed = await harness.call({
    audio: "sub",
    sublang: "refresh",
    refresh: "1",
  });
  assert.equal(refreshed.body.provider, "ani");
  assert.equal(harness.standin.state.aniCalls.length, 2);
  assert.match(harness.standin.state.aniCalls[1].url, /refresh=true/);
});

// ------------------------------------------------------------------ dub gate

test("dub stays with Anivexa until the owner enables it", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";
  process.env.ANI_DUB_ENABLED = "0";

  const { body } = await harness.call({ audio: "dub", sublang: "dub-off" });
  assert.equal(body.provider, ANIVEXA_PROVIDER);
  assert.equal(harness.standin.state.aniCalls.length, 0);
});

test("with ANI_DUB_ENABLED=1 ani serves dub too", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";
  process.env.ANI_DUB_ENABLED = "1";

  const { body } = await harness.call({ audio: "dub", sublang: "dub-on" });
  assert.equal(body.provider, "ani");
  assert.match(harness.standin.state.aniCalls[0].url, /audio=dub/);
});

// ------------------------------------------------------------ rollout + off

test("an anime outside the percentage bucket keeps Anivexa", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";
  const bucket = aniBucket(21);
  process.env.ANI_PROVIDER_PERCENT = String(bucket);

  const outside = await harness.call({ audio: "sub", sublang: "bucket-out" });
  assert.equal(outside.body.provider, ANIVEXA_PROVIDER);
  assert.equal(harness.standin.state.aniCalls.length, 0);

  // The same anime, one percent higher, is inside - and stays inside.
  for (const attempt of [1, 2, 3]) {
    await harness.reset();
    process.env.ANI_PROVIDER_ENABLED = "1";
    process.env.ANI_PROVIDER_PERCENT = String(bucket + 1);
    const inside = await harness.call({
      audio: "sub",
      sublang: `bucket-in-${attempt}`,
    });
    assert.equal(inside.body.provider, "ani", `attempt ${attempt}`);
  }
});

test("with the flag off the response is exactly what master produced", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "0";

  const { status, normalised } = await harness.call({
    audio: "sub",
    sublang: "en",
  });

  assert.equal(status, 200);
  assert.deepEqual(normalised, MASTER_SNAPSHOT);
  assert.equal(harness.standin.state.aniCalls.length, 0);
});

// --------------------------------------------------------------------- trace

test("debug=1 records the ani outcome as reason codes only", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "1";
  harness.standin.state.aniMode = "mal_not_mapped";

  const failed = await harness.call({
    audio: "sub",
    sublang: "dbg-fail",
    debug: "1",
  });
  const entry = failed.body.trace.find((item: any) => item.provider === "ani");
  assert.deepEqual(
    { ...entry, ms: typeof entry.ms },
    { provider: "ani", outcome: "failed", reason: "mal_not_mapped", ms: "number" },
  );
  assert.equal(JSON.stringify(failed.body).includes(TEST_ANI_KEY), false);

  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "0";
  const skipped = await harness.call({
    audio: "sub",
    sublang: "dbg-skip",
    debug: "1",
  });
  const skipEntry = skipped.body.trace.find((item: any) => item.provider === "ani");
  assert.deepEqual(
    { ...skipEntry, ms: typeof skipEntry.ms },
    { provider: "ani", outcome: "skipped", reason: "disabled", ms: "number" },
  );
});

// -------------------------------------------------- no Anivexa providers at all

test("an episode Anivexa has never seen is served by ani, and stays a 404 without it", async () => {
  await harness.reset();
  process.env.ANI_PROVIDER_ENABLED = "0";

  const off = await harness.call(
    { audio: "sub", sublang: "orphan-off" },
    { anilistId: "22" },
  );
  assert.equal(off.status, 404);
  assert.equal(off.body.error, "no_providers");

  process.env.ANI_PROVIDER_ENABLED = "1";
  const on = await harness.call(
    { audio: "sub", sublang: "orphan-on" },
    { anilistId: "22" },
  );
  assert.equal(on.status, 200);
  assert.equal(on.body.provider, "ani");
  assert.equal(on.body.hasBackup, false, "there is no Anivexa provider to fall back to");
});
