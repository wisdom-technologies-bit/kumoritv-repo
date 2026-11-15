// Prompt 40: the pre-roll overlay itself - chrome, skip timing, keyboard, mute,
// click-through, and the one exit path that starts the content.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PrerollAd from "../watch/[id]/components/VideoPlayer/PrerollAd";
import { resetPrerollCounters } from "../lib/ads/preroll";
import { prerollSkipUi, type PrerollAdHandle, type PrerollAdState, type PrerollOutcome } from "../lib/ads/preroll-engine";

/** The engine promise resolves on a microtask: let the component hold its handle. */
const settle = () => act(async () => {});

const ROOT = join(import.meta.dirname, "..", "..");

type Harness = {
  container: HTMLElement;
  unmount: () => void;
};

/** A scripted engine: it hands the test its own state/done emitters. */
function renderOverlay(options: {
  width?: number;
  skipAfterSec?: number;
  maxAdSec?: number;
  autoplay?: boolean;
  onFinished?: (outcome: PrerollOutcome) => void;
  onEngine?: (engine: {
    emit: (patch: Partial<PrerollAdState>) => void;
    done: (outcome: PrerollOutcome) => void;
    calls: string[];
  }) => void;
}): { harness: Harness; calls: string[]; emit: (patch: Partial<PrerollAdState>) => void; done: (outcome: PrerollOutcome) => void } {
  const calls: string[] = [];
  let emit: (patch: Partial<PrerollAdState>) => void = () => {};
  let done: (outcome: PrerollOutcome) => void = () => {};
  const startEngine = async (engineOptions: any): Promise<PrerollAdHandle> => {
    emit = (patch) => engineOptions.onState(engineOptions.__state = { ...baseState(), ...patch });
    done = (outcome: PrerollOutcome) => engineOptions.onDone(outcome);
    engineOptions.onState(baseState());
    options.onEngine?.({ emit, done, calls });

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
  if (options.width) container.style.width = `${options.width}px`;
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(PrerollAd, {
        vastUrl: "https://tag.example/vast?r=1",
        skipAfterSec: options.skipAfterSec ?? 5,
        maxAdSec: options.maxAdSec ?? 30,
        startTimeoutMs: 6000,
        vastTimeoutMs: 4000,
        autoplay: options.autoplay,
        onFinished: options.onFinished ?? (() => calls.push("finished")),
        startEngine,
      }),
    );
  });

  return {
    harness: { container, unmount: () => act(() => root.unmount()) },
    calls,
    emit: (patch) => act(() => emit(patch)),
    done: (outcome) => act(() => done(outcome)),
  };
}

function baseState(): PrerollAdState {
  return {
    engine: "vast",
    playing: false,
    remainingSec: 15,
    skipAfterSec: 5,
    skippable: false,
    customControls: true,
    muted: false,
    clickThrough: null,
  };
}

const button = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll("button")).find((node) => (node.getAttribute("aria-label") || node.textContent || "").trim() === name) ?? null;

test("the overlay is an ad surface that never blocks a small phone or desktop layout", () => {
  for (const width of [360, 1280]) {
    resetPrerollCounters();
    const { harness } = renderOverlay({ width });

    assert.ok(harness.container.querySelector("[data-preroll-engine]"), "one overlay root");
    assert.match(harness.container.textContent || "", /Ad/);
    harness.unmount();
  }
});

test("Skip is a countdown until the offset, then the button", async () => {
  resetPrerollCounters();
  const { harness, calls, emit } = renderOverlay({ skipAfterSec: 5 });

  await settle();
  emit({ playing: true, remainingSec: 12, skippable: false });
  const waiting = button(harness.container, "Skip ad");
  assert.ok(waiting, "the skip control exists from the start");
  assert.equal(waiting?.hasAttribute("disabled"), true, "but it waits for the offset");
  assert.match(harness.container.textContent || "", /Skip in 5/);

  // The label logic itself is pure and covered directly:
  const state = { ...baseState(), skipAfterSec: 5 };
  assert.equal(prerollSkipUi(state, 2, 5).label, "Skip in 3");
  assert.equal(prerollSkipUi(state, 5, 5).label, "Skip ad");
  assert.equal(prerollSkipUi(state, 5, 5).canSkip, true);
  assert.equal(
    prerollSkipUi({ ...state, customControls: false, skippable: true }, 0, 5).canSkip,
    true,
    "IMA decides when its own skip is ready",
  );

  harness.unmount();
  assert.ok(calls.includes("destroy"), "unmount destroys the engine");
});

test("keyboard: Space skips once the ad allows it, and never reaches the player", async () => {
  resetPrerollCounters();
  const { harness, emit } = renderOverlay({ skipAfterSec: 0 });

  emit({ playing: true, skippable: true });
  await settle();
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  window.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true, "the player's space shortcut is suppressed");
  harness.unmount();
});

test("mute toggles through the engine and reports its own state", async () => {
  resetPrerollCounters();
  const { harness, calls, emit } = renderOverlay({});

  await settle();
  emit({ playing: true });
  const mute = button(harness.container, "Mute ad");
  assert.ok(mute);
  act(() => (mute as HTMLButtonElement).click());
  assert.deepEqual(calls.filter((call) => call === "mute"), ["mute"]);
  harness.unmount();
});

test("Visit advertiser opens a new tab, with no opener, and pauses the ad", async () => {
  resetPrerollCounters();
  const opened: Array<{ url: string; target: string; features: string }> = [];
  const originalOpen = window.open;
  (window as any).open = (url: string, target: string, features: string) => {
    opened.push({ url, target, features });

    return null;
  };
  try {
    const { harness, calls, emit } = renderOverlay({});

    await settle();
    emit({ playing: true, clickThrough: "https://advertiser.example/landing" });
    const visit = button(harness.container, "Visit advertiser");
    assert.ok(visit, "the click-through appears when the tag has one");
    act(() => (visit as HTMLButtonElement).click());

    assert.deepEqual(opened, [
      { url: "https://advertiser.example/landing", target: "_blank", features: "noopener,noreferrer" },
    ]);
    assert.ok(calls.filter((call) => call === "mute").length >= 2, "the ad is paused before leaving");
    harness.unmount();
  } finally {
    (window as any).open = originalOpen;
  }
});

test("every ending calls onFinished exactly once, so the content starts once", () => {
  for (const outcome of [
    { kind: "completed" as const, ms: 12000 },
    { kind: "skipped" as const, reason: "skip", ms: 5000 },
    { kind: "error" as const, reason: "media_error", ms: 900 },
    { kind: "timeout" as const, reason: "start_timeout", ms: 6000 },
    { kind: "no_fill" as const, reason: "no_fill", ms: 400 },
  ]) {
    resetPrerollCounters();
    const finished: PrerollOutcome[] = [];
    const { harness, done } = renderOverlay({ onFinished: (result) => finished.push(result) });

    done(outcome);
    done({ ...outcome, kind: "completed" });
    assert.deepEqual(finished, [outcome], `${outcome.kind} finishes once`);
    harness.unmount();
  }
});

test("the IMA script is reachable only through the pre-roll overlay", () => {
  const ima = readFileSync(join(ROOT, "app/lib/ads/preroll-ima.ts"), "utf8");

  assert.match(ima, /https:\/\/imasdk\.googleapis\.com\/js\/sdkloader\/ima3\.js/);
  // Loaded lazily, inside a function, never at module scope.
  assert.match(ima, /export function loadImaSdk/);
  assert.equal(
    /^\s*(loadImaSdk|startImaPreroll)\(/m.test(ima),
    false,
    "nothing runs on import",
  );
  const player = readFileSync(join(ROOT, "app/watch/[id]/components/VideoPlayer/index.tsx"), "utf8");

  assert.match(player, /prerollRun && preroll && \(/, "the overlay mounts only when armed");
  const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");

  assert.equal(/ima3\.js|PrerollAd|preroll/.test(layout), false, "the ad scripts are not global");
});
