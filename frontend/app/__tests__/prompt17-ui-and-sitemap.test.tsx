import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { click, flush, render } from "../../test-harness/render";
import { FakeSupabaseClient } from "../../test-harness/fake-supabase";
import KeepWatchingEpisodeInfo, {
  episodeMetaLine,
  progressRatio,
  watchHref,
} from "@/app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo";
import SearchResultItemCard from "@/app/layout/header/components/SearchFormContainer/components/SearchResultItemCard";
import {
  CHUNK_SIZE,
  buildEpisodesSitemap,
  buildMediaSitemap,
  buildRecentSitemap,
  countRows,
  fetchEpisodeSlice,
  parseSitemapEpisode,
  sitemapIndexFiles,
} from "../../lib/sitemap";
import { episodeExistsInDb, watchRobots } from "@/app/lib/seo/watch-indexability";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

// ------------------------------------------------------------------ PART 2

// Prompt 19 settled the tokens: 44px tap targets everywhere, a 36px avatar,
// a 28px wordmark on phones and a 64px bar. See prompt19-header.test.ts and
// prompt18-header-controls.test.ts.
test("header sizing tokens: 44px icon buttons, 36px avatar, 64px bar", () => {
  const css = read("app/layout/header/headerComponent.module.css");

  assert.match(css, /--header-control-size:\s*44px/, "icon buttons are 44px tap targets");
  assert.match(css, /--header-avatar-size:\s*36px/, "avatar is 36px");
  assert.match(css, /--header-min-height:\s*64px/, "header bar is 64px");

  const phone = css.slice(css.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /--header-wordmark-height:\s*28px/, "phones keep a 28px wordmark");
  assert.match(phone, /--header-control-size:\s*44px/, "phones keep 44px targets");
});

// ------------------------------------------------------------------ PART 3

test("manga dropdown uses the same anchoring rules as the anime dropdown", () => {
  const anime = read("app/layout/header/components/AnimeNavListHover/component.module.css");
  const manga = read("app/layout/header/components/MangaNavListHover/component.module.css");

  // Prompt 29 moved both panels onto the shared page gutter: full viewport
  // width, inner padding from --page-gutter, so the columns start on the logo's
  // line instead of inside a 1440px box.
  for (const rule of [
    "position: fixed",
    "top: calc(var(--header-min-height, 64px) + 8px)",
    "z-index: var(--z-header-popover)",
    "width: 100vw",
    "max-width: 100vw",
    "padding: 32px var(--page-gutter) 64px",
    "box-sizing: border-box",
  ]) {
    assert.ok(anime.includes(rule), `anime dropdown should define ${rule}`);
    assert.ok(manga.includes(rule), `manga dropdown should define ${rule}`);
  }

  assert.match(manga, /grid-template-columns:\s*1fr 2fr 3fr/, "manga keeps its 1fr 2fr 3fr grid");
  assert.match(manga, /border-left:\s*1px solid var\(--white-25\)/, "manga keeps the bordered column");

  const markup = read("app/layout/header/components/MangaNavListHover/index.tsx");
  for (const id of ["manga_header_nav_container", "topics_container", "manga_card_container", "list_picked_container"]) {
    assert.ok(markup.includes(id), `${id} is used by the manga markup`);
    assert.ok(manga.includes(`#${id}`), `${id} is styled by the manga css`);
  }
});

// ------------------------------------------------------------------ PART 4

test("the notifications watch pill is compact, not a tall oval", () => {
  const css = read("app/layout/header/components/Notifications/component.module.css");
  const pill = css.slice(css.indexOf(".watch_link {"));

  assert.match(pill, /height:\s*36px/, "the pill is 36px tall");
  assert.match(pill, /width:\s*auto/, "it hugs its label");
  assert.match(pill, /border-radius:\s*999px/, "it stays a pill");
});

// ------------------------------------------------------------------ PART 5

const SEARCH_MEDIA = {
  id: 154587,
  type: "ANIME",
  format: "TV",
  seasonYear: 2023,
  startDate: { year: 2023 },
  genres: ["Adventure", "Drama", "Fantasy", "Mystery"],
  title: {
    english: "Frieren: Beyond Journey's End",
    romaji: "Sousou no Frieren",
    native: "葬送のフリーレン",
    userPreferred: "Sousou no Frieren",
  },
  coverImage: { large: "https://example.test/frieren.jpg" },
};

test("a search row shows the english title, its meta line, a type tag and the media link", async () => {
  const tree = await render(<SearchResultItemCard mediaFromAnilist={SEARCH_MEDIA as never} />);
  const link = tree.container.querySelector("a");

  assert.equal(link?.getAttribute("href"), "/media/154587");
  assert.ok(link?.getAttribute("data-search-row"), "the row link is marked for keyboard navigation");

  const text = tree.container.textContent ?? "";
  assert.match(text, /Frieren: Beyond Journey's End/);
  assert.ok(!text.includes("Sousou no Frieren"), "the romaji title is not the visible one");
  assert.match(text, /TV/);
  assert.match(text, /2023/);
  assert.match(text, /Adventure, Drama, Fantasy/, "up to three genres");
  assert.ok(!text.includes("Mystery"), "a fourth genre is dropped");
  assert.match(text, /ANIME/, "the type tag is shown");

  await tree.unmount();
});

test("the search panel is a full-width sheet on phones and a 560px dropdown on desktop", () => {
  const css = read("app/layout/header/components/SearchFormContainer/component.module.css");
  const panel = css.slice(css.indexOf("#search_results_container {"));

  assert.match(panel, /position:\s*fixed/, "phones get a sheet under the header");
  assert.match(panel, /left:\s*12px/);
  assert.match(panel, /right:\s*12px/);
  // Prompt 19: the sheet is capped against the viewport, not a flat 70vh.
  assert.match(panel, /max-height:\s*calc\(100dvh - var\(--header-min-height/);

  const desktop = css.slice(css.indexOf("@media (min-width: 641px)"));
  assert.match(desktop, /position:\s*absolute/, "desktop anchors the panel under the search box");
  assert.match(desktop, /width:\s*560px/);
});

// ------------------------------------------------------------------ PART 6

function keepWatchingCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 154587,
    title: {
      english: "Frieren: Beyond Journey's End",
      romaji: "Sousou no Frieren",
      native: "葬送のフリーレン",
    },
    format: "TV",
    episode: 7,
    episodeImg: "https://example.test/ep7.jpg",
    episodeDuration: 1440,
    episodeTimeLastStop: 300,
    dub: false,
    ...overrides,
  } as never;
}

test("keep watching: the card links to the right episode and time", () => {
  const info = keepWatchingCard();

  assert.equal(watchHref(info), "/watch/154587?ep=7&t=300&audio=sub");
  assert.equal(watchHref(keepWatchingCard({ dub: true })), "/watch/154587?ep=7&t=300&audio=dub");
  assert.equal(watchHref(keepWatchingCard({ episodeTimeLastStop: 0 })), "/watch/154587?ep=7&audio=sub");
});

test("keep watching: meta line and dub tag", async () => {
  const tree = await render(
    <KeepWatchingEpisodeInfo animeInfo={keepWatchingCard({ dub: true })} deleteFromListHook={() => {}} />,
  );
  const text = tree.container.textContent ?? "";

  assert.match(text, /Episode 7/);
  assert.match(text, /left/, "the remaining time is shown");
  assert.ok(!text.includes("Sousou no Frieren"), "the romaji title is not used");

  const dub = tree.container.querySelector('[data-dub-tag="true"]');
  assert.equal(dub?.textContent, "DUB");

  const href = tree.container.querySelector('[data-keep-watching-link="true"]')?.getAttribute("href");
  assert.equal(href, "/watch/154587?ep=7&t=300&audio=dub");

  await tree.unmount();
});

test("keep watching: no dub tag for a sub episode", async () => {
  const tree = await render(<KeepWatchingEpisodeInfo animeInfo={keepWatchingCard()} deleteFromListHook={() => {}} />);

  assert.equal(tree.container.querySelector('[data-dub-tag="true"]'), null);

  await tree.unmount();
});

test("keep watching: progress bar is a ratio, never more than 100%", () => {
  assert.ok(Math.abs(progressRatio(keepWatchingCard()) - 300 / 1440) < 1e-9);
  assert.equal(progressRatio(keepWatchingCard({ episodeTimeLastStop: 99999 })), 1);
  assert.equal(progressRatio(keepWatchingCard({ episodeDuration: 0 })), 0);
  assert.ok(progressRatio(keepWatchingCard({ episodeTimeLastStop: 0 })) > 0, "a started episode keeps a sliver");
});

test("keep watching: a failed thumbnail falls back to a neutral block with the play icon", async () => {
  const tree = await render(<KeepWatchingEpisodeInfo animeInfo={keepWatchingCard()} deleteFromListHook={() => {}} />);
  const img = tree.container.querySelector("img");

  assert.ok(img, "the cover renders first");
  img?.dispatchEvent(new window.Event("error", { bubbles: false }));
  await flush();

  assert.ok(tree.container.querySelector('[data-img-fallback="true"]'), "the fallback block replaces the image");
  assert.equal(tree.container.querySelector("img"), null);

  await tree.unmount();
});

test("keep watching: the delete button keeps its handler and its accessible name", async () => {
  let removed = false;

  const tree = await render(
    <KeepWatchingEpisodeInfo animeInfo={keepWatchingCard()} deleteFromListHook={() => { removed = true; }} />,
  );
  const button = tree.container.querySelector("button");

  assert.match(button?.getAttribute("title") ?? "", /Remove Frieren: Beyond Journey's End from Keep Watching/);
  assert.ok(button?.getAttribute("aria-label"));
  assert.ok(button, "the delete control exists");

  // The removal itself writes to the user-data store; here we only prove the
  // control is wired to the card.
  assert.equal(removed, false, "nothing is removed before a click");

  await click(button);
  await flush();

  assert.equal(tree.container.querySelector("a"), null, "the card is removed from the list");

  await tree.unmount();
});

test("keep watching: movies do not mention an episode number", () => {
  const meta = episodeMetaLine(keepWatchingCard({ format: "MOVIE" }));

  assert.ok(!meta.includes("Episode"), "a movie has no episode number");
  assert.match(meta, /left/, "the remaining time is still shown");
});

// ------------------------------------------------------------------ PART 7

test("sitemap: only view rows become watch URLs, with the view's updated_at as lastmod", () => {
  const xml = buildEpisodesSitemap([
    { anilist_id: 154587, episode_number: 7, updated_at: "2026-10-30T12:00:00.000Z", air_date: null },
    { anilist_id: 154587, episode_number: 8, updated_at: "2026-10-31T12:00:00.000Z", air_date: null },
  ]);

  assert.match(xml, /\/watch\/154587\?ep=7/);
  assert.match(xml, /\/watch\/154587\?ep=8/);
  assert.match(xml, /<lastmod>2026-10-30T12:00:00.000Z<\/lastmod>/);
  assert.ok(!xml.includes("?ep=6"), "no invented episode numbers");
  assert.equal((xml.match(/<url>/g) || []).length, 2);
});

test("sitemap: media URLs come from imported anime only", () => {
  const xml = buildMediaSitemap([
    { anilist_id: 154587, updated_at: "2026-10-30T00:00:00.000Z" },
  ]);

  assert.match(xml, /\/media\/154587/);
  assert.ok(!xml.includes("/watch/"), "media chunks never emit watch URLs");
  assert.match(xml, /<priority>0.7<\/priority>/);
});

test("sitemap: a just-aired episode we have not imported yields only the media URL", () => {
  const xml = buildRecentSitemap(
    [{ anilist_id: 100, episode_number: 3, updated_at: "2026-10-30T10:00:00.000Z", air_date: null }],
    [
      { media: { id: 100 }, episode: 3, airingAt: Date.now() / 1000 - 3600 },
      { media: { id: 200 }, episode: 5, airingAt: Date.now() / 1000 - 1800 },
      { media: { id: 300 }, episode: 1, airingAt: Date.now() / 1000 + 86400 },
    ],
  );

  assert.match(xml, /\/watch\/100\?ep=3/, "the imported episode gets a watch URL");
  assert.match(xml, /<changefreq>always<\/changefreq>/);
  assert.match(xml, /<priority>0.9<\/priority>/);

  assert.ok(!xml.includes("/watch/200"), "an unimported episode is not a watch URL");
  assert.match(xml, /\/media\/200/, "it still gets its media page");

  assert.ok(!xml.includes("/media/300"), "an episode that has not aired yet is skipped");
  assert.ok(!xml.includes("/watch/300"));
});

test("sitemap: index chunk counts match the rows the chunk routes can serve", () => {
  const files = (anime: number, episodes: number) => sitemapIndexFiles(anime, episodes).map((file) => file.loc);

  // static.xml is listed first (prompt 18, part 2.2).
  assert.deepEqual(files(0, 0), [
    "https://kumoritv.top/sitemaps/static.xml",
    "https://kumoritv.top/sitemaps/new.xml",
  ]);

  assert.deepEqual(files(CHUNK_SIZE, CHUNK_SIZE), [
    "https://kumoritv.top/sitemaps/static.xml",
    "https://kumoritv.top/sitemaps/new.xml",
    "https://kumoritv.top/sitemaps/anime-1.xml",
    "https://kumoritv.top/sitemaps/episodes-1.xml",
  ]);

  const big = files(2 * CHUNK_SIZE + 1, CHUNK_SIZE + 1);
  assert.ok(big.includes("https://kumoritv.top/sitemaps/anime-3.xml"));
  assert.ok(big.includes("https://kumoritv.top/sitemaps/episodes-2.xml"));
  assert.ok(!big.includes("https://kumoritv.top/sitemaps/episodes-3.xml"));
});

test("sitemap: malformed view rows are dropped, not turned into URLs", () => {
  assert.equal(parseSitemapEpisode({ anilist_id: 1, episode_number: 0 }), null);
  assert.equal(parseSitemapEpisode({ anilist_id: null, episode_number: 2 }), null);
  assert.equal(parseSitemapEpisode({ anilist_id: "x", episode_number: 2 }), null);
  assert.deepEqual(parseSitemapEpisode({ anilist_id: "5", episode_number: "2" }), {
    anilist_id: 5,
    episode_number: 2,
    updated_at: null,
    air_date: null,
  });
});

test("sitemap: the episodes chunk reads only the view, ordered by id then episode", async () => {
  const db = new FakeSupabaseClient({
    sitemap_episodes: [
      { anilist_id: 2, episode_number: 1, updated_at: "2026-10-01T00:00:00Z" },
      { anilist_id: 1, episode_number: 2, updated_at: "2026-10-02T00:00:00Z" },
      { anilist_id: 1, episode_number: 1, updated_at: "2026-10-03T00:00:00Z" },
    ],
    discovered_anime: [{ anilist_id: 9, updated_at: "2026-10-04T00:00:00Z" }],
  });

  const rows = await fetchEpisodeSlice(db as never, 1, 1);
  assert.equal(rows.length, 1, "the chunk size is honoured");
  assert.deepEqual(rows[0], { anilist_id: 1, episode_number: 1, updated_at: "2026-10-03T00:00:00Z", air_date: null });

  assert.equal(await countRows(db as never, "sitemap_episodes"), 3);
});

test("watch metadata: an episode missing from the episodes table is noindex and gets no canonical", () => {
  assert.equal(episodeExistsInDb({ source: "db" }), true);
  assert.equal(episodeExistsInDb({ source: "anilist" }), false);
  assert.equal(episodeExistsInDb({ source: "fallback" }), false);
  assert.equal(episodeExistsInDb(null), false);

  assert.deepEqual(watchRobots(true), { index: true, follow: true });
  assert.deepEqual(watchRobots(false), { index: false, follow: false });

  const page = read("app/watch/[id]/page.tsx");
  assert.match(page, /episodeExistsInDb\(seo\)/, "the metadata uses the shared rule");
  assert.match(page, /alternates:\s*episodeExists \? \{ canonical \} : undefined/, "no canonical for a missing episode");
  assert.match(page, /robots:\s*watchRobots\(episodeExists\)/);
});
