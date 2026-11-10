import assert from "node:assert/strict";
import test from "node:test";
import {
  YOUTUBE_IFRAME_ALLOW,
  autoplayAllowed,
  buildYoutubeEmbedSrc,
  isYoutubeTrailer,
  parseYoutubePlayerMessage,
  readPlaybackEnvironment,
  youtubeTrailerId,
} from "../youtube";

test("isYoutubeTrailer accepts a real YouTube trailer", () => {
  assert.equal(
    isYoutubeTrailer({ id: "vUjAxk1qYzQ", site: "youtube" }),
    true,
  );
  assert.equal(isYoutubeTrailer({ id: " vUjAxk1qYzQ ", site: " YouTube " }), true);
  assert.equal(isYoutubeTrailer({ id: "abcdef", site: "youtube" }), true);
});

test("isYoutubeTrailer rejects everything the player cannot play", () => {
  assert.equal(isYoutubeTrailer(null), false);
  assert.equal(isYoutubeTrailer(undefined), false);
  assert.equal(isYoutubeTrailer({ id: "x7rW4ZRqLOY", site: "dailymotion" }), false);
  assert.equal(isYoutubeTrailer({ id: null, site: "youtube" }), false);
  assert.equal(isYoutubeTrailer({ id: "vUjAxk1qYzQ", site: null }), false);
  assert.equal(isYoutubeTrailer({ id: "short", site: "youtube" }), false);
  assert.equal(isYoutubeTrailer({ id: "waytoolongvideoid", site: "youtube" }), false);
  assert.equal(isYoutubeTrailer({ id: "abc/def?x=1", site: "youtube" }), false);
});

test("youtubeTrailerId returns the trimmed id or null", () => {
  assert.equal(youtubeTrailerId({ id: " vUjAxk1qYzQ ", site: "youtube" }), "vUjAxk1qYzQ");
  assert.equal(youtubeTrailerId({ id: "vUjAxk1qYzQ", site: "dailymotion" }), null);
  assert.equal(youtubeTrailerId(null), null);
});

test("buildYoutubeEmbedSrc always carries the parameters YouTube needs", () => {
  const src = buildYoutubeEmbedSrc("vUjAxk1qYzQ", {
    origin: "https://kumoritv.top",
  });
  const url = new URL(src);

  assert.equal(url.origin + url.pathname, "https://www.youtube.com/embed/vUjAxk1qYzQ");
  for (const param of [
    "rel=0",
    "modestbranding=1",
    "playsinline=1",
    "iv_load_policy=3",
    "enablejsapi=1",
    "controls=0",
  ]) {
    assert.equal(url.searchParams.get(param.split("=")[0]), param.split("=")[1], param);
  }
  assert.equal(url.searchParams.get("origin"), "https://kumoritv.top");
});

test("buildYoutubeEmbedSrc mutes and queues only the autoplaying, looping trailer", () => {
  const plain = new URL(buildYoutubeEmbedSrc("vUjAxk1qYzQ"));
  assert.equal(plain.searchParams.get("autoplay"), null);
  assert.equal(plain.searchParams.get("mute"), null);
  assert.equal(plain.searchParams.get("loop"), null);
  assert.equal(plain.searchParams.get("playlist"), null);
  assert.equal(plain.searchParams.get("origin"), null);

  const hero = new URL(
    buildYoutubeEmbedSrc("vUjAxk1qYzQ", {
      autoplay: true,
      loop: true,
      controls: false,
      origin: "https://kumoritv.top/",
    }),
  );
  assert.equal(hero.searchParams.get("autoplay"), "1");
  assert.equal(hero.searchParams.get("mute"), "1");
  assert.equal(hero.searchParams.get("loop"), "1");
  assert.equal(hero.searchParams.get("playlist"), "vUjAxk1qYzQ");
  assert.equal(hero.searchParams.get("controls"), "0");
  // Trailing slash is trimmed so it matches `window.location.origin` exactly.
  assert.equal(hero.searchParams.get("origin"), "https://kumoritv.top");
});

test("buildYoutubeEmbedSrc refuses ids the player cannot load", () => {
  assert.equal(buildYoutubeEmbedSrc(""), "");
  assert.equal(buildYoutubeEmbedSrc("short"), "");
  assert.equal(buildYoutubeEmbedSrc("../../etc/passwd"), "");
  assert.equal(buildYoutubeEmbedSrc("abc def ghi"), "");
});

test("YOUTUBE_IFRAME_ALLOW grants autoplay and the standard extras", () => {
  for (const token of ["autoplay", "encrypted-media", "picture-in-picture", "fullscreen"]) {
    assert.ok(YOUTUBE_IFRAME_ALLOW.includes(token), token);
  }
});

test("parseYoutubePlayerMessage reads the events the player actually posts", () => {
  assert.deepEqual(parseYoutubePlayerMessage('{"event":"onReady","info":null}'), {
    kind: "ready",
    playerState: null,
  });
  assert.deepEqual(parseYoutubePlayerMessage(JSON.stringify({ event: "onError", info: 150 })), {
    kind: "error",
    code: 150,
  });
  assert.deepEqual(parseYoutubePlayerMessage({ event: "onError", info: "101" }), {
    kind: "error",
    code: 101,
  });
  assert.deepEqual(parseYoutubePlayerMessage({ event: "infoDelivery", info: {} }), {
    kind: "heartbeat",
    playerState: null,
  });
  // The player state is what separates a playing video from the
  // "Video unavailable" screen, which posts heartbeats too.
  assert.deepEqual(
    parseYoutubePlayerMessage({ event: "infoDelivery", info: { playerState: 1 } }),
    { kind: "heartbeat", playerState: 1 },
  );
  assert.deepEqual(
    parseYoutubePlayerMessage({ event: "infoDelivery", info: { playerState: -1 } }),
    { kind: "heartbeat", playerState: -1 },
  );
  assert.deepEqual(parseYoutubePlayerMessage('{"event":"initialDelivery","info":{}}'), {
    kind: "heartbeat",
    playerState: null,
  });
});

test("parseYoutubePlayerMessage ignores noise instead of throwing", () => {
  assert.equal(parseYoutubePlayerMessage("not json"), null);
  assert.equal(parseYoutubePlayerMessage(""), null);
  assert.equal(parseYoutubePlayerMessage(null), null);
  assert.equal(parseYoutubePlayerMessage(42), null);
  assert.equal(parseYoutubePlayerMessage({ event: "onStateChange", info: 1 }), null);
  assert.deepEqual(parseYoutubePlayerMessage({ event: "onError" }), {
    kind: "error",
    code: null,
  });
});

test("autoplay is skipped for reduced motion and data saver", () => {
  assert.equal(autoplayAllowed({ prefersReducedMotion: false, saveData: false }), true);
  assert.equal(autoplayAllowed({ prefersReducedMotion: true, saveData: false }), false);
  assert.equal(autoplayAllowed({ prefersReducedMotion: false, saveData: true }), false);
  // Under jsdom neither API reports a preference, so the default is "play".
  assert.deepEqual(readPlaybackEnvironment(), {
    prefersReducedMotion: false,
    saveData: false,
  });
});
