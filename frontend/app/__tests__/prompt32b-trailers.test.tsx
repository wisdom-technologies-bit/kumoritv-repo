import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { render, flush } from "../../test-harness/render";
import YoutubeTrailerFrame from "@/app/components/Trailer/YoutubeTrailerFrame";
import {
  resetFailedTrailers,
  useYoutubeTrailerGuard,
} from "@/app/components/Trailer/useYoutubeTrailerGuard";
import {
  isPlayablePlayerState,
  parseYoutubePlayerMessage,
} from "@/app/lib/youtube";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

const HERO = read("app/components/HomePage/HeroCarouselHomePage/index.tsx");
const HERO_CSS = read(
  "app/components/HomePage/HeroCarouselHomePage/carouselComponent.module.css",
);
const HOME = read("app/page.tsx");
const MEDIA = read("app/media/[id]/page.tsx");
const CAROUSEL = read("app/components/HomePage/NavigationThroughMedias/index.tsx");
const QUERIES = read("app/lib/anilist/queries.ts");
const NEXT_CONFIG = read("next.config.mjs");

const YOUTUBE = { id: "vUjAxk1qYzQ", site: "youtube" };

// jsdom only accepts its own Event instances, so take the constructor from the
// jsdom window rather than Node's global one.
const JsdomMessageEvent = (
  window as unknown as { MessageEvent: typeof MessageEvent }
).MessageEvent;

function dispatchPlayerMessage(data: string, origin = "https://www.youtube.com") {
  window.dispatchEvent(new JsdomMessageEvent("message", { data, origin }));
}

function failMessage(info: number | string = 150) {
  dispatchPlayerMessage(JSON.stringify({ event: "onError", info }));
}

test("the guarded frame renders one embed with the safe attributes", async () => {
  resetFailedTrailers();
  const tree = await render(
    React.createElement(YoutubeTrailerFrame, {
      trailer: YOUTUBE,
      title: "Black Clover Trailer",
      className: "yt_embed_video",
      origin: "https://kumoritv.top",
    }),
  );

  const iframe = tree.container.querySelector("iframe");
  assert.ok(iframe, "an iframe is rendered for a youtube trailer");
  assert.equal(iframe!.getAttribute("title"), "Black Clover Trailer");
  assert.equal(iframe!.getAttribute("referrerpolicy"), "strict-origin-when-cross-origin");
  assert.match(iframe!.getAttribute("allow") || "", /autoplay/);
  assert.match(iframe!.getAttribute("allow") || "", /encrypted-media/);
  assert.match(iframe!.getAttribute("allow") || "", /picture-in-picture/);
  assert.match(iframe!.getAttribute("allow") || "", /fullscreen/);
  assert.equal(iframe!.getAttribute("class"), "yt_embed_video");
  assert.ok(iframe!.hasAttribute("allowfullscreen"));

  const src = new URL(iframe!.getAttribute("src") || "");
  assert.equal(src.pathname, "/embed/vUjAxk1qYzQ");
  assert.equal(src.searchParams.get("origin"), "https://kumoritv.top");
  assert.equal(src.searchParams.get("enablejsapi"), "1");
  assert.equal(src.searchParams.get("playsinline"), "1");

  await tree.unmount();
});

test("a non-YouTube trailer renders no iframe at all", async () => {
  resetFailedTrailers();

  for (const trailer of [
    { id: "x7rW4ZRqLOY", site: "dailymotion" },
    { id: null, site: "youtube" },
    null,
    undefined,
  ]) {
    const tree = await render(
      React.createElement(YoutubeTrailerFrame, {
        trailer: trailer as never,
        title: "Trailer",
        origin: "https://kumoritv.top",
      }),
    );
    assert.equal(tree.container.querySelector("iframe"), null, String(trailer));
    await tree.unmount();
  }
});

test("a player error removes the embed and keeps the page clean", async () => {
  resetFailedTrailers();
  const tree = await render(
    React.createElement(YoutubeTrailerFrame, {
      trailer: YOUTUBE,
      title: "Trailer",
      origin: "https://kumoritv.top",
    }),
  );
  assert.ok(tree.container.querySelector("iframe"));

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    failMessage(153);
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(tree.container.querySelector("iframe"), null, "the failed embed is gone");
  assert.equal(warnings.length, 1, "exactly one short console warning");
  assert.match(warnings[0], /\[trailer\]/);

  await tree.unmount();

  // The failure is remembered for the session: a remount does not retry it.
  const again = await render(
    React.createElement(YoutubeTrailerFrame, {
      trailer: YOUTUBE,
      title: "Trailer",
      origin: "https://kumoritv.top",
    }),
  );
  assert.equal(again.container.querySelector("iframe"), null);
  await again.unmount();
  resetFailedTrailers();
});

test("messages from anywhere but YouTube are ignored", async () => {
  resetFailedTrailers();
  const tree = await render(
    React.createElement(YoutubeTrailerFrame, {
      trailer: YOUTUBE,
      title: "Trailer",
      origin: "https://kumoritv.top",
    }),
  );

  dispatchPlayerMessage(
    JSON.stringify({ event: "onError", info: 150 }),
    "https://example.com",
  );
  await flush();

  assert.ok(tree.container.querySelector("iframe"), "still shown");
  await tree.unmount();
  resetFailedTrailers();
});

test("the hero embeds only a real YouTube trailer, keyed per video", () => {
  assert.match(HERO, /isYoutubeTrailer\(currentTrailer\)/);
  assert.match(HERO, /youtubeTrailerId\(/);
  assert.match(HERO, /useYoutubeTrailerGuard\(currentTrailerId\)/);
  assert.match(HERO, /buildYoutubeEmbedSrc\(currentTrailerId/);
  assert.match(HERO, /allow=\{YOUTUBE_IFRAME_ALLOW\}/);
  assert.match(HERO, /referrerPolicy=\{YOUTUBE_REFERRER_POLICY\}/);
  assert.match(HERO, /key=\{currentTrailerId\}/);
  // The 3 s fade-in over the artwork is untouched.
  assert.match(HERO, /transition=\{\{ delay: 3 \}\}/);
  // Nothing is rendered before the stored preference has been read.
  assert.match(HERO, /trailerPreferenceKnown/);
});

test("the hero iframe stays decorative: no pointer events, behind the text", () => {
  const iframeRule = HERO_CSS.slice(HERO_CSS.indexOf("li.carousel_item iframe {"));
  const body = iframeRule.slice(0, iframeRule.indexOf("}"));
  assert.match(body, /pointer-events:\s*none/);
  assert.match(body, /position:\s*absolute/);
  // The text wrapper paints above the absolutely positioned frame.
  assert.match(HERO_CSS, /\.carousel_position_wrapper\s*\{[^}]*position:\s*relative/);
});

test("every other trailer surface goes through the guarded frame", () => {
  for (const [name, source] of [
    ["home banner", HOME],
    ["/media/[id]", MEDIA],
    ["home carousel", CAROUSEL],
  ] as const) {
    assert.match(source, /YoutubeTrailerFrame/, name);
    assert.doesNotMatch(
      source,
      /src=\{`https:\/\/www\.youtube\.com\/embed/,
      `${name} no longer hand-builds an embed URL`,
    );
  }
});

test("the home media lists actually request the trailer field", () => {
  const listFields = QUERIES.slice(
    QUERIES.indexOf("const mediaListFields"),
    QUERIES.indexOf("export function requestMedias"),
  );
  assert.match(listFields, /trailer \{ id site thumbnail \}/);
});

test("the site tells YouTube which origin it is embedded in", () => {
  assert.match(NEXT_CONFIG, /Referrer-Policy/);
  assert.match(NEXT_CONFIG, /strict-origin-when-cross-origin/);
  // Adding the policy must not bring a framing header with it.
  const config = NEXT_CONFIG.toLowerCase();
  assert.equal(config.includes("frame-ancestors"), false);
  assert.equal(config.includes("x-frame-options"), false);
});

// A live player is not proof of a working video: the "Video unavailable"
// screen sends onReady plus heartbeats with playerState -1 forever.
function GuardProbe({
  id,
  timeoutMs,
  requirePlayback,
}: {
  id: string;
  timeoutMs: number;
  requirePlayback?: boolean;
}) {
  const { failed, frameRef, onFrameLoad } = useYoutubeTrailerGuard(id, {
    timeoutMs,
    requirePlayback,
  });
  if (failed) return React.createElement("p", null, "artwork only");
  return React.createElement("iframe", { ref: frameRef, onLoad: onFrameLoad, src: "about:blank" });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("player states: only playing, paused and buffering count as playable", () => {
  assert.equal(isPlayablePlayerState(1), true);
  assert.equal(isPlayablePlayerState(2), true);
  assert.equal(isPlayablePlayerState(3), true);
  assert.equal(isPlayablePlayerState(-1), false);
  assert.equal(isPlayablePlayerState(0), false);
  assert.equal(isPlayablePlayerState(5), false);
  assert.equal(isPlayablePlayerState(null), false);

  const heartbeat = parseYoutubePlayerMessage(
    JSON.stringify({ event: "infoDelivery", info: { playerState: -1 } }),
  );
  assert.deepEqual(heartbeat, { kind: "heartbeat", playerState: -1 });

  const ready = parseYoutubePlayerMessage(JSON.stringify({ event: "onReady" }));
  assert.deepEqual(ready, { kind: "ready", playerState: null });
});

test("a player that answers but never plays is dropped, not left on screen", async () => {
  resetFailedTrailers();
  const tree = await render(React.createElement(GuardProbe, { id: "unavailable01", timeoutMs: 120 }));
  assert.ok(tree.container.querySelector("iframe"), "shown while it still may play");

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    // Exactly what YouTube sends for an embedding-disabled video.
    dispatchPlayerMessage(JSON.stringify({ event: "onReady", info: 0 }));
    dispatchPlayerMessage(
      JSON.stringify({ event: "infoDelivery", info: { playerState: -1 } }),
    );
    await flush();
    assert.ok(tree.container.querySelector("iframe"), "a heartbeat alone is not a pass");

    await wait(200);
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(tree.container.querySelector("iframe"), null, "the dead player is gone");
  assert.equal(tree.container.firstChild?.textContent, "artwork only");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /never started playing/);
  await tree.unmount();
  resetFailedTrailers();
});

test("a player that really starts playing keeps its frame", async () => {
  resetFailedTrailers();
  const tree = await render(React.createElement(GuardProbe, { id: "playing00001", timeoutMs: 120 }));
  dispatchPlayerMessage(
    JSON.stringify({ event: "infoDelivery", info: { playerState: 1 } }),
  );
  await flush();

  await wait(200);
  await flush();

  assert.ok(tree.container.querySelector("iframe"), "still playing, still shown");
  await tree.unmount();
  resetFailedTrailers();
});

test("a poster embed keeps its frame: only a refusal removes it", async () => {
  resetFailedTrailers();
  // The banner and /media/[id] show a click-to-play player, which sits on its
  // poster frame until the visitor presses play. That is not a failure.
  const tree = await render(
    React.createElement(GuardProbe, { id: "posteronly01", timeoutMs: 100, requirePlayback: false }),
  );
  await wait(200);
  await flush();
  assert.ok(tree.container.querySelector("iframe"), "a silent poster is still a valid embed");

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    failMessage(150);
    await flush();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(tree.container.querySelector("iframe"), null, "a refused embed is still removed");
  assert.equal(warnings.length, 1);
  await tree.unmount();
  resetFailedTrailers();
});
