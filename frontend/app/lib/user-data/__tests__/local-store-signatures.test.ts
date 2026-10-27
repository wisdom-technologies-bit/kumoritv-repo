import assert from "node:assert/strict";
import test from "node:test";
import { installBrowserShim } from "../../../../test-harness/browser";
import { __setDefaultContextForTests } from "../context";
import { __resetProgressSyncForTests } from "../progress";
import * as progress from "@/app/lib/local-store/progress";
import * as prefs from "@/app/lib/local-store/prefs";

test("the player-facing progress exports keep their signatures", () => {
  installBrowserShim();
  __resetProgressSyncForTests();
  __setDefaultContextForTests({ userId: null, client: null, storage: null, now: () => Date.now() });

  // exactly how app/watch/[id]/components/VideoPlayer calls it
  progress.saveProgress(154587, {
    episode: 3,
    time: 240,
    duration: 1420,
    audio: "sub",
    title: "Dandadan",
  });

  const saved = progress.getProgress(154587);
  assert.equal(saved?.episode, 3);
  assert.equal(saved?.title, "Dandadan");

  assert.equal(typeof progress.shouldResume(240, 1420), "boolean");

  progress.markWatched(154587, 3);
  assert.equal(progress.isWatched(154587, 3), true);

  const continueWatching = progress.listContinueWatching(20);
  assert.equal(continueWatching[0].id, 154587);

  const unsubscribe = progress.subscribe(() => undefined);
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();
});

test("the preference exports keep their signatures", () => {
  installBrowserShim();

  prefs.setLocalPref("autoNext", false);
  assert.equal(prefs.readPrefs().autoNext, false);

  prefs.setLocalPref("subtitle_language", "Portuguese");
  assert.equal(prefs.readPrefs().subtitle_language, "Portuguese");

  assert.equal(typeof prefs.useLocalPrefs, "function");
  assert.equal(typeof prefs.usePrefs, "function");
});
