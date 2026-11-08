// Prompt 27: the mobile fixes on /media/[id] - the play pill's progress bar,
// the add-to-list menu's dismissal, and tap-to-flip cast cards.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { click, flush, render } from "../../test-harness/render";
import { FakeSupabaseClient } from "../../test-harness/fake-supabase";
import CastRow from "@/app/media/[id]/components/CastCard";
import { Button as AddToListButton } from "@/app/components/Buttons/AddToList";
import PlayBtn from "@/app/media/[id]/components/WatchPlayBtn";
import { __resetProgressSyncForTests, saveProgress } from "@/app/lib/user-data/progress";

const reactWithAct = React as unknown as { act: (callback: () => Promise<void> | void) => Promise<void> };

type Globals = {
  __commentsTestClient?: unknown;
  __commentsTestAuth?: unknown;
  __searchTestNavigation?: { pathname?: string; search?: string; pushed?: string[] };
};
const globals = globalThis as unknown as Globals;

function setGuest(client: FakeSupabaseClient | null = null) {
  globals.__commentsTestAuth = {
    user: null,
    profile: null,
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
  globals.__commentsTestClient = client;
}

async function press(element: Element, key: string) {
  await reactWithAct.act(async () => {
    element.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await flush();
}

async function pointerDown(target: EventTarget, x = 0, y = 0) {
  await reactWithAct.act(async () => {
    target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
  });
  await flush();
}

async function clickAt(element: Element, x = 0, y = 0) {
  await reactWithAct.act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  });
  await flush();
}

// ------------------------------------------------------------- play pill

const MEDIA_ID = 154587;

test("the play pill keeps its label, aria-label and a separate progress bar element", async () => {
  window.localStorage.clear();
  __resetProgressSyncForTests();

  saveProgress(MEDIA_ID, { episode: 5, time: 300, duration: 1440, audio: "sub" });

  const { container, unmount } = await render(
    <PlayBtn
      mediaId={MEDIA_ID}
      mediaTitle="Frieren: Beyond Journey's End"
      mediaFormat="TV"
      mediaEpisodes={28}
    />,
  );

  const button = container.querySelector("li.action_btn button");

  assert.ok(button, "the pill renders");

  const label = container.querySelector("#continue_span");
  assert.ok(label, "the episode label renders");
  assert.equal(label?.textContent, "EPISODE 5");
  assert.equal(label?.parentElement, button, "the label sits inside the pill");

  assert.equal(
    button?.getAttribute("aria-label"),
    "Continue Episode 5 - Frieren: Beyond Journey's End",
  );
  assert.equal(button?.getAttribute("data-episode"), "5");

  // The bar is its own element (a 4px strip in its own stylesheet), a sibling of
  // the label, so it can no longer read as a second button.
  const bar = button?.querySelector(".progress_bar");
  assert.ok(bar, "the progress bar renders inside the pill");
  assert.equal(bar?.children.length, 1, "the bar carries the fill as its only child");

  await unmount();
});

test("nothing is drawn for the progress bar when there is no progress", async () => {
  window.localStorage.clear();
  __resetProgressSyncForTests();

  const { container, unmount } = await render(
    <PlayBtn mediaId={MEDIA_ID} mediaTitle="Frieren" mediaFormat="TV" mediaEpisodes={28} />,
  );

  assert.equal(container.querySelector(".progress_bar"), null);
  assert.equal(container.querySelector("#continue_span"), null);

  await unmount();
});

// ------------------------------------------------------- add-to-list menu

const MEDIA = {
  id: 154587,
  title: { romaji: "Sousou no Frieren", english: "Frieren", native: "葬送のフリーレン" },
  format: "TV",
  type: "ANIME",
  description: "A journey after the journey.",
  coverImage: { large: "https://example.test/l.jpg", extraLarge: "https://example.test/xl.jpg" },
  episodes: 28,
};

/** The button reads the AniList user out of redux (`state.UserInfo.value`). */
function store() {
  return configureStore({
    reducer: {
      UserInfo: (state: unknown = { value: null }) => state,
      ShowLoginModal: (state: unknown = { value: false }) => state,
    },
  });
}

function listButton() {

  // The button swaps between two icons it is given as children (plus / x).
  const children = [<svg key="plus" />, <svg key="close" />];

  return (
    <Provider store={store()}>
      <AddToListButton mediaInfo={MEDIA as never} children={children} />
    </Provider>
  );
}

function menu(container: HTMLElement) {
  return container.querySelector("#user_media_status_list");
}

test("the status menu opens, then closes on Escape", async () => {
  window.localStorage.clear();
  setGuest(new FakeSupabaseClient());

  const { container, unmount } = await render(listButton());
  const trigger = container.querySelector("button");

  assert.equal(menu(container), null, "closed to start with");

  await click(trigger);
  assert.ok(menu(container), "the menu opens on click");
  assert.equal(trigger?.getAttribute("aria-label"), "Close List");

  await reactWithAct.act(async () => {
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();

  assert.equal(menu(container), null, "Escape closes the menu");
  assert.equal(trigger?.getAttribute("aria-label"), "Open List");

  await unmount();
});

test("the status menu closes on a tap outside it", async () => {
  window.localStorage.clear();
  setGuest(new FakeSupabaseClient());

  const { container, unmount } = await render(listButton());
  const trigger = container.querySelector("button");

  await click(trigger);
  assert.ok(menu(container));

  // a tap inside the menu keeps it open
  await pointerDown(menu(container)!);
  assert.ok(menu(container), "a tap inside the menu does not close it");

  // a tap anywhere else closes it
  await pointerDown(document.body);
  assert.equal(menu(container), null, "an outside tap closes the menu");

  await unmount();
});

// ------------------------------------------------------------- cast cards

const CAST = [
  {
    characterName: "Luffy Monkey",
    characterImage: "https://example.test/luffy.jpg",
    voiceActorName: "Mayumi Tanaka",
    voiceActorImage: "https://example.test/tanaka.jpg",
  },
  {
    characterName: "Zoro Roronoa",
    characterImage: "https://example.test/zoro.jpg",
    voiceActorName: "Kazuya Nakai",
    voiceActorImage: "https://example.test/nakai.jpg",
  },
  {
    characterName: "Narrator",
    characterImage: "https://example.test/narrator.jpg",
    voiceActorName: null,
    voiceActorImage: null,
  },
];

function cards(container: HTMLElement) {
  return [...container.querySelectorAll("li")] as HTMLElement[];
}

test("a cast card renders the character on the front and the actor on the back", async () => {
  const { container, unmount } = await render(<CastRow mediaType="ANIME" members={CAST} />);

  const [luffy] = cards(container);

  assert.equal(luffy.getAttribute("data-mediatype"), "ANIME");
  assert.equal(luffy.getAttribute("data-flipped"), null);
  assert.equal(luffy.getAttribute("role"), "button");
  assert.equal(luffy.getAttribute("tabindex"), "0");
  assert.equal(luffy.getAttribute("aria-pressed"), "false");
  assert.equal(luffy.getAttribute("aria-label"), "Show voice actor for Luffy Monkey");

  const front = luffy.querySelector(".character_container");
  const back = luffy.querySelector(".actor_container");

  assert.ok(front, "the character face renders");
  assert.ok(back, "the voice actor face renders");
  assert.equal(front?.querySelector("h3")?.textContent, "Luffy Monkey");
  assert.equal(back?.querySelector("h3")?.textContent, "Mayumi Tanaka");
  assert.equal(
    back?.querySelector("img")?.getAttribute("alt"),
    "Mayumi Tanaka voiceover for Luffy Monkey",
  );

  await unmount();
});

test("clicking a cast card flips it and back", async () => {
  const { container, unmount } = await render(<CastRow mediaType="ANIME" members={CAST} />);
  const [luffy] = cards(container);

  await click(luffy);
  assert.equal(luffy.getAttribute("data-flipped"), "true");
  assert.equal(luffy.getAttribute("aria-pressed"), "true");
  assert.equal(luffy.getAttribute("aria-label"), "Show character Luffy Monkey");

  await click(luffy);
  assert.equal(luffy.getAttribute("data-flipped"), null);
  assert.equal(luffy.getAttribute("aria-pressed"), "false");

  await unmount();
});

test("Enter and Space flip a cast card too", async () => {
  const { container, unmount } = await render(<CastRow mediaType="ANIME" members={CAST} />);
  const [, zoro] = cards(container);

  await press(zoro, "Enter");
  assert.equal(zoro.getAttribute("data-flipped"), "true");

  await press(zoro, " ");
  assert.equal(zoro.getAttribute("data-flipped"), null);

  await unmount();
});

test("only one cast card is flipped at a time", async () => {
  const { container, unmount } = await render(<CastRow mediaType="ANIME" members={CAST} />);
  const [luffy, zoro] = cards(container);

  await click(luffy);
  assert.equal(luffy.getAttribute("data-flipped"), "true");

  await click(zoro);
  assert.equal(zoro.getAttribute("data-flipped"), "true");
  assert.equal(luffy.getAttribute("data-flipped"), null, "the previous card unflips");

  const flipped = cards(container).filter((card) => card.getAttribute("data-flipped") === "true");
  assert.equal(flipped.length, 1);

  await unmount();
});

test("a card without a voice actor stays plain and non-interactive", async () => {
  const { container, unmount } = await render(<CastRow mediaType="ANIME" members={CAST} />);
  const narrator = cards(container)[2];

  assert.equal(narrator.getAttribute("role"), null);
  assert.equal(narrator.getAttribute("tabindex"), null);
  assert.equal(narrator.getAttribute("aria-pressed"), null);
  assert.equal(narrator.getAttribute("data-interactive"), null);
  assert.equal(narrator.querySelector(".actor_container"), null, "no back face is rendered");

  await click(narrator);
  assert.equal(narrator.getAttribute("data-flipped"), null);

  await press(narrator, "Enter");
  assert.equal(narrator.getAttribute("data-flipped"), null);

  await unmount();
});

test("manga cast cards are never interactive", async () => {
  const { container, unmount } = await render(<CastRow mediaType="MANGA" members={CAST} />);

  for (const card of cards(container)) {
    assert.equal(card.getAttribute("role"), null);
    assert.equal(card.getAttribute("tabindex"), null);
    assert.equal(card.querySelector(".actor_container"), null, "manga has no voice actor face");
  }

  await click(cards(container)[0]);
  assert.equal(cards(container)[0].getAttribute("data-flipped"), null);

  await unmount();
});

test("a swipe across the cast scroller does not flip a card", async () => {
  const { container, unmount } = await render(<CastRow mediaType="ANIME" members={CAST} />);
  const [luffy] = cards(container);

  // press at x=200, release and click 120px to the left: that is a drag, not a tap
  await pointerDown(luffy, 200, 300);
  await clickAt(luffy, 80, 300);

  assert.equal(luffy.getAttribute("data-flipped"), null, "the drag must not flip the card");

  // a real tap (same point) still flips
  await pointerDown(luffy, 80, 300);
  await clickAt(luffy, 82, 301);
  assert.equal(luffy.getAttribute("data-flipped"), "true");

  await unmount();
});
