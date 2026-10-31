import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { buildHomeJsonLd, HOME_ITEM_LIST_LIMIT, serializeJsonLd } from "../jsonld";

const SITE = "https://kumoritv.top";

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ url: `/media/${100 + index}` }));

test("homepage graph is WebSite, Organization and exactly one ItemList", () => {
  const graph = buildHomeJsonLd({ items: items(4) });
  const nodes = graph["@graph"] as Array<Record<string, unknown>>;

  assert.deepEqual(
    nodes.map((node) => node["@type"]),
    ["WebSite", "Organization", "ItemList"],
  );
  assert.equal(nodes.filter((node) => node["@type"] === "ItemList").length, 1);
  assert.equal(nodes.filter((node) => node["@type"] === "TVSeries").length, 0, "no invented TVSeries");
  assert.equal(graph["@context"], "https://schema.org");
});

test("WebSite keeps the SearchAction metadata Google retired in 2024", () => {
  const site = (buildHomeJsonLd({ items: items(1) })["@graph"] as Array<Record<string, unknown>>)[0];

  assert.equal(site.name, "KumoriTV");
  assert.equal(site.url, `${SITE}/`);
  assert.deepEqual(site.potentialAction, {
    "@type": "SearchAction",
    target: `${SITE}/search?title={search_term_string}`,
    "query-input": "required name=search_term_string",
  });
});

test("Organization carries an absolute logo", () => {
  const organization = (buildHomeJsonLd({ items: items(1) })["@graph"] as Array<
    Record<string, unknown>
  >)[1];

  assert.equal(organization.name, "KumoriTV");
  assert.equal(organization.url, `${SITE}/`);
  assert.match(String(organization.logo), /^https:\/\//);
});

test("ItemList is the summary format: only @type, position and url", () => {
  const list = (buildHomeJsonLd({ items: items(3) })["@graph"] as Array<Record<string, unknown>>)[2];
  const entries = list.itemListElement as Array<Record<string, unknown>>;

  assert.equal(entries.length, 3);
  for (const [index, entry] of entries.entries()) {
    assert.deepEqual(Object.keys(entry).sort(), ["@type", "position", "url"]);
    assert.equal(entry["@type"], "ListItem");
    assert.equal(entry.position, index + 1);
    assert.match(String(entry.url), /^https:\/\/kumoritv\.top\/media\/\d+$/);
  }
});

test("the list is capped at ten, deduplicated and all absolute", () => {
  const list = (buildHomeJsonLd({ items: [...items(15), { url: `/media/100` }, { url: "/media/1" }] })[
    "@graph"
  ] as Array<Record<string, unknown>>)[2];
  const entries = list.itemListElement as Array<Record<string, unknown>>;

  assert.equal(entries.length, HOME_ITEM_LIST_LIMIT);
  assert.equal(HOME_ITEM_LIST_LIMIT, 10);

  const urls = entries.map((entry) => entry.url as string);
  assert.equal(new Set(urls).size, urls.length, "no duplicate urls");
  assert.ok(urls.every((url) => url.startsWith("https://")), "every url is absolute");
  assert.equal(urls[0], `${SITE}/media/100`);
  assert.equal(urls.at(-1), `${SITE}/media/109`);
});

test("an empty page omits the ItemList rather than emitting an empty one", () => {
  const nodes = buildHomeJsonLd({ items: [] })["@graph"] as Array<Record<string, unknown>>;
  assert.deepEqual(
    nodes.map((node) => node["@type"]),
    ["WebSite", "Organization"],
  );
  assert.doesNotThrow(() => JSON.parse(serializeJsonLd(buildHomeJsonLd())));
});

test("the homepage source builds its list from the loaded, non-adult media", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");

  assert.match(source, /listAnimesTrending/, "uses the trending list already on the page");
  assert.match(source, /isAdult === true\) continue/, "adult titles are skipped");
  assert.match(source, /seenHomeIds/, "duplicates are skipped");
  assert.match(source, /absoluteUrl\(`\/media\//, "links are absolute media urls");
  assert.match(source, /buildHomeJsonLd\(\{/, "the shared builder is used");
});
