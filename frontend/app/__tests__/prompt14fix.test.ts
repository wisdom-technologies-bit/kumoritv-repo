// Fixes after the prompt-14 merge: the DUB pill on the media page, horizontal
// overflow on the mobile watch page, and broken Keep Watching covers.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hydrateKeepWatchingImages } from "@/app/lib/user-data/progress";
import { toKeepWatchingMediaData } from "@/app/lib/user-data/progress";
import type { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const card = (over: Partial<KeepWatchingMediaData> = {}) =>
  ({
    id: 21,
    episode: "12",
    episodeImg: "",
    coverImage: { extraLarge: "", large: "" },
    episodeTimeLastStop: 300,
    ...over,
  }) as KeepWatchingMediaData;

// ---------------------------------------------------------------- DUB pill

test("the media page no longer paints every span inside the episodes area white", () => {
  const css = read("app/media/[id]/page.module.css");
  const rule = css.slice(
    css.indexOf("line-height: 1.4"),
    css.indexOf("}", css.indexOf("line-height: 1.4")),
  );

  // every selector of that rule must be scoped to the description or the cast
  const selectors = css
    .slice(
      css.lastIndexOf("} /* Only the description", 0) >= 0
        ? css.indexOf("/* Only the description")
        : css.indexOf("#description_episodes_related_container #description_container p"),
      css.indexOf("line-height: 1.4"),
    )
    .split(",")
    .map((part) => part.replace(/\/\*[\s\S]*?\*\//g, "").trim())
    .filter(Boolean);

  assert.ok(selectors.length >= 2, selectors.join(" | "));
  for (const selector of selectors) {
    assert.ok(
      selector.includes("#description_container") ||
        selector.includes("#cast_container"),
      `unscoped selector still repaints the episode list: ${selector}`,
    );
    assert.ok(
      !/^#description_episodes_related_container\s+(p|span)$/.test(selector),
      `bare descendant rule came back: ${selector}`,
    );
  }
  assert.ok(rule.length > 0);
});

test("the DUB badge keeps a dark text colour that survives an ID-level override", () => {
  const css = read("app/components/EpisodeList/component.module.css");
  const block = css.slice(css.indexOf(".dub_badge {"), css.indexOf("}", css.indexOf(".dub_badge {")));

  assert.match(block, /color:\s*var\(--black-100\)\s*!important/);
  assert.match(block, /background:\s*var\(--white-100\)\s*!important/);
});

test("black-100 really is the dark ink (so white-on-white cannot happen)", () => {
  const css = read("app/globals.css");
  assert.match(css, /--white-100:\s*#fff/);
  assert.match(css, /--black-100:\s*(rgb\(8,\s*33,\s*48\)|#082130)/);
});

// ------------------------------------------------------ watch page overflow

test("the watch page clips horizontal overflow without breaking sticky players", () => {
  const css = read("app/watch/[id]/page.module.css");
  const block = css.slice(css.indexOf("#container {"), css.indexOf("}", css.indexOf("#container {")));

  assert.match(block, /width:\s*100%/);
  assert.match(block, /max-width:\s*100%/);
  assert.match(block, /overflow-x:\s*clip/);
  // `hidden` would turn the page into a scroll container and break stickiness
  assert.ok(!/overflow-x:\s*hidden/.test(block));
});

test("grid children on the watch page are allowed to shrink", () => {
  const css = read("app/watch/[id]/page.module.css");
  const block = css.slice(
    css.indexOf("#media_info_container>*"),
    css.indexOf("}", css.indexOf("#media_info_container>*")),
  );

  assert.match(block, /min-width:\s*0/);
});

test("long unbroken titles wrap instead of widening the page", () => {
  const css = read("app/watch/[id]/page.module.css");

  assert.match(css, /overflow-wrap:\s*break-word/);
  assert.match(css, /#container p[\s\S]{0,120}overflow-wrap/);
});

// --------------------------------------------------- Keep Watching covers

test("a card with no cover gets one from the batched image endpoint", async () => {
  const calls: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        images: { "21-12": "https://img.example/ep12.jpg" },
      }),
    } as any;
  }) as any;

  try {
    const [hydrated] = await hydrateKeepWatchingImages([card()]);

    assert.equal(calls.length, 1, "one batched request");
    assert.deepEqual(calls[0].items, [{ anilistId: 21, episode: 12 }]);
    assert.equal(hydrated.episodeImg, "https://img.example/ep12.jpg");
    assert.equal(hydrated.coverImage.extraLarge, "https://img.example/ep12.jpg");
    assert.equal(hydrated.coverImage.large, "https://img.example/ep12.jpg");
  } finally {
    globalThis.fetch = original;
  }
});

test("cards that already have art are left untouched (and not re-fetched)", async () => {
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    return { ok: true, json: async () => ({ images: {} }) } as any;
  }) as any;

  try {
    const input = [
      card({
        coverImage: { extraLarge: "https://img.example/cover.jpg", large: "https://img.example/cover.jpg" },
        episodeImg: "https://img.example/ep.jpg",
      }),
    ];
    const output = await hydrateKeepWatchingImages(input);

    assert.equal(called, false, "no request when every card has art");
    assert.deepEqual(output, input);
  } finally {
    globalThis.fetch = original;
  }
});

test("an existing cover is never replaced by the episode thumbnail", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ images: { "21-12": "https://img.example/ep12.jpg" } }),
    }) as any) as any;

  try {
    const [hydrated] = await hydrateKeepWatchingImages([
      card({
        coverImage: { extraLarge: "https://img.example/cover.jpg", large: "https://img.example/cover.jpg" },
        episodeImg: "",
      }),
    ]);

    assert.equal(hydrated.coverImage.extraLarge, "https://img.example/cover.jpg");
    assert.equal(hydrated.episodeImg, "https://img.example/ep12.jpg");
  } finally {
    globalThis.fetch = original;
  }
});

test("a failed lookup leaves the list usable instead of throwing", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as any;

  try {
    const list = [card()];
    const output = await hydrateKeepWatchingImages(list);

    assert.deepEqual(output, list);
  } finally {
    globalThis.fetch = original;
  }
});

test("an empty list makes no request at all", async () => {
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
  }) as any;

  try {
    assert.deepEqual(await hydrateKeepWatchingImages([]), []);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("the cover the card shows comes from the snapshot, with the episode image behind it", () => {
  const withCover = toKeepWatchingMediaData({
    anilist_id: 21,
    episode_number: 12,
    position_seconds: 300,
    snapshot: { title: "One Piece", cover: "https://img.example/cover.jpg", episodeImage: "https://img.example/ep.jpg" },
    updated_at: new Date().toISOString(),
  } as any);

  assert.equal(withCover.coverImage.extraLarge, "https://img.example/cover.jpg");
  assert.equal(withCover.episodeImg, "https://img.example/ep.jpg");
});

test("MediaCard never passes an empty src to <Image>", () => {
  const source = read("app/components/MediaCards/MediaCard/index.tsx");

  assert.match(source, /const FALLBACK_COVER =/);
  assert.match(source, /function coverSrc\(/);
  assert.equal(
    (source.match(/src=\{coverSrc\(url\)\}/g) || []).length,
    2,
    "both MediaImg and MediaImgLink should use the fallback",
  );
  assert.ok(!/src=\{url\}/.test(source), "a bare src={url} is back");
});
