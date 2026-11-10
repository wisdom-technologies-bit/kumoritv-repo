// Prompt 33 Part B - the "On KumoriTV" rule, as pure logic.
//
// `rowIsPlayable` / `applyAvailability` are the two functions that decide
// whether a card says "On KumoriTV" or "Coming". The Supabase read around them
// is exercised by the page, not here; the decision itself is pure and is what
// a wrong column name would silently break, so it is pinned.
import assert from "node:assert/strict";
import test from "node:test";
// The decision itself is pure, so it lives outside the server-only module.
import { applyAvailability, playableKey, rowIsPlayable } from "@/app/lib/schedule/on-kumori";
import type { ScheduleItem } from "@/app/lib/schedule/types";

// The real columns are `sub_providers` / `dub_providers` on public.episodes
// (supabase/migrations), each a JSON array of provider streams.
test("an episode counts as playable only when a provider column has an entry", () => {
  assert.equal(rowIsPlayable({}), false, "an empty row is not a source");
  assert.equal(rowIsPlayable({ anilist_id: 21, episode_number: 5 }), false, "keys alone prove nothing");
  assert.equal(rowIsPlayable({ sub_providers: [], dub_providers: [] }), false, "no providers, nothing to play");
  assert.equal(rowIsPlayable({ sub_providers: null, dub_providers: null }), false);
  assert.equal(rowIsPlayable({ sub_providers: [{ url: "https://cdn.example/e1.m3u8" }] }), true, "sub is enough");
  assert.equal(rowIsPlayable({ dub_providers: [{ url: "https://cdn.example/e1.m3u8" }] }), true, "dub is enough");
  assert.equal(rowIsPlayable({ sub_providers: '["https://cdn.example/e1"]' }), true, "JSON string form");
  assert.equal(rowIsPlayable({ sub_providers: "not json" }), false, "garbage is not a source");
  assert.equal(rowIsPlayable({ sub_providers: "[]" }), false);
});

test("the playable key is media plus episode, nothing else", () => {
  assert.equal(playableKey(21, 5), "21:5");
  assert.notEqual(playableKey(21, 5), playableKey(21, 6));
  assert.notEqual(playableKey(21, 5), playableKey(211, 5), "ids never collide on a prefix");
});

test("availability is stamped, never invented", () => {
  const items = [
    { id: 1, airingAt: 100, episode: 5, media: { id: 21 } },
    { id: 2, airingAt: 200, episode: 6, media: { id: 21 } },
    { id: 3, airingAt: 300, episode: 1, media: { id: 99 } },
  ] as ScheduleItem[];

  const stamped = applyAvailability(items, new Set(["21:5"]));
  assert.equal(stamped[0]!.available, true);
  assert.equal(stamped[1]!.available, false);
  assert.equal(stamped[2]!.available, false);
  assert.equal(stamped.length, 3, "nothing is dropped");
});

test("an empty playable set marks everything as coming", () => {
  const items = [{ id: 1, airingAt: 100, episode: 5, media: { id: 21 } }] as ScheduleItem[];
  assert.deepEqual(
    applyAvailability(items, new Set()).map((item) => item.available),
    [false],
  );
});
