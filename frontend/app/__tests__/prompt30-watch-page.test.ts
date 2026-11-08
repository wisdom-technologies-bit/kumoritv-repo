// Prompt 30: the watch page's structure.
//
// The redesign moved blocks around, so this file pins what must not move:
//   - the episode heading ("EP N - title") renders exactly once, and so does the
//     synopsis (the old page printed the synopsis in its own panel);
//   - the episodes panel is the page's own aside;
//   - the layout rules the design depends on (two columns, sticky sidebar,
//     page tokens, the sticky phone player, the theater escape hatch);
//   - nothing reintroduces the 65vw player cap or a full-width black band.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const NodeModule = require("node:module");

// The watch page reads a cookie and gathers episode SEO on the server; both get
// in-memory doubles so a page tree can be built without a database.
const HEADERS_STUB = join(
  import.meta.dirname,
  "..",
  "..",
  "test-harness",
  "stubs",
  "next-headers.ts",
);
const EPISODE_SEO_STUB = join(
  import.meta.dirname,
  "..",
  "..",
  "test-harness",
  "stubs",
  "episode-seo.ts",
);

const originalResolve = (NodeModule as any)._resolveFilename;
(NodeModule as any)._resolveFilename = function patched(
  request: string,
  ...rest: unknown[]
) {
  if (request === "next/headers") return HEADERS_STUB;
  if (request === "@/app/lib/seo/episode-seo") return EPISODE_SEO_STUB;
  return originalResolve.call(this, request, ...rest);
};

const WATCH_PAGE_CSS = "app/watch/[id]/page.module.css";
const TOOLBAR_CSS = "app/watch/[id]/components/PlayerToolbar/component.module.css";
const CONTROLS_CSS = "app/watch/[id]/components/WatchControls/component.module.css";
const PANEL_CSS =
  "app/watch/[id]/components/EpisodesListContainer/component.module.css";

const MEDIA_PAYLOAD = {
  Media: {
    id: 21,
    title: {
      romaji: "One Piece",
      english: "One Piece",
      native: "ワンピース",
      userPreferred: "One Piece",
    },
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
    streamingEpisodes: [],
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

/** Every string a server-rendered tree would put on the page. */
function collectText(node: any, out: string[]) {
  if (node === null || node === undefined || node === false) return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return;
  }
  if (typeof node === "object" && node.props) collectText(node.props.children, out);
}

function findAll(node: any, predicate: (element: any) => boolean, out: any[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (node.props) {
    if (node.$$typeof && predicate(node)) out.push(node);
    findAll(node.props.children, predicate, out);
  }
  return out;
}

function count(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

async function renderWatchPage() {
  const originalFetch = globalThis.fetch;
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;

  (globalThis as { __episodeSeo?: unknown }).__episodeSeo = {
    episodeTitle: "The Great Swordsman",
    synopsis: "Zoro arrives.",
    thumbnailUrl: "https://provider.example/ep2.jpg",
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
    return tree;
  } finally {
    globalThis.fetch = originalFetch;
    delete (globalThis as { __episodeSeo?: unknown }).__episodeSeo;
    if (previousSite !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previousSite;
  }
}

test("the episode title and the synopsis each appear exactly once", async () => {
  const tree = await renderWatchPage();
  const text: string[] = [];
  collectText(tree, text);
  // children are separate strings ("EP ", 2, " - ", title): join and collapse
  const page = text.join("").replace(/\s+/g, " ");

  assert.equal(
    count(page, "EP 2 - The Great Swordsman"),
    1,
    "one episode heading, with the text the tests pin",
  );
  assert.equal(
    count(page, "Zoro arrives."),
    1,
    "the synopsis is printed once, not once per panel",
  );
  assert.equal(count(page, "Aired 24/11/1999"), 1, "the aired date keeps its chip");
});

test("the episodes panel is the page's own aside", async () => {
  const tree = await renderWatchPage();
  const asides = findAll(
    tree,
    (element) => element.type === "aside" && element.props?.["aria-label"] === "Episodes",
  );

  assert.equal(asides.length, 1, "exactly one episodes aside");
});

test("the desktop grid is two columns with a sticky, height-capped sidebar", async () => {
  const css = await readFile(WATCH_PAGE_CSS, "utf8");

  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*380px/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*400px/, "400px from 1536px");
  assert.match(css, /--page-gutter/);
  assert.match(css, /--page-max/);

  assert.match(css, /position:\s*sticky/, "the sidebar sticks");
  assert.match(css, /top:\s*calc\(var\(--header-min-height,\s*64px\)/, "below the header");
  assert.match(
    css,
    /max-height:\s*calc\(100vh - var\(--header-min-height,\s*64px\) - 24px\)/,
    "the sidebar never grows past the viewport",
  );
  assert.match(css, /overflow:\s*auto/, "and scrolls inside itself");

  assert.ok(
    !/max-width:\s*65vw/.test(css),
    "the player is no longer capped at 65vw",
  );
});

test("the phone player stays sticky and nothing widens the page", async () => {
  const css = await readFile(WATCH_PAGE_CSS, "utf8");
  const background = css.slice(
    css.indexOf("#container .background"),
    css.indexOf("@media(min-width: 768px)", css.indexOf("#container .background")),
  );

  assert.match(background, /position:\s*sticky/);
  assert.match(background, /top:\s*60px/);
  assert.match(background, /background:\s*transparent/, "the black band is gone");

  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /min-width:\s*0/);
});

test("theater widens the player and drops the sidebar below it", async () => {
  const css = await readFile(WATCH_PAGE_CSS, "utf8");
  const theater = css.slice(css.indexOf('[data-theater="true"]'));

  assert.match(
    theater,
    /grid-template-areas:\s*"stage"\s*"sidebar"\s*"comments"/,
    "one column: stage, then the episodes panel, then comments",
  );
  assert.match(css, /\[data-theater="true"\] #sidebar/, "the sidebar un-sticks");
});

test("the lights-off scrim is a fixed 85% black layer with reduced motion", async () => {
  const css = await readFile(WATCH_PAGE_CSS, "utf8");
  const overlay = css.slice(css.indexOf(".lights_overlay {"));

  assert.match(overlay, /position:\s*fixed/);
  assert.match(overlay, /rgba\(0,\s*0,\s*0,\s*0\.85\)/);
  assert.match(css, /prefers-reduced-motion[\s\S]{0,200}\.lights_overlay/);
  assert.match(
    css,
    /\[data-lights-off="true"\] \.background[\s\S]{0,80}z-index:\s*60/,
    "the player stays above the scrim so its controls still work",
  );
});

test("the toolbar hides Theater on phones and scrolls instead of widening", async () => {
  const css = await readFile(TOOLBAR_CSS, "utf8");

  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(
    css,
    /\.theater_tool\s*{\s*display:\s*none/,
    "Theater is hidden by default (phones)",
  );
  assert.match(css, /prefers-reduced-motion/);
});

test("the controls keep their ids, texts and a disabled-audio title", async () => {
  const source = await readFile(
    "app/watch/[id]/components/WatchControls/index.tsx",
    "utf8",
  );
  const css = await readFile(CONTROLS_CSS, "utf8");

  assert.match(source, /data-testid="watch-controls"/);
  assert.match(source, /data-testid="backup-server"/);
  assert.match(source, /state\.backupServer/);
  assert.match(source, />SUB</);
  assert.match(source, />DUB</);
  assert.match(source, /Retry \(\{state\.errorMessage\}\)/);
  assert.match(source, /role="group"[\s\S]{0,80}aria-label="Audio"/);
  assert.match(source, /No dub available for this episode/);
  assert.match(source, /aria-pressed=/);

  assert.match(css, /\.segment_button:disabled[\s\S]{0,80}opacity:\s*0\.45/);
  assert.match(css, /border-style:\s*dashed|border:\s*1px dashed/, "idle backup pill");
});

test("the episodes panel keeps the next-airing chip on its header", async () => {
  const source = await readFile(
    "app/watch/[id]/components/EpisodesListContainer/index.tsx",
    "utf8",
  );
  const panel = await readFile(PANEL_CSS, "utf8");

  assert.match(source, /headerSlot=\{nextAiringChip\}/);
  assert.match(source, /variant="sidebar"/);
  assert.match(source, /Next episode \{nextAiringEpisodeInfo\.episode\}/);
  assert.match(panel, /#episodes_list_container \{[\s\S]{0,80}background:\s*transparent/);
});
