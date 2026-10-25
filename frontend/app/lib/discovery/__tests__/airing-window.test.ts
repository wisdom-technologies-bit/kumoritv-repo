import assert from "node:assert/strict";
import test from "node:test";
import { calculateAiringWindow } from "../airing-window";

test("seeds a full 30-day airing window when no watermark exists", () => {
  const now = 1_800_000_000;
  const result = calculateAiringWindow(now, null, null);
  assert.equal(result.from, now - 30 * 86400);
  assert.equal(result.to, now);
  assert.equal(result.seeded, true);
});
test("uses the rolling 48-hour window after seeding", () => {
  const now = 1_800_000_000;
  const last = new Date((now - 10 * 86400) * 1000).toISOString();
  const result = calculateAiringWindow(now, last, {});
  assert.equal(result.from, now - 172800);
  assert.equal(result.seeded, false);
});
test("continues a truncated seed from its oldest fetched airing", () => {
  const now = 1_800_000_000;
  const oldest = new Date((now - 20 * 86400) * 1000).toISOString();
  const result = calculateAiringWindow(now, new Date(now * 1000).toISOString(), { seed_truncated: true, oldest_airing_at: oldest });
  assert.equal(result.from, now - 20 * 86400 - 3600);
  assert.equal(result.seeded, true);
});
