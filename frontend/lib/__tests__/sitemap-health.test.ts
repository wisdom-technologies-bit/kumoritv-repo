import assert from "node:assert/strict";
import test from "node:test";
import { chunkCountFor, evaluateSitemapStaleness } from "../sitemap";

const NOW = Date.parse("2026-11-15T20:00:00Z");

test("an in-step view refreshed recently is not stale", () => {
  const health = evaluateSitemapStaleness({
    viewRows: 148_000,
    liveRows: 148_050,
    lastRefreshAt: "2026-11-15T19:40:00Z",
    now: NOW,
  });
  assert.equal(health.stale, false);
  assert.deepEqual(health.reasons, []);
  assert.equal(health.ageMinutes, 20);
});

test("the frozen 8487-URL case is stale and says why", () => {
  const health = evaluateSitemapStaleness({
    viewRows: 138_487,
    liveRows: 148_000,
    lastRefreshAt: "2026-11-15T06:00:00Z",
    now: NOW,
  });
  assert.equal(health.stale, true);
  assert.equal(health.difference, 9_513);
  assert.ok(health.reasons.includes("rows_differ"));
  assert.ok(health.reasons.includes("refresh_too_old"));
});

test("a 1% drift is tolerated, more is not; missing history is stale", () => {
  assert.equal(
    evaluateSitemapStaleness({ viewRows: 10_000, liveRows: 10_100, lastRefreshAt: "2026-11-15T19:55:00Z", now: NOW }).stale,
    false,
  );
  assert.equal(
    evaluateSitemapStaleness({ viewRows: 10_000, liveRows: 10_200, lastRefreshAt: "2026-11-15T19:55:00Z", now: NOW }).stale,
    true,
  );
  const never = evaluateSitemapStaleness({ viewRows: 5, liveRows: 5, lastRefreshAt: null, now: NOW });
  assert.equal(never.stale, true);
  assert.deepEqual(never.reasons, ["never_refreshed"]);
});

test("90 minutes is the age limit, and a new chunk appears automatically", () => {
  const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
  assert.equal(evaluateSitemapStaleness({ viewRows: 1, liveRows: 1, lastRefreshAt: at(89), now: NOW }).stale, false);
  assert.equal(evaluateSitemapStaleness({ viewRows: 1, liveRows: 1, lastRefreshAt: at(91), now: NOW }).stale, true);
  assert.equal(chunkCountFor(138_487), 14);
  assert.equal(chunkCountFor(148_000), 15);
  assert.equal(chunkCountFor(150_000), 15);
  assert.equal(chunkCountFor(150_001), 16);
});
