// Part A fixtures. Every value below comes from real curl output on 2026-11-15
// (Termux) and OVERRIDES the older Prompt 37 notes.
import assert from "node:assert/strict";
import test from "node:test";
import { aniConfig, DEFAULT_MASTER_HOSTS } from "../config";
import {
  ANI_UPSTREAM_HOSTS,
  __resetAniStateForTests,
  aniStats,
  dubMatchesSub,
  isAllowedUpstreamUrl,
  positiveTtlMs,
  validateAniStream,
} from "../client";
import { aniReferer, aniSkipRange, buildAniWinner } from "../stream";
import { languageFromLabel, mapAniSubtitles } from "../subtitles";
import { mergeSkipRanges } from "@/app/lib/watch/skip";
import {
  directSegmentHostsFor,
  directSegmentUrl,
  payloadNeedsReferer,
} from "@/app/lib/proxy/direct-segments";
import type { AniStreamResponse } from "../types";

const MEGAPLAY = "https://megaplay.buzz/";
const SEGMENT_HOSTS = [
  "x1.twilightharbor.space",
  "x2.shadownest.top",
  "x3.mistyhorizon.space",
  "x4.silverorbit.top",
  "x5.eclipseharbor.space",
  "x6.oakhorizon.space",
];

function anikotoStream(overrides: Partial<AniStreamResponse> = {}): AniStreamResponse {
  return {
    provider: "anikoto",
    stream_type: "hls",
    master_url: "https://fetch.nexabloom.top/hls/one-piece/1080/master.m3u8",
    variants: [
      {
        quality: "1080p",
        playlist_url: "https://fetch.nexabloom.top/hls/one-piece/1080/index.m3u8",
        playable: true,
      },
    ],
    subtitles: [],
    headers_required: {
      master_playlist: { Referer: MEGAPLAY },
      subtitles: { Referer: MEGAPLAY },
      // The API says {} here and that is WRONG: segments also need the Referer.
      segments: {},
    },
    url_lifetime: { expiry_known: false },
    intro: [31, 111],
    outro: [1376, 1447],
    mal: {
      mal_id: 21,
      mal_episode: 1,
      stream_verified: true,
      verification: "anikoto_data_mal",
    },
    ...overrides,
  };
}

function zokoStream(): AniStreamResponse {
  return {
    provider: "zokoanime",
    stream_type: "hls",
    master_url: "https://hls.dramahot.top/hls/zoko/1/master.m3u8",
    variants: [{ quality: "1080p", playable: true }],
    subtitles: [],
    headers_required: { master_playlist: { Referer: "https://zokoanime.video/" } },
    intro: null as unknown as undefined,
    outro: null as unknown as undefined,
    mal: { mal_id: 21, mal_episode: 1, stream_verified: true },
  };
}

test("master allow-list: nexabloom accepted, old hosts kept, arbitrary hosts rejected", () => {
  assert.ok(ANI_UPSTREAM_HOSTS.includes("fetch.nexabloom.top"));
  assert.ok(ANI_UPSTREAM_HOSTS.includes("dramahot.top"));
  assert.equal(isAllowedUpstreamUrl("https://fetch.nexabloom.top/a/b.m3u8"), true);
  assert.equal(isAllowedUpstreamUrl("https://cdn2.nexabloom.top/a/b.m3u8"), true);
  assert.equal(isAllowedUpstreamUrl("https://hls1.drama1.cfd/a/b.m3u8"), true);
  assert.equal(isAllowedUpstreamUrl("https://evil.example.com/a.m3u8"), false);
  assert.equal(isAllowedUpstreamUrl("http://fetch.nexabloom.top/a.m3u8"), false);
});

test("ANI_MASTER_HOSTS extends the default list and never shrinks it", () => {
  const before = aniConfig().masterHosts;
  assert.deepEqual(before, DEFAULT_MASTER_HOSTS);
  process.env.ANI_MASTER_HOSTS = "cdn.example.org, *.extra.top";
  try {
    const after = aniConfig().masterHosts;
    assert.ok(after.includes("fetch.nexabloom.top"));
    assert.ok(after.includes("cdn.example.org"));
    assert.ok(after.includes("extra.top"));
  } finally {
    delete process.env.ANI_MASTER_HOSTS;
  }
});

test("the Referer is provider aware and megaplay wins for AniKoto", () => {
  assert.equal(aniReferer(anikotoStream()), MEGAPLAY);
  assert.equal(aniReferer(zokoStream()), "https://zokoanime.video/");
  // No headers at all: the constant fallback is per provider, never one global.
  const bare = anikotoStream({ headers_required: {} });
  assert.equal(aniReferer(bare), MEGAPLAY);
  const bareZoko = zokoStream();
  bareZoko.headers_required = {};
  assert.equal(aniReferer(bareZoko), "https://zokoanime.video/");
});

test("signed headers carry the megaplay Referer for master, variants and segments", () => {
  // The manifest route signs every child URL with `payload.h`, which is exactly
  // `winner.headers`: one token shape for playlist, variant, segment, EXT-X-KEY,
  // EXT-X-MAP and subtitle. If this header is present, all of them have it.
  const winner = buildAniWinner(anikotoStream(), "en");
  assert.ok(winner);
  // streamRequestHeaders lowercases every key, so the browser/route sees one.
  assert.equal(winner.headers.referer, MEGAPLAY);
  assert.equal(
    Object.entries(winner.headers).find(([name]) => name.toLowerCase() === "referer")?.[1],
    MEGAPLAY,
  );
  // Direct segments must be refused for this stream (see the proxy test too).
  assert.equal(payloadNeedsReferer(winner.headers), true);
  assert.deepEqual(directSegmentHostsFor(winner.headers, SEGMENT_HOSTS), []);
  // Without a Referer the operator list still applies (old provider).
  const zoko = buildAniWinner(zokoStream(), "en");
  assert.ok(zoko);
  assert.equal(payloadNeedsReferer(zoko.headers), true); // it also needs one
  const anivexa = directSegmentHostsFor({ "user-agent": "x" }, SEGMENT_HOSTS);
  assert.deepEqual(anivexa, SEGMENT_HOSTS);
});

test("direct segment URLs only match the listed host suffix", () => {
  const base = "https://fetch.nexabloom.top/hls/a/index.m3u8";
  const hosts = ["hls1.drama1.cfd"];
  assert.equal(directSegmentUrl("https://hls1.drama1.cfd/seg-1-v1-a1.jpg", base, hosts), "https://hls1.drama1.cfd/seg-1-v1-a1.jpg");
  assert.equal(directSegmentUrl("https://cdn.hls1.drama1.cfd/seg.jpg", base, hosts), "https://cdn.hls1.drama1.cfd/seg.jpg");
  assert.equal(directSegmentUrl("https://x1.twilightharbor.space/seg.jpg", base, hosts), null);
  assert.equal(directSegmentUrl("http://hls1.drama1.cfd/seg.jpg", base, hosts), null);
  assert.equal(directSegmentUrl("https://hls1.drama1.cfd/seg.jpg", base, []), null);
});

test("language is derived from the label for AniKoto (the field lies)", () => {
  assert.equal(languageFromLabel("English"), "en");
  assert.equal(languageFromLabel("Arabic"), "ar");
  assert.equal(languageFromLabel("French"), "fr");
  assert.equal(languageFromLabel("Thai"), "th");
  assert.equal(languageFromLabel("Russian"), "ru");
  assert.equal(languageFromLabel("German"), "de");
  assert.equal(languageFromLabel("Italian"), "it");
  assert.equal(languageFromLabel("Indonesian"), "id");
  assert.equal(languageFromLabel("Spanish"), "es");
  assert.equal(languageFromLabel("Spanish (- Spanish(Latin America))"), "es-419");
  assert.equal(languageFromLabel("Portuguese (- Portuguese(Brazil))"), "pt-BR");
  assert.equal(languageFromLabel("English SDH"), "en");
  assert.equal(languageFromLabel("Signs & Songs"), "und");
  assert.equal(languageFromLabel(""), "und");
});

test("AniKoto keeps every playable track, all `language:en` labels become real", () => {
  // Naruto: 9 tracks, every one language "en".
  const labels = ["English", "Arabic", "French", "Thai", "Spanish", "Portuguese (- Portuguese(Brazil))", "German", "Italian", "Russian"];
  const tracks = labels.map((label, index) => ({
    url: `https://a.mysubsplay.com/naruto/${index}.vtt`,
    label,
    language: "en",
    kind: "full" as const,
    format: "vtt" as const,
    converted: false,
    playable: true,
    default: index === 0,
  }));
  const mapped = mapAniSubtitles(tracks, "en", "anikoto");
  assert.equal(mapped.length, 9);
  assert.deepEqual(
    mapped.map((track) => track.lang),
    ["en", "ar", "fr", "th", "es", "pt-BR", "de", "it", "ru"],
  );
  assert.equal(mapped[0].default, true);
  // AoT: English, Indonesian, Thai all reported as "en".
  const aot = mapAniSubtitles(
    [
      { url: "https://a.mysubsplay.com/aot/en.vtt", label: "English", language: "en", playable: true, default: true },
      { url: "https://a.mysubsplay.com/aot/id.vtt", label: "Indonesian", language: "en", playable: true },
      { url: "https://a.mysubsplay.com/aot/th.vtt", label: "Thai", language: "en", playable: true },
    ],
    "en",
    "anikoto",
  );
  assert.deepEqual(aot.map((track) => track.lang), ["en", "id", "th"]);
  // ZokoAnime keeps trusting its own field.
  const zoko = mapAniSubtitles(
    [{ url: "https://a.example/en.vtt", label: "Whatever", language: "en", playable: true }],
    "en",
    "zokoanime",
  );
  assert.equal(zoko[0].lang, "en");
  assert.equal(zoko[0].label, "Whatever");
});

test("intro/outro: real markers map, unknowns and junk are dropped", () => {
  assert.deepEqual(aniSkipRange([31, 111]), { start: 31, end: 111 });
  assert.deepEqual(aniSkipRange([0, 80]), { start: 0, end: 80 });
  assert.deepEqual(aniSkipRange([1376, 1447]), { start: 1376, end: 1447 });
  assert.deepEqual(aniSkipRange([642, 728]), { start: 642, end: 728 });
  assert.equal(aniSkipRange([0, 0]), null);
  assert.equal(aniSkipRange(null), null);
  assert.equal(aniSkipRange([Number.NaN, 80]), null);
  assert.equal(aniSkipRange([80, 80]), null);
  assert.equal(aniSkipRange([90, 80]), null);
  assert.equal(aniSkipRange([-5, 80]), null);
});

test("the API's markers reach the player's skip merge and win over AniSkip", () => {
  const winner = buildAniWinner(anikotoStream(), "en");
  assert.ok(winner);
  assert.deepEqual(winner.stream.intro, { start: 31, end: 111 });
  assert.deepEqual(winner.stream.outro, { start: 1376, end: 1447 });
  const merged = mergeSkipRanges(
    { intro: winner.stream.intro, outro: winner.stream.outro },
    { intro: { start: 10, end: 20 }, outro: { start: 1400, end: 1450 }, recap: null },
    1440,
  );
  assert.deepEqual(merged.intro, { start: 31, end: 111 }); // provider wins
  // 1447 > duration 1440: clamped, not dropped and not left past the end.
  assert.deepEqual(merged.outro, { start: 1376, end: 1440 });
  // An unknown marker never hides AniSkip.
  const noMarkers = buildAniWinner(anikotoStream({ intro: [0, 0], outro: [0, 0] }), "en");
  assert.equal(noMarkers?.stream.intro, null);
  const fallback = mergeSkipRanges(
    { intro: noMarkers?.stream.intro ?? null, outro: noMarkers?.stream.outro ?? null },
    { intro: { start: 10, end: 20 } },
  );
  assert.deepEqual(fallback.intro, { start: 10, end: 20 });
});

test("ZokoAnime returns null markers and that stays null", () => {
  const winner = buildAniWinner(zokoStream(), "en");
  assert.equal(winner?.stream.intro, null);
  assert.equal(winner?.stream.outro, null);
});

test("ANIKOTO_REQUIRE_SUBTITLE defaults on; the TTL cap is 15 minutes", () => {
  assert.equal(aniConfig().requireAnikotoSubtitle, true);
  process.env.ANI_ANIKOTO_REQUIRE_SUBTITLE = "0";
  try {
    assert.equal(aniConfig().requireAnikotoSubtitle, false);
  } finally {
    delete process.env.ANI_ANIKOTO_REQUIRE_SUBTITLE;
  }
  assert.equal(positiveTtlMs({ provider: "anikoto" }), 15 * 60_000);
  assert.equal(positiveTtlMs({ provider: "zokoanime" }), 10 * 60_000);
  assert.equal(positiveTtlMs(null), 10 * 60_000);
});

test("dub is rejected when it is byte-identical to the sub answer", () => {
  const sub = "https://fetch.nexabloom.top/hls/52299/1/master.m3u8";
  assert.equal(dubMatchesSub(sub, sub), true);
  assert.equal(dubMatchesSub(sub, `${sub}?audio=dub`), false);
  assert.equal(dubMatchesSub("", sub), false);
});

test("a verified AniKoto body passes validation, an unverified one does not", () => {
  __resetAniStateForTests();
  const body = anikotoStream();
  const started = Date.now();
  const okResult = validateAniStream(body, { malId: 21, episode: 1, started });
  assert.equal(okResult.ok, true);
  const unverified = validateAniStream(
    { ...body, mal: { mal_id: 21, mal_episode: 1, stream_verified: false } },
    { malId: 21, episode: 1, started },
  );
  assert.equal(unverified.ok, false);
});

test("ani-status reports the source of each outcome and per-source counters", () => {
  __resetAniStateForTests();
  const stats = aniStats();
  assert.ok("providers" in stats);
  assert.ok(Array.isArray(stats.lastOutcomes));
  assert.deepEqual(stats.dubGuard, { compared: 0, rejected: 0 });
});

test("no key anywhere: winner json, headers, stats and tokens stay clean", () => {
  const key = "test-key-do-not-leak-0123456789";
  process.env.ANI_API_KEY = key;
  try {
    const winner = buildAniWinner(anikotoStream(), "en");
    assert.ok(winner);
    const serialised = JSON.stringify({
      json: winner.json,
      headers: winner.headers,
      stream: winner.stream,
      subtitles: winner.subtitles,
      stats: aniStats(),
    });
    assert.equal(serialised.includes(key), false);
  } finally {
    delete process.env.ANI_API_KEY;
  }
});
