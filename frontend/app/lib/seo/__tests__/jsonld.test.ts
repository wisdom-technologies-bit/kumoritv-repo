import assert from "node:assert/strict";
import test from "node:test";
import {
  anilistStartDateIso,
  buildHomeJsonLd,
  buildMediaJsonLd,
  buildWatchJsonLd,
  pruneJsonLd,
  serializeJsonLd,
} from "../jsonld";

const SITE = "https://kumoritv.vercel.app";

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
  });

const watch = (overrides: Record<string, unknown> = {}) =>
  buildWatchJsonLd({
    id: 21,
    animeName: "One Piece",
    episode: 1089,
    episodeTitle: "A New Era",
    description: "Luffy reaches the final island.",
    imageUrl: `${SITE}/og/21/1089`,
    thumbnailUrl: "https://cdn.example/ep.jpg",
    airedAtISO: "2024-01-07T00:00:00+00:00",
    durationISO: "PT24M",
    url: `${SITE}/watch/21?ep=1089`,
    seriesUrl: `${SITE}/media/21`,
    format: "TV",
    ...overrides,
  });

test("media graph has TVSeries and BreadcrumbList and serialises cleanly", () => {
  const graph = media();
  const nodes = graph["@graph"] as Array<Record<string, unknown>>;
  assert.equal(graph["@context"], "https://schema.org");
  assert.deepEqual(
    nodes.map((node) => node["@type"]),
    ["TVSeries", "BreadcrumbList"],
  );
  const series = nodes[0];
  assert.equal(series.name, "One Piece");
  assert.deepEqual(series.alternateName, ["ワンピース"]);
  assert.equal(series.description, "Pirates hunt a treasure.");
  assert.equal(series.image, `${SITE}/cover.jpg`);
  assert.equal(series.numberOfEpisodes, 1100);
  assert.equal(series.inLanguage, "ja");
  const crumbs = nodes[1].itemListElement as Array<Record<string, unknown>>;
  assert.deepEqual(
    crumbs.map((crumb) => crumb.name),
    ["Home", "One Piece"],
  );

  const json = JSON.stringify(graph);
  assert.ok(!json.includes("aggregateRating"));
  assert.ok(!json.includes("review"));
  assert.ok(!json.includes("undefined"));
});

test("movie media graph uses Movie and drops numberOfEpisodes", () => {
  const nodes = buildMediaJsonLd({
    id: 5,
    name: "Your Name",
    url: `${SITE}/media/5`,
    format: "MOVIE",
    episodes: 1,
  })["@graph"] as Array<Record<string, unknown>>;
  assert.equal(nodes[0]["@type"], "Movie");
  assert.equal(nodes[0].numberOfEpisodes, undefined);
  assert.equal(nodes[0].description, undefined);
});

test("watch graph has TVEpisode, VideoObject and BreadcrumbList", () => {
  const nodes = watch()["@graph"] as Array<Record<string, unknown>>;
  assert.deepEqual(
    nodes.map((node) => node["@type"]),
    ["TVEpisode", "VideoObject", "BreadcrumbList"],
  );
  const episode = nodes[0];
  assert.equal(episode.episodeNumber, 1089);
  assert.equal(episode.name, "A New Era");
  assert.equal(episode.datePublished, "2024-01-07T00:00:00+00:00");
  assert.deepEqual(episode.partOfSeries, {
    "@type": "TVSeries",
    name: "One Piece",
    url: `${SITE}/media/21`,
  });

  const video = nodes[1];
  assert.equal(video.duration, "PT24M");
  assert.equal(video.uploadDate, "2024-01-07T00:00:00+00:00");
  assert.deepEqual(video.thumbnailUrl, [`${SITE}/og/21/1089`, "https://cdn.example/ep.jpg"]);
  assert.equal(video.contentUrl, undefined);
  assert.equal(video.embedUrl, undefined);

  const crumbs = nodes[2].itemListElement as Array<Record<string, unknown>>;
  assert.deepEqual(
    crumbs.map((crumb) => crumb.name),
    ["Home", "One Piece", "Episode 1089"],
  );
});

test("VideoObject is omitted without an upload date or a description", () => {
  const noDate = watch({ airedAtISO: null })["@graph"] as Array<Record<string, unknown>>;
  assert.deepEqual(
    noDate.map((node) => node["@type"]),
    ["TVEpisode", "BreadcrumbList"],
  );
  const noDescription = watch({ description: "<p> </p>" })["@graph"] as Array<Record<string, unknown>>;
  assert.deepEqual(
    noDescription.map((node) => node["@type"]),
    ["TVEpisode", "BreadcrumbList"],
  );
});

test("movies produce Movie plus VideoObject", () => {
  const nodes = watch({ format: "MOVIE", episode: 1, episodeTitle: null })["@graph"] as Array<
    Record<string, unknown>
  >;
  assert.deepEqual(
    nodes.map((node) => node["@type"]),
    ["Movie", "VideoObject", "BreadcrumbList"],
  );
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

test("serialiseJsonLd escapes angle brackets and ampersands", () => {
  const payload = serializeJsonLd({
    "@context": "https://schema.org",
    name: "</script><script>alert(1)</script>",
    description: "Tom & Jerry",
  });
  assert.ok(!payload.includes("</script>"));
  assert.ok(payload.includes("\\u003c"));
  assert.ok(payload.includes("\\u0026"));
  assert.equal(JSON.parse(payload).description, "Tom & Jerry");
});

test("homepage graph is WebSite plus Organization and no SearchAction", () => {
  const graph = buildHomeJsonLd();
  const nodes = graph["@graph"] as Array<Record<string, unknown>>;
  assert.deepEqual(
    nodes.map((node) => node["@type"]),
    ["WebSite", "Organization"],
  );
  assert.equal(nodes[0].name, "KumoriTV");
  assert.equal(nodes[0].alternateName, "Kumori TV");
  assert.equal(nodes[0].url, `${SITE}/`);
  assert.equal(nodes[1].logo, `${SITE}/android-chrome-512.png`);
  assert.ok(!JSON.stringify(graph).includes("SearchAction"));
});

test("start dates need a complete, real calendar date", () => {
  assert.equal(anilistStartDateIso({ year: 2023, month: 9, day: 29 }), "2023-09-29");
  assert.equal(anilistStartDateIso({ year: 2023, month: null, day: null }), null);
  assert.equal(anilistStartDateIso({ year: 2023, month: 2, day: 30 }), null);
  assert.equal(anilistStartDateIso(null), null);
});
