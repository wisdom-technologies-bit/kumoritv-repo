import assert from "node:assert/strict";
import test from "node:test";
import {
  anilistStartDateIso,
  buildHomeJsonLd,
  buildMediaJsonLd,
  buildWatchJsonLd,
  isoDateTime,
  malUrl,
  pruneJsonLd,
  serializeJsonLd,
} from "../jsonld";

const SITE = "https://kumoritv.top";

const media = () =>
  buildMediaJsonLd({
    id: 21,
    name: "One Piece",
    alternateNames: ["One Piece", "One Piece", "ワンピース", ""],
    description: "<p>Pirates hunt a treasure.</p>",
    imageUrl: "/cover.jpg",
    url: `${SITE}/media/21`,
    genres: ["Action", "Adventure"],
    format: "TV",
    startDateISO: "1999-10-20",
    episodes: 1100,
    year: 1999,
    idMal: 13,
    type: "ANIME",
  });

const watch = (overrides: Record<string, unknown> = {}) =>
  buildWatchJsonLd({
    id: 21,
    animeName: "One Piece",
    episode: 1089,
    episodeTitle: "A New Era",
    description: "Luffy reaches the final island.",
    thumbnailUrl: "https://cdn.example/ep.jpg",
    airedAtISO: "2024-01-07T00:00:00+00:00",
    durationISO: "PT24M",
    url: `${SITE}/watch/21?ep=1089`,
    seriesUrl: `${SITE}/media/21`,
    format: "TV",
    playable: true,
    ...overrides,
  });

const typesOf = (graph: Record<string, unknown>) =>
  (graph["@graph"] as Array<Record<string, unknown>>).map((node) => node["@type"]);

// ------------------------------------------------------------------ media page

test("media graph has TVSeries and BreadcrumbList and serialises cleanly", () => {
  const graph = media();
  const nodes = graph["@graph"] as Array<Record<string, unknown>>;
  assert.equal(graph["@context"], "https://schema.org");
  assert.deepEqual(typesOf(graph), ["TVSeries", "BreadcrumbList"]);

  const series = nodes[0];
  assert.equal(series.name, "One Piece");
  assert.deepEqual(series.alternateName, ["ワンピース"]);
  assert.equal(series.description, "Pirates hunt a treasure.");
  assert.equal(series.image, `${SITE}/cover.jpg`);
  assert.equal(series.numberOfEpisodes, 1100);
  assert.equal(series.inLanguage, "ja");
  assert.equal(series.url, `${SITE}/media/21`);
  assert.equal(series.startDate, "1999-10-20T00:00:00+00:00");
  assert.deepEqual(series.genre, ["Action", "Adventure"]);
  assert.deepEqual(series.sameAs, ["https://anilist.co/anime/21", "https://myanimelist.net/anime/13"]);
  assert.deepEqual(series.potentialAction, {
    "@type": "WatchAction",
    target: `${SITE}/watch/21?ep=1`,
  });

  const crumbs = nodes[1].itemListElement as Array<Record<string, unknown>>;
  assert.deepEqual(
    crumbs.map((crumb) => crumb.name),
    ["Home", "One Piece"],
  );

  const json = JSON.stringify(graph);
  assert.ok(!json.includes("aggregateRating"), "the AniList score is not our rating");
  assert.ok(!json.includes("undefined"));
});

test("movie media graph uses Movie and drops numberOfEpisodes", () => {
  const nodes = buildMediaJsonLd({
    id: 5,
    name: "Your Name",
    url: `${SITE}/media/5`,
    format: "MOVIE",
    episodes: 1,
    idMal: 21519,
  })["@graph"] as Array<Record<string, unknown>>;
  assert.equal(nodes[0]["@type"], "Movie");
  assert.equal(nodes[0].numberOfEpisodes, undefined);
  assert.equal(nodes[0].description, undefined);
  assert.equal(nodes[0].startDate, undefined, "a movie carries datePublished, not startDate");
  assert.deepEqual(nodes[0].sameAs, [
    "https://anilist.co/anime/5",
    "https://myanimelist.net/anime/21519",
  ]);
});

test("manga pages never claim to be a TVSeries", () => {
  const nodes = buildMediaJsonLd({
    id: 30013,
    name: "One Piece",
    url: `${SITE}/media/30013`,
    format: "MANGA",
    type: "MANGA",
    idMal: 13,
    episodes: 1100,
  })["@graph"] as Array<Record<string, unknown>>;
  assert.equal(nodes[0]["@type"], "Book");
  assert.equal(nodes[0].numberOfEpisodes, undefined);
  assert.deepEqual(nodes[0].sameAs, [
    "https://anilist.co/manga/30013",
    "https://myanimelist.net/manga/13",
  ]);
});

test("sameAs keeps the AniList page and only adds MyAnimeList when idMal exists", () => {
  const without = buildMediaJsonLd({ id: 21, name: "One Piece", url: `${SITE}/media/21`, format: "TV" })[
    "@graph"
  ] as Array<Record<string, unknown>>;
  assert.deepEqual(without[0].sameAs, ["https://anilist.co/anime/21"]);
  assert.equal(malUrl(13, "ANIME"), "https://myanimelist.net/anime/13");
  assert.equal(malUrl(13, "MANGA"), "https://myanimelist.net/manga/13");
  assert.equal(malUrl(0, "ANIME"), null);
  assert.equal(malUrl(Number.NaN, "ANIME"), null);
});

// ------------------------------------------------------------------ watch page

test("watch graph has TVEpisode, VideoObject and BreadcrumbList", () => {
  const nodes = watch()["@graph"] as Array<Record<string, unknown>>;
  assert.deepEqual(typesOf(watch()), ["TVEpisode", "VideoObject", "BreadcrumbList"]);

  const episode = nodes[0];
  assert.equal(episode.episodeNumber, 1089);
  assert.equal(episode.name, "A New Era");
  assert.equal(episode.datePublished, "2024-01-07T00:00:00.000Z");
  assert.deepEqual(episode.partOfSeries, {
    "@type": "TVSeries",
    name: "One Piece",
    url: `${SITE}/media/21`,
  });

  const video = nodes[1];
  assert.equal(video.name, "One Piece Episode 1089");
  assert.equal(video.duration, "PT24M");
  assert.equal(video.uploadDate, "2024-01-07T00:00:00.000Z");
  assert.match(String(video.uploadDate), /(Z|[+-]\d{2}:\d{2})$/, "uploadDate has a timezone");
  assert.equal(video.thumbnailUrl, "https://cdn.example/ep.jpg");
  assert.equal(video.embedUrl, `${SITE}/watch/21?ep=1089`, "the canonical page is the embed page");
  assert.equal(video.inLanguage, "ja");
  assert.equal(video.isFamilyFriendly, true);
  assert.equal(video.contentUrl, undefined, "stream URLs expire, so they are never published");

  const crumbs = nodes[2].itemListElement as Array<Record<string, unknown>>;
  assert.deepEqual(
    crumbs.map((crumb) => crumb.name),
    ["Home", "One Piece", "Episode 1089"],
  );
});

test("VideoObject is only emitted when the episode is in our episodes table", () => {
  assert.deepEqual(typesOf(watch({ playable: false })), ["TVEpisode", "BreadcrumbList"]);
  assert.deepEqual(typesOf(watch({ playable: undefined })), ["TVEpisode", "BreadcrumbList"]);
  assert.deepEqual(typesOf(watch({ playable: true })), ["TVEpisode", "VideoObject", "BreadcrumbList"]);
});

test("uploadDate falls back to the row timestamp and always has a timezone", () => {
  const nodes = watch({
    airedAtISO: null,
    rowCreatedAtISO: "2025-03-02T10:11:12.000Z",
  })["@graph"] as Array<Record<string, unknown>>;
  const video = nodes[1];
  assert.equal(video.uploadDate, "2025-03-02T10:11:12.000Z");
  assert.match(String(video.uploadDate), /(Z|[+-]\d{2}:\d{2})$/, "uploadDate carries a timezone");

  // No date at all means no VideoObject: Google requires uploadDate.
  assert.deepEqual(typesOf(watch({ airedAtISO: null, rowCreatedAtISO: null })), [
    "TVEpisode",
    "BreadcrumbList",
  ]);
});

test("no signed or proxy stream URL ever reaches the output", () => {
  // The only stream information a caller could hand over is a title-level
  // thumbnail and free-text description; neither becomes contentUrl.
  const payload = JSON.stringify(watch());
  assert.ok(!payload.includes("contentUrl"), "contentUrl is never emitted");
  assert.ok(!payload.includes(".m3u8"), "no manifest URL");
  assert.ok(!payload.includes("token="), "no signed query string");
  assert.ok(!/https?:\/\/[^"]*(stream|proxy|play_id)/i.test(payload), "no stream/proxy host");

  const video = (watch()["@graph"] as Array<Record<string, unknown>>)[1];
  assert.deepEqual(Object.keys(video).sort(), [
    "@type",
    "description",
    "duration",
    "embedUrl",
    "inLanguage",
    "isFamilyFriendly",
    "name",
    "thumbnailUrl",
    "uploadDate",
  ]);
});

test("movies produce Movie plus VideoObject", () => {
  assert.deepEqual(typesOf(watch({ format: "MOVIE", episode: 1, episodeTitle: null })), [
    "Movie",
    "VideoObject",
    "BreadcrumbList",
  ]);
});

test("adult titles are marked not family friendly", () => {
  const nodes = watch({ isFamilyFriendly: false })["@graph"] as Array<Record<string, unknown>>;
  assert.equal(nodes[1].isFamilyFriendly, false);
});

test("no undefined, null or empty fields survive pruning", () => {
  const nodes = watch()["@graph"] as Array<Record<string, unknown>>;
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        assert.notEqual(entry, undefined, `${key} is undefined`);
        assert.notEqual(entry, null, `${key} is null`);
        if (typeof entry === "string") assert.ok(entry.trim().length > 0, `${key} is empty`);
        walk(entry);
      }
    }
  };
  walk(nodes);
  assert.deepEqual(pruneJsonLd({ a: undefined, b: "", c: [], d: {}, e: 0, f: false }), {
    e: 0,
    f: false,
  });
});

// ------------------------------------------------------------------ serialiser

test("serialiseJsonLd escapes angle brackets, ampersands and JS line separators", () => {
  const payload = serializeJsonLd({
    "@context": "https://schema.org",
    name: "</script><script>alert(1)</script>",
    description: "Tom & Jerry\u2028and\u2029more",
    other: "a > b",
  });
  assert.ok(!payload.includes("</script>"));
  assert.ok(!payload.includes("\u2028"));
  assert.ok(!payload.includes("\u2029"));
  assert.ok(payload.includes("\\u003c"));
  assert.ok(payload.includes("\\u003e"));
  assert.ok(payload.includes("\\u0026"));
  assert.ok(payload.includes("\\u2028"));
  assert.ok(payload.includes("\\u2029"));

  const parsed = JSON.parse(payload);
  assert.equal(parsed.name, "</script><script>alert(1)</script>");
  assert.equal(parsed.description, "Tom & Jerry\u2028and\u2029more");
  assert.equal(parsed.other, "a > b");
});

// ------------------------------------------------------------------ dates

test("isoDateTime always returns ISO 8601 with a timezone", () => {
  assert.equal(isoDateTime("2024-01-07"), "2024-01-07T00:00:00+00:00");
  assert.equal(isoDateTime("2024-01-07T18:09:03Z"), "2024-01-07T18:09:03.000Z");
  assert.equal(isoDateTime("2024-01-07T18:09:03+01:00"), "2024-01-07T17:09:03.000Z");
  assert.equal(isoDateTime(""), null);
  assert.equal(isoDateTime("not a date"), null);
  assert.equal(isoDateTime(null), null);
});

test("start dates need a complete, real calendar date", () => {
  assert.equal(anilistStartDateIso({ year: 2023, month: 9, day: 29 }), "2023-09-29");
  assert.equal(anilistStartDateIso({ year: 2023, month: null, day: null }), null);
  assert.equal(anilistStartDateIso({ year: 2023, month: 2, day: 30 }), null);
  assert.equal(anilistStartDateIso(null), null);
});
