// Prompt 40: flags, eligibility, the interval cap, the circuit breaker, counters.
import assert from "node:assert/strict";
import test from "node:test";
const ROOT_TESTS = join(import.meta.dirname, "..", "..");

import { readFileSync } from "node:fs";
import { join } from "node:path";
  import {
  PREROLL_BREAKER_OPEN_MS,
  PREROLL_DEFAULTS,
  PREROLL_MAX_SKIP_SEC,
  getPrerollCounters,
  isPrerollBreakerOpen,
  prerollEligibility,
  readPrerollConfig,
  recordPrerollCount,
  registerPrerollFailure,
  registerPrerollSuccess,
  resetPrerollCounters,
  type PrerollConfig,
  prerollHardStopMs,
  prerollNoFillUntil,
  writePrerollNoFill,
  readPrerollStore,
  setPrerollDebug,
  prerollDebug,
  lastPrerollDebugLine,
} from "../lib/ads/preroll";

const ON: PrerollConfig = readPrerollConfig({
  PREROLL_ENABLED: "1",
  ADCASH_VAST_URL: "https://tag.example/vast?r=1",
});

const base = {
  config: ON,
  isEmbed: false,
  resumeAtSec: 0,
  isStaff: false,
  adultBlocked: false,
  now: 1_000_000,
  lastAdAt: null as number | null,
  tabAdAt: null as number | null,
  breakerOpenUntil: null as number | null,
};

test("everything is off by default: no flag, no tag, no pre-roll", () => {
  const off = readPrerollConfig({});

  assert.equal(off.enabled, false);
  assert.equal(off.vastUrl, "");
  assert.deepEqual(
    {
      intervalMin: off.intervalMin,
      skipAfterSec: off.skipAfterSec,
      maxAdSec: off.maxAdSec,
      startTimeoutMs: off.startTimeoutMs,
      vastTimeoutMs: off.vastTimeoutMs,
      noFillCooldownMin: off.noFillCooldownMin,
    },
    { ...PREROLL_DEFAULTS },
    "documented defaults",
  );
  assert.equal(prerollEligibility({ ...base, config: off }).ok, false);
  // A tag alone is not enough, and a flag alone is not enough.
  assert.equal(readPrerollConfig({ ADCASH_VAST_URL: "https://tag.example/vast" }).enabled, false);
  assert.equal(readPrerollConfig({ PREROLL_ENABLED: "1" }).enabled, false);
});

test("config is read at request time and clamped", () => {
  assert.equal(readPrerollConfig({ PREROLL_ENABLED: "1", ADCASH_VAST_URL: "https://t.example/v" }).enabled, true);
  assert.equal(
    readPrerollConfig({ PREROLL_ENABLED: "1", ADCASH_VAST_URL: "https://t.example/v", PREROLL_SKIP_AFTER_SEC: "45" })
      .skipAfterSec,
    PREROLL_MAX_SKIP_SEC,
    "a skip may never wait more than 10s",
  );
  assert.equal(
    readPrerollConfig({ PREROLL_ENABLED: "1", ADCASH_VAST_URL: "https://t.example/v", PREROLL_INTERVAL_MIN: "0" })
      .intervalMin,
    0,
    "0 means every eligible play",
  );
  assert.equal(readPrerollConfig({ PREROLL_ENABLED: "1", ADCASH_VAST_URL: "ftp://nope" }).enabled, false);
  assert.equal(readPrerollConfig({ PREROLL_ENABLED: "off", ADCASH_VAST_URL: "https://t.example/v" }).enabled, false);
});

test("an eligible first play gets an ad", () => {
  assert.deepEqual(prerollEligibility(base), { ok: true });
});

test("each blocking condition is reported with its own reason", () => {
  const reason = (patch: Record<string, unknown>) => {
    const decision = prerollEligibility({ ...base, ...patch });

    return decision.ok ? "ok" : (decision as { reason: string }).reason;
  };

  assert.equal(reason({ isEmbed: true }), "embed");
  assert.equal(reason({ isStaff: true }), "staff");
  assert.equal(reason({ adultBlocked: true }), "adult");
  assert.equal(reason({ resumeAtSec: 31 }), "resume");
  assert.equal(reason({ resumeAtSec: 30 }), "ok", "30s and under is still a fresh start");
  assert.equal(reason({ config: { ...ON, intervalMin: 20 }, lastAdAt: base.now - 5 * 60 * 1000 }), "interval");
  assert.equal(reason({ lastAdAt: base.now - 21 * 60 * 1000 }), "ok", "the interval has passed");
  assert.equal(reason({ tabAdAt: base.now - 25 * 60 * 1000 }), "tab", "a second tab does not double it");
  assert.equal(reason({ breakerOpenUntil: base.now + 60_000 }), "breaker");
  assert.equal(reason({ config: { ...ON, intervalMin: 0 }, lastAutoplayAdAt: base.now - 60_000 }), "autoplay");
  assert.equal(
    reason({ config: { ...ON, intervalMin: 0 }, lastAutoplayAdAt: base.now - 6 * 60 * 1000 }),
    "ok",
    "auto-next five minutes later is allowed",
  );
});

test("three failures inside ten minutes open the breaker for thirty", () => {
  let state = registerPrerollSuccess();
  const now = 5_000_000;

  state = registerPrerollFailure(state, now);
  assert.equal(isPrerollBreakerOpen(state, now), false);
  state = registerPrerollFailure(state, now + 1000);
  assert.equal(isPrerollBreakerOpen(state, now + 1000), false);
  state = registerPrerollFailure(state, now + 2000);
  assert.equal(isPrerollBreakerOpen(state, now + 2000), true);
  assert.equal(state.openUntil, now + 2000 + PREROLL_BREAKER_OPEN_MS);
  assert.equal(isPrerollBreakerOpen(state, now + 2000 + PREROLL_BREAKER_OPEN_MS - 1), true);
  assert.equal(isPrerollBreakerOpen(state, now + 2000 + PREROLL_BREAKER_OPEN_MS), false);
  // Failures outside the ten minute window do not accumulate.
  const stale = registerPrerollFailure(registerPrerollFailure({ failures: [now - 11 * 60 * 1000, now - 10 * 60 * 1000], openUntil: null }, now), now);
  assert.equal(isPrerollBreakerOpen(stale, now), false);
  assert.deepEqual(registerPrerollSuccess(), { failures: [], openUntil: null });
});

test("counters count outcomes and reasons", () => {
  resetPrerollCounters();
  recordPrerollCount("requests");
  recordPrerollCount("noFill", "no_fill");
  recordPrerollCount("started");
  recordPrerollCount("completed");

  const counters = getPrerollCounters();

  assert.equal(counters.requests, 1);
  assert.equal(counters.noFill, 1);
  assert.equal(counters.started, 1);
  assert.equal(counters.completed, 1);
  assert.equal(counters.byReason.no_fill, 1);
  resetPrerollCounters();
  assert.equal(getPrerollCounters().requests, 0);
});

// ---------------------------------------------------------------- Prompt 41

test("a no-fill parks ad requests for the cooldown window, then lets them back", () => {
  const on = readPrerollConfig({
    PREROLL_ENABLED: "1",
    ADCASH_VAST_URL: "https://tag.example/vast",
  });

  assert.equal(on.noFillCooldownMin, 10, "default cooldown is ten minutes");

  const noFillUntil = prerollNoFillUntil(on, 1_000_000);

  assert.equal(noFillUntil, 1_000_000 + 10 * 60 * 1000);
  assert.equal(
    prerollEligibility({ ...base, config: on, noFillUntil }).ok,
    false,
    "inside the window nothing is requested",
  );
  assert.equal(
    (prerollEligibility({ ...base, config: on, noFillUntil }) as any).reason,
    "no_fill_cooldown",
  );
  assert.equal(
    prerollEligibility({ ...base, config: on, noFillUntil, now: noFillUntil + 1 }).ok,
    true,
    "the window expires on its own",
  );
  assert.equal(
    prerollEligibility({
      ...base,
      config: readPrerollConfig({
        PREROLL_ENABLED: "1",
        ADCASH_VAST_URL: "https://tag.example/vast",
        PREROLL_NOFILL_COOLDOWN_MIN: "0",
      }),
      noFillUntil,
    }).ok,
    true,
    "PREROLL_NOFILL_COOLDOWN_MIN=0 disables the cooldown",
  );
  assert.equal(prerollNoFillUntil({ noFillCooldownMin: 0 }, 5), null);
});

test("the no-fill instant survives a reload (localStorage) and can be cleared", () => {
  writePrerollNoFill(4242);
  assert.equal(readPrerollStore().noFillUntil, 4242);
  writePrerollNoFill(null);
  assert.equal(readPrerollStore().noFillUntil, null);
});

test("the whole ad budget is start + tag, capped at eight seconds", () => {
  assert.equal(prerollHardStopMs({ startTimeoutMs: 5000, vastTimeoutMs: 3000 }), 8000);
  assert.equal(
    prerollHardStopMs({ startTimeoutMs: 30000, vastTimeoutMs: 20000 }),
    8000,
    "no env value may hold a viewer longer than eight seconds",
  );
  const config = readPrerollConfig({});

  assert.equal(config.startTimeoutMs, 5000, "PREROLL_START_TIMEOUT_MS default");
  assert.equal(config.vastTimeoutMs, 3000, "PREROLL_VAST_TIMEOUT_MS default");
});

test("a no-fill is counted once, with its reason", () => {
  resetPrerollCounters();
  recordPrerollCount("noFill", "ima_no_fill_1009");
  const counters = getPrerollCounters();

  assert.equal(counters.noFill, 1);
  assert.equal(counters.byReason.ima_no_fill_1009, 1);
});

test("?prerolldebug=1 is the only thing that prints pre-roll steps", () => {
  setPrerollDebug(false);
  prerollDebug("silent");
  assert.equal(lastPrerollDebugLine(), "silent", "the line is still recorded for the UI");

  setPrerollDebug(true);
  let seen = "";
  const off = (() => {
    const { onPrerollDebug } = require("../lib/ads/preroll");

    return onPrerollDebug((line: string) => (seen = line));
  })();

  prerollDebug("loud", "detail");
  off();
  setPrerollDebug(false);
  assert.equal(seen, "loud detail");
});

// -------------------------------------------------- Prompt 41: the hard block

test("the content cannot start while an ad is pending", () => {
  const player = readFileSync(join(ROOT_TESTS, "app/watch/[id]/components/VideoPlayer/index.tsx"), "utf8");

  assert.match(
    player,
    /if \(prerollPendingRef\.current\) \{\s*event\.preventDefault\?\.\(\);\s*return;/,
    "a pending ad refuses the play gesture before deciding anything",
  );
  for (const name of ["media-play-request", "media-seek-request", "media-pause-request"]) {
    assert.ok(
      player.includes(`addEventListener("${name}", blockWhilePending, true)`),
      `${name} is refused in the capture phase while pending`,
    );
  }
  assert.ok(player.includes('setAttribute("data-preroll", "pending")'));
  assert.ok(player.includes('removeAttribute("data-preroll")'));
  assert.ok(player.includes("preroll_content_leak"));

  const playerCss = readFileSync(join(ROOT_TESTS, "app/watch/[id]/components/VideoPlayer/component.module.css"), "utf8");

  assert.ok(playerCss.includes('[data-preroll="pending"]'), "the controls are hidden while pending");

  const overlayCss = readFileSync(join(ROOT_TESTS, "app/watch/[id]/components/VideoPlayer/preroll.module.css"), "utf8");

  assert.match(overlayCss, /\.layer \{[^}]*inset: 0;[^}]*z-index: 30/s, "the ad owns the whole box");
});
