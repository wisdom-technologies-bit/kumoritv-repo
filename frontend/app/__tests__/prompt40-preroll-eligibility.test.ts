// Prompt 40: flags, eligibility, the interval cap, the circuit breaker, counters.
import assert from "node:assert/strict";
import test from "node:test";
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
