// Prompt 42: why the in-stream ad did not load on the live watch page.
//
// Three faults, one file:
//   1. the IMA manager was built with `new ima.AdsManager(...)`, which is not a
//      constructor in Google's SDK - a filled ad always failed with
//      `ima_manager_error`;
//   2. the overlay's 8s hard stop also ran while the creative was playing, so a
//      15-30s ad was cut off mid-roll;
//   3. the tag was requested bare, so the ad server saw a reduced User-Agent and
//      no page address.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  adRequestContextFrom,
  buildAdTagUrl,
  resetAdRequestContextForTests,
  type AdRequestContext,
} from "../lib/ads/ad-request";
import { resetPrerollCounters } from "../lib/ads/preroll";
import { BASE_AD_STATE, prerollSkipUi, type PrerollAdHandle, type PrerollAdState, type PrerollOutcome } from "../lib/ads/preroll-engine";
import { startImaPreroll } from "../lib/ads/preroll-ima";
import PrerollAd from "../watch/[id]/components/VideoPlayer/PrerollAd";

const ROOT = join(import.meta.dirname, "..", "..");
const settle = () => act(async () => {});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";

// ------------------------------------------------------------- the context

test("the ad request carries the real platform and browser, not just a zone id", () => {
  const context = adRequestContextFrom(
    "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "https://kumoritv.top/watch/21?ep=7",
  );

  assert.equal(context.os, "android");
  assert.equal(context.osVersion, "13");
  assert.equal(context.browser, "chrome");
  assert.equal(context.browserVersion, "120.0.0.0");
  assert.equal(context.pageUrl, "https://kumoritv.top/watch/21?ep=7");
});

test("client hints win over the frozen User-Agent, so an Android 13 phone is not read as 10", () => {
  // Chrome's reduced UA: the version is literally "10; K" whatever the phone is.
  const frozen = adRequestContextFrom(ANDROID_CHROME, "https://kumoritv.top/");

  assert.equal(frozen.osVersion, "10", "the frozen UA is all a bare request has");

  const hinted = adRequestContextFrom(ANDROID_CHROME, "https://kumoritv.top/", {
    platform: "Android",
    platformVersion: "13.0.0",
    uaFullVersion: "120.0.6099.144",
    fullVersionList: [
      { brand: "Not_A Brand", version: "8.0.0.0" },
      { brand: "Chromium", version: "120.0.6099.144" },
      { brand: "Google Chrome", version: "120.0.6099.144" },
    ],
  });

  assert.equal(hinted.os, "android");
  assert.equal(hinted.osVersion, "13.0.0");
  assert.equal(hinted.browser, "chrome");
  assert.equal(hinted.browserVersion, "120.0.6099.144");
});

test("iOS and desktop are read the same way", () => {
  const ios = adRequestContextFrom(IPHONE_SAFARI, "https://kumoritv.top/");

  assert.equal(ios.os, "ios");
  assert.equal(ios.osVersion, "17.2");
  assert.equal(ios.browser, "safari");
  assert.equal(ios.browserVersion, "17.2");

  const windows = adRequestContextFrom(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0",
    "https://kumoritv.top/",
  );

  assert.equal(windows.os, "windows");
  assert.equal(windows.osVersion, "10.0");
  assert.equal(windows.browser, "edge", "a Chromium fork is not called chrome");
});

test("the tag URL gains the details once, keeps its own parameters, and stays https", () => {
  const context: AdRequestContext = {
    pageUrl: "https://kumoritv.top/watch/21",
    os: "android",
    osVersion: "13",
    browser: "chrome",
    browserVersion: "120.0",
  };
  const url = new URL(
    buildAdTagUrl("https://youradexchange.com/video/select.php?r=12451816", context, 4242),
  );

  assert.equal(url.origin + url.pathname, "https://youradexchange.com/video/select.php");
  assert.equal(url.searchParams.get("r"), "12451816", "the zone id is untouched");
  assert.equal(url.searchParams.get("cb"), "4242");
  assert.equal(url.searchParams.get("url"), "https://kumoritv.top/watch/21");
  assert.equal(url.searchParams.get("os"), "android");
  assert.equal(url.searchParams.get("osv"), "13");
  assert.equal(url.searchParams.get("br"), "chrome");
  assert.equal(url.searchParams.get("brv"), "120.0");

  // A tag that already carries a value keeps it, and nothing is sent twice.
  const kept = new URL(
    buildAdTagUrl("https://tag.example/vast?r=1&os=ios&br=safari", { ...context, os: "android" }, 7),
  );

  assert.equal(kept.searchParams.get("os"), "ios");
  assert.equal(kept.searchParams.get("br"), "safari");
  assert.deepEqual(kept.searchParams.getAll("os"), ["ios"]);

  // An empty field is never sent as an empty parameter.
  const sparse = new URL(
    buildAdTagUrl("https://tag.example/vast?r=1", { ...context, osVersion: "", browserVersion: "" }, 7),
  );

  assert.equal(sparse.searchParams.has("osv"), false);
  assert.equal(sparse.searchParams.has("brv"), false);

  // Not a URL, or not https: returned exactly as configured.
  assert.equal(buildAdTagUrl("not a url", context), "not a url");
  assert.equal(buildAdTagUrl("http://tag.example/vast?r=1", context), "http://tag.example/vast?r=1");
});

// ------------------------------------------------------------- the IMA engine

type FakeAd = {
  getSkipTimeOffset: () => number;
  getClickThroughUrl: () => string;
  getDuration: () => number;
};

/** Just enough of `google.ima` to drive the engine without Google's library. */
function installFakeIma(options: { skipOffset: number; duration?: number }) {
  const calls: string[] = [];
  const loaderListeners = new Map<string, (event: any) => void>();
  const managerListeners = new Map<string, (event: any) => void>();
  const requests: any[] = [];
  const ad: FakeAd = {
    getSkipTimeOffset: () => options.skipOffset,
    getClickThroughUrl: () => "https://advertiser.example/landing",
    getDuration: () => options.duration ?? 20,
  };
  const manager: any = {
    init: (...args: any[]) => calls.push(`init:${args[0]}x${args[1]}`),
    start: () => calls.push("start"),
    stop: () => calls.push("stop"),
    skip: () => calls.push("skip"),
    destroy: () => calls.push("destroy"),
    setVolume: (value: number) => calls.push(`volume:${value}`),
    getRemainingTime: () => 18,
    getAdSkippableState: () => false,
    getCurrentAd: () => ad,
    addEventListener: (type: string, handler: (event: any) => void) => managerListeners.set(type, handler),
  };
  const ima = {
    AdDisplayContainer: class {
      initialize() {
        calls.push("initialize");
      }

      destroy() {
        calls.push("container_destroy");
      }
    },
    AdsLoader: class {
      addEventListener(type: string, handler: (event: any) => void) {
        loaderListeners.set(type, handler);
      }

      requestAds(request: any) {
        requests.push(request);
        calls.push("request_ads");
      }

      destroy() {
        calls.push("loader_destroy");
      }
    },
    AdsRequest: class {
      adTagUrl = "";
    },
    AdsRenderingSettings: class {
      uiElements: any[] = [];
    },
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "ads_manager_loaded" } },
    AdErrorEvent: { Type: { AD_ERROR: "ad_error" } },
    AdEvent: {
      Type: {
        LOADED: "loaded",
        STARTED: "started",
        AD_PROGRESS: "ad_progress",
        SKIPPABLE_STATE_CHANGED: "skippable_state_changed",
        SKIPPED: "skipped",
        COMPLETE: "complete",
        ALL_ADS_COMPLETED: "all_ads_completed",
        CONTENT_PAUSE_REQUESTED: "content_pause_requested",
        CONTENT_RESUME_REQUESTED: "content_resume_requested",
      },
    },
    UiElements: { AD_ATTRIBUTION: "attribution", COUNTDOWN: "countdown", SKIP: "skip", CLICK_THROUGH: "click" },
    ViewMode: { NORMAL: "normal" },
    settings: { setDisableCustomPlaybackForIOS10Plus: () => undefined },
  };

  (globalThis as any).google = { ima };

  return {
    calls,
    requests,
    /** The SDK's own hand-off: this is how a manager is obtained. */
    loaded: () =>
      loaderListeners.get("ads_manager_loaded")?.({
        getAdsManager: (video: HTMLVideoElement, settings: any) => {
          calls.push(`get_ads_manager:${Boolean(video)}:${Array.isArray(settings?.uiElements)}`);

          return manager;
        },
        getAdsRequest: () => requests[0],
      }),
    fire: (type: string) => managerListeners.get(type)?.({}),
    loaderError: (message: string) => loaderListeners.get("ad_error")?.({ getError: () => ({ getMessage: () => message }) }),
  };
}

function imaOptions(container: HTMLElement, overrides: Partial<any> = {}) {
  const outcomes: PrerollOutcome[] = [];
  const states: PrerollAdState[] = [];

  return {
    outcomes,
    states,
    options: {
      container,
      adTagUrl: "https://youradexchange.com/video/select.php?r=12451816",
      skipAfterSec: 5,
      maxAdSec: 30,
      startTimeoutMs: 5000,
      vastTimeoutMs: 3000,
      onState: (state: PrerollAdState) => states.push(state),
      onDone: (outcome: PrerollOutcome) => outcomes.push(outcome),
      ...overrides,
    } as any,
  };
}

test("a filled ad plays: the manager comes from the SDK, never from a constructor", async () => {
  resetPrerollCounters();
  resetAdRequestContextForTests();
  const fake = installFakeIma({ skipOffset: 5 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { options, outcomes, states } = imaOptions(container);

  try {
    const handle = await startImaPreroll(options);

    assert.equal(fake.requests.length, 1, "the tag is requested once");
    // Prompt 42: the device details travel with the request.
    const tagUrl = new URL(String(fake.requests[0].adTagUrl));

    assert.equal(tagUrl.searchParams.get("r"), "12451816");
    assert.equal(tagUrl.searchParams.get("os"), "linux", "jsdom reports linux; the point is that a value is sent");
    assert.ok(tagUrl.searchParams.get("cb"), "each play asks for a fresh response");
    assert.ok(fake.calls.includes("initialize"), "IMA is initialised inside the Play gesture");
    assert.ok(fake.calls.includes("request_ads"));

    // The SDK hands the manager over. A `new ima.AdsManager(...)` would throw here.
    fake.loaded();
    assert.ok(
      fake.calls.some((call) => call.startsWith("get_ads_manager:true:true")),
      "getAdsManager(video, settings) is what builds the manager",
    );
    assert.ok(fake.calls.includes("start"), "the ad starts");

    fake.fire("started");
    const playing = states.filter((state) => state.playing).at(-1);

    assert.ok(playing, "the overlay is told the ad is playing");
    assert.equal(playing?.engine, "ima");
    assert.equal(playing?.localSkip, false, "the tag has a skipoffset, so IMA owns the skip");
    assert.equal(playing?.skipAfterSec, 5);
    assert.equal(playing?.clickThrough, "https://advertiser.example/landing");
    assert.equal(outcomes.length, 0, "no outcome before the ad ends");

    fake.fire("all_ads_completed");
    assert.equal(outcomes.at(-1)?.kind, "completed");
    handle.destroy();
  } finally {
    container.remove();
    delete (globalThis as any).google;
  }
});

test("an ad with no skipoffset gets our own Skip after 5s, and it ends the ad", async () => {
  resetPrerollCounters();
  const fake = installFakeIma({ skipOffset: -1 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { options, outcomes, states } = imaOptions(container);

  try {
    const handle = await startImaPreroll(options);

    fake.loaded();
    fake.fire("started");
    const playing = states.filter((state) => state.playing).at(-1);

    assert.equal(playing?.localSkip, true, "IMA never offers a skip for this creative");
    assert.equal(playing?.skipAfterSec, 5);
    // Our button counts ad seconds; IMA's own state stays false.
    assert.equal(prerollSkipUi(playing!, 2, 5).canSkip, false);
    assert.equal(prerollSkipUi(playing!, 2, 5).label, "Skip in 3");
    assert.equal(prerollSkipUi(playing!, 5, 5).canSkip, true);

    handle.skip();
    assert.ok(fake.calls.includes("stop"), "the creative is stopped, not left running");
    assert.equal(outcomes.at(-1)?.kind, "skipped");
    handle.destroy();
  } finally {
    container.remove();
    delete (globalThis as any).google;
  }
});

test("an empty tag is no fill, not a broken ad", async () => {
  resetPrerollCounters();
  const fake = installFakeIma({ skipOffset: 5 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { options, outcomes } = imaOptions(container);

  try {
    const handle = await startImaPreroll(options);

    fake.loaderError("VAST response empty");
    assert.equal(outcomes.at(-1)?.kind, "no_fill");
    handle.destroy();
  } finally {
    container.remove();
    delete (globalThis as any).google;
  }
});

// ------------------------------------------------------------- the overlay

type OverlayHarness = {
  container: HTMLElement;
  unmount: () => void;
  emit: (patch: Partial<PrerollAdState>) => void;
  calls: string[];
  finished: PrerollOutcome[];
};

function renderOverlay(options: {
  skipAfterSec?: number;
  startTimeoutMs?: number;
  vastTimeoutMs?: number;
  onEngine?: (handle: { emit: (patch: Partial<PrerollAdState>) => void }) => void;
} = {}): OverlayHarness {
  const calls: string[] = [];
  const finished: PrerollOutcome[] = [];
  let emit: (patch: Partial<PrerollAdState>) => void = () => {};
  const startEngine = async (engineOptions: any): Promise<PrerollAdHandle> => {
    emit = (patch) => engineOptions.onState({ ...BASE_AD_STATE, engine: "ima", skipAfterSec: 5, ...patch });
    options.onEngine?.({ emit });

    return {
      skip: () => calls.push("skip"),
      toggleMute: () => {
        calls.push("mute");

        return true;
      },
      destroy: () => calls.push("destroy"),
    } as PrerollAdHandle;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(PrerollAd, {
        vastUrl: "https://tag.example/vast?r=1",
        skipAfterSec: options.skipAfterSec ?? 5,
        maxAdSec: 30,
        startTimeoutMs: options.startTimeoutMs ?? 50,
        vastTimeoutMs: options.vastTimeoutMs ?? 50,
        onFinished: (outcome: PrerollOutcome) => finished.push(outcome),
        startEngine,
      }),
    );
  });

  return {
    container,
    unmount: () => act(() => root.unmount()),
    emit: (patch) => act(() => emit(patch)),
    calls,
    finished,
  };
}

const findButton = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (node) => (node.getAttribute("aria-label") || node.textContent || "").trim() === name,
  ) ?? null;

test("the start budget never cuts an ad that is already playing", async () => {
  resetPrerollCounters();
  const playing = renderOverlay();

  playing.emit({ playing: true, remainingSec: 20 });
  await settle();
  await sleep(220);
  assert.deepEqual(playing.finished, [], "an ad in progress is not a timeout");
  playing.unmount();

  // The same budget still protects a viewer when nothing ever starts.
  const empty = renderOverlay();

  await sleep(220);
  assert.equal(empty.finished.at(-1)?.kind, "timeout");
  assert.equal(empty.finished.at(-1)?.reason, "hard_timeout");
  empty.unmount();
});

test("the overlay offers Skip for an IMA ad without a skipoffset, and only then", async () => {
  resetPrerollCounters();
  const local = renderOverlay();

  local.emit({ playing: true, remainingSec: 20, customControls: false, localSkip: true, skipAfterSec: 0 });
  await settle();
  const skip = findButton(local.container, "Skip ad");

  assert.ok(skip, "our button exists");
  assert.equal(skip?.hasAttribute("disabled"), false, "and is usable once the offset has passed");
  act(() => (skip as HTMLButtonElement).click());
  assert.deepEqual(local.calls.filter((call) => call === "skip"), ["skip"]);
  local.unmount();

  // IMA owns the skip (a skipoffset was present): no second, dead button.
  const native = renderOverlay();

  native.emit({ playing: true, remainingSec: 20, customControls: false, localSkip: false, skippable: false });
  await settle();
  assert.equal(findButton(native.container, "Skip ad"), null);
  native.unmount();
});

// ------------------------------------------------------------- source guards

test("the two faults cannot come back", () => {
  const ima = readFileSync(join(ROOT, "app/lib/ads/preroll-ima.ts"), "utf8");
  // The comment above the fix names the old call, so only real code counts here.
  const imaCode = ima.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(ima, /event\.getAdsManager\(video, renderingSettings\)/);
  assert.equal(
    /new\s+ima\.AdsManager\s*\(/.test(imaCode),
    false,
    "ima.AdsManager is not a constructor",
  );
  assert.match(ima, /buildAdTagUrl\(options\.adTagUrl, currentAdRequestContext\(\)\)/);

  const overlay = readFileSync(
    join(ROOT, "app/watch/[id]/components/VideoPlayer/PrerollAd.tsx"),
    "utf8",
  );

  assert.match(
    overlay,
    /if \(playingRef\.current\) \{/,
    "the hard stop is a start budget, and a playing ad only gets a stall watchdog",
  );
  assert.match(overlay, /ad_stalled/, "a stalled creative still lets the episode through");

  const vast = readFileSync(join(ROOT, "app/lib/ads/preroll-vast.ts"), "utf8");

  assert.equal(
    /fail\("ad_too_long"/.test(vast),
    false,
    "a 31s creative is capped, not turned into no-ad",
  );

  const player = readFileSync(join(ROOT, "app/watch/[id]/components/VideoPlayer/index.tsx"), "utf8");

  assert.match(player, /loadImaSdk\(8000\)/, "the SDK is primed before the Play tap");
  assert.match(player, /primeAdRequestContext\(\)/);
});
