import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { click, flush, render } from "../../test-harness/render";
import PlayBtn, { decidePlayTarget } from "../media/[id]/components/WatchPlayBtn";
import {
  __resetProgressSyncForTests,
  markWatched,
  mergeServerRowsIntoLocal,
  saveProgress,
} from "@/app/lib/user-data/progress";
import { FakeSupabaseClient } from "../../test-harness/fake-supabase";

const FRIEREN = {
  english: "Frieren: Beyond Journey's End",
  romaji: "Sousou no Frieren",
  native: "葬送のフリーレン",
  userPreferred: "Sousou no Frieren",
};

const MEDIA_ID = 154587;

type NavigationBag = { __searchTestNavigation?: { pushed?: string[] } };
type Globals = { __commentsTestClient?: unknown; __commentsTestAuth?: unknown };
const globals = globalThis as unknown as Globals & NavigationBag;

const act = (React as unknown as { act: (cb: () => Promise<void> | void) => Promise<void> }).act;

function resetNavigation() {
  globals.__searchTestNavigation = { pathname: "/media/154587", search: "", pushed: [] };
}

function pushed(): string[] {
  return globals.__searchTestNavigation?.pushed ?? [];
}

function setGuest() {
  globals.__commentsTestAuth = { user: null, profile: null, isAnonymous: false, loading: false, signOut: async () => {} };
  globals.__commentsTestClient = null;
}

function setSignedIn(userId = "user-1") {
  globals.__commentsTestAuth = {
    user: { id: userId },
    profile: { id: userId, username: "kumori" },
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
}

/** The single play button tile, found by the page styles it must carry. */
function playButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>("li.action_btn button");
}

function label(container: HTMLElement) {
  return container.querySelector("#continue_span")?.textContent ?? null;
}

function progressBar(container: HTMLElement) {
  return container.querySelector(".progress_bar");
}

async function mount(props: Partial<React.ComponentProps<typeof PlayBtn>> = {}) {
  return render(
    <PlayBtn
      mediaId={MEDIA_ID}
      mediaTitle={FRIEREN.english}
      mediaFormat="TV"
      mediaEpisodes={28}
      {...props}
    />,
  );
}

test.beforeEach(() => {
  window.localStorage.clear();
  __resetProgressSyncForTests();
  resetNavigation();
  setGuest();
});

// ---------------------------------------------------------------- behaviour

test("no progress opens episode 1 with no label", async () => {
  const { container, unmount } = await mount();
  const button = playButton(container);

  assert.ok(button, "the original action_btn tile must render");
  assert.equal(label(container), null);
  assert.equal(progressBar(container), null);
  assert.equal(button.getAttribute("aria-label"), "Watch Episode 1");
  assert.equal(button.getAttribute("title"), `Watch ${FRIEREN.english}`);
  assert.equal(button.hasAttribute("disabled"), false);

  await click(button);
  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=1`]);

  await unmount();
});

test("a part-watched episode resumes with its label, progress bar and timestamp", async () => {
  saveProgress(MEDIA_ID, { episode: 5, time: 300, duration: 1440, audio: "sub" });

  const { container, unmount } = await mount();
  const button = playButton(container);

  assert.equal(label(container), "EPISODE 5");
  assert.ok(progressBar(container), "the progress bar fills the tile");
  assert.equal(button?.getAttribute("aria-label"), `Continue Episode 5 - ${FRIEREN.english}`);

  await click(button);

  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=5&t=300`]);

  await unmount();
});

test("resuming a dub record keeps the dub audio", async () => {
  saveProgress(MEDIA_ID, { episode: 3, time: 120, duration: 1440, audio: "dub" });

  const { container, unmount } = await mount();

  await click(playButton(container));

  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=3&t=120&audio=dub`]);

  await unmount();
});

test("an almost finished episode does not resume, it continues to the next one", async () => {
  saveProgress(MEDIA_ID, { episode: 5, time: 1435, duration: 1440, audio: "sub" });

  const { container, unmount } = await mount();
  assert.equal(label(container), "EPISODE 6");

  await click(playButton(container));

  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=6`]);

  await unmount();
});

test("a watched episode opens the next one", async () => {
  markWatched(MEDIA_ID, 4);

  const { container, unmount } = await mount();

  assert.equal(label(container), "EPISODE 5");
  assert.equal(progressBar(container), null);

  await click(playButton(container));

  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=5`]);

  await unmount();
});

test("the next episode is capped at the total episode count", async () => {
  markWatched(MEDIA_ID, 28);

  const { container, unmount } = await mount();

  assert.equal(label(container), "EPISODE 28");

  await click(playButton(container));

  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=28`]);

  await unmount();
});

test("an unknown total is capped at the aired episode count", async () => {
  markWatched(MEDIA_ID, 5);

  const { container, unmount } = await mount({
    mediaEpisodes: null,
    nextAiringEpisode: { episode: 6 },
  });

  assert.equal(label(container), "EPISODE 5");

  await click(playButton(container));

  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=5`]);

  await unmount();
});

test("AniList progress higher than the local one wins", async () => {
  markWatched(MEDIA_ID, 2);

  const { container, unmount } = await mount({ anilistLastEpisodeWatched: 7 });

  assert.equal(label(container), "EPISODE 8");

  await unmount();
});

test("AniList progress lower than the local one does not go backwards", async () => {
  markWatched(MEDIA_ID, 9);

  const { container, unmount } = await mount({ anilistLastEpisodeWatched: 3 });

  assert.equal(label(container), "EPISODE 10");

  await unmount();
});

test("movies: CONTINUE on resume and the dub toggle changes the destination", async () => {
  const plain = await mount({ mediaFormat: "MOVIE", mediaEpisodes: 1 });

  assert.equal(label(plain.container), null);
  await click(playButton(plain.container));
  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=1`]);
  await plain.unmount();

  resetNavigation();
  saveProgress(MEDIA_ID, { episode: 1, time: 600, duration: 5400, audio: "sub" });

  const resumed = await mount({ mediaFormat: "MOVIE", mediaEpisodes: 1 });
  const movieLabels = resumed.container.querySelector("#continue_span");

  assert.equal(movieLabels?.textContent, "CONTINUE");
  await click(playButton(resumed.container));
  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=1&t=600`]);
  await resumed.unmount();

  // The dub checkbox lives in the movie options tile and flips the destination.
  resetNavigation();
  const dubbed = await mount({ mediaFormat: "MOVIE", mediaEpisodes: 1 });
  const checkbox = dubbed.container.querySelector<HTMLInputElement>('input[name="isDubbed"]');

  assert.ok(checkbox, "the movie options keep the dub checkbox");
  await click(checkbox);
  await click(playButton(dubbed.container));

  // The resumed movie keeps both its timestamp and the newly chosen audio.
  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=1&t=600&audio=dub`]);
  assert.equal(window.localStorage.getItem("dubEpisodes"), "true");

  await dubbed.unmount();
});

test("the movie options tile has no source select any more", async () => {
  const { container, unmount } = await mount({ mediaFormat: "MOVIE", mediaEpisodes: 1 });

  assert.equal(container.querySelectorAll("li").length, 2, "play tile + movie options tile");
  assert.equal(container.querySelector("select"), null);
  assert.equal(container.textContent?.includes("SOURCE"), false);

  await unmount();
});

test("signed-in users resume from the hydrated server progress", async () => {
  setSignedIn();
  globals.__commentsTestClient = new FakeSupabaseClient();

  // The server row arrives through the same merge the app runs on mount.
  mergeServerRowsIntoLocal([
    {
      anilist_id: MEDIA_ID,
      episode_number: 6,
      position_seconds: 240,
      duration_seconds: 1440,
      audio: "sub",
      completed: false,
      updated_at: new Date().toISOString(),
      snapshot: { title: { english: FRIEREN.english, romaji: FRIEREN.romaji } },
    } as never,
  ]);

  const { container, unmount } = await mount();
  assert.equal(label(container), "EPISODE 6");
  await click(playButton(container));
  assert.deepEqual(pushed(), [`/watch/${MEDIA_ID}?ep=6&t=240`]);

  await unmount();
});

test("the button updates after mount when progress changes", async () => {
  const { container, unmount } = await mount();

  assert.equal(label(container), null);

  await act(async () => {
    saveProgress(MEDIA_ID, { episode: 2, time: 60, duration: 1440, audio: "sub" });
  });
  await flush();

  assert.equal(label(container), "EPISODE 2");

  await unmount();
});

test("the first render is the episode-1 state, so hydration cannot mismatch", async () => {
  saveProgress(MEDIA_ID, { episode: 5, time: 300, duration: 1440, audio: "sub" });

  const serverMarkup = renderToString(
    <PlayBtn mediaId={MEDIA_ID} mediaTitle={FRIEREN.english} mediaFormat="TV" mediaEpisodes={28} />,
  );

  assert.match(serverMarkup, /data-episode="1"/);
  assert.equal(serverMarkup.includes("EPISODE"), false, "no label before mount");

  // The same markup a guest with no progress gets on the client.
  window.localStorage.clear();
  __resetProgressSyncForTests();
  const guestTree = await mount();
  const guestAdding = guestTree.container.querySelector("li.action_btn button")?.outerHTML ?? "";

  assert.match(guestAdding, /data-episode="1"/);
  assert.equal(guestAdding.includes("EPISODE"), false);

  await guestTree.unmount();
});

test("titles use the english fixture, never romaji", async () => {
  const { container, unmount } = await mount({ mediaTitle: FRIEREN.english });

  assert.equal(playButton(container)?.getAttribute("title"), `Watch ${FRIEREN.english}`);
  assert.equal(container.textContent?.includes("Sousou no Frieren"), false);

  await unmount();
});

// ------------------------------------------------------------- decidePlayTarget

test("decidePlayTarget reports the progress fraction for the bar", () => {
  saveProgress(MEDIA_ID, { episode: 5, time: 300, duration: 1440, audio: "sub" });

  const target = decidePlayTarget({ mediaId: MEDIA_ID, mediaFormat: "TV", mediaEpisodes: 28 });

  assert.equal(target.episode, 5);
  assert.equal(target.time, 300);
  assert.equal(target.hasLabel, true);
  assert.equal(Math.round(target.progress * 100), 21);
});

test("a 4 second record is not a resume point", () => {
  saveProgress(MEDIA_ID, { episode: 2, time: 4, duration: 1440, audio: "sub" });

  const target = decidePlayTarget({ mediaId: MEDIA_ID, mediaFormat: "TV", mediaEpisodes: 28 });

  assert.equal(target.episode, 1);
  assert.equal(target.hasLabel, false);
});
