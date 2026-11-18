// Phase 5: the /clips browser shell.
//
// The first page arrives from the server, so these tests start where the real
// page starts and assert what the reader gets from there: cards with one link
// each, a Load more that appends instead of replacing, a skeleton while a new
// filter loads, an empty state that offers a way out, an error that keeps the
// filters and retries, and the adult placeholder that never leaks a title.
//
// fetch is a stub: the point is the shell's behaviour, not the network.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, flush, render, submit } from "../../../../test-harness/render";
import ClipsBrowser from "../ClipsBrowser";
import type { BrowseItem } from "@/app/lib/clips/browse";

const item = (overrides: Partial<BrowseItem> = {}): BrowseItem => ({
  code: "k7m2p9q",
  anilistId: 21,
  animeTitle: "One Piece",
  episode: 4,
  start: 42,
  end: 57,
  durationSec: 15,
  views: 12400,
  createdAt: "2026-11-17T12:00:00.000Z",
  authorName: null,
  thumb: "/thumb/21/4",
  adult: false,
  ...overrides,
});

type Call = { url: string };
const calls: Call[] = [];

function stubFetch(responder: (url: string) => Promise<Response> | Response) {
  calls.length = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    return responder(url);
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseProps(overrides: Partial<React.ComponentProps<typeof ClipsBrowser>> = {}) {
  return {
    initialItems: [item(), item({ code: "abc1234", animeTitle: "Bleach" })],
    initialNextCursor: null,
    initialQuery: { sort: "latest" as const, q: "", anime: null },
    initialCount: 2,
    showAdult: false,
    ...overrides,
  };
}

const cards = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-clip-code]"));

test("each card is exactly one link, and it points at the clip page", async () => {
  stubFetch(() => json({ items: [], nextCursor: null }));
  const { container, unmount } = await render(React.createElement(ClipsBrowser, baseProps()));

  const card = cards(container)[0];
  const links = card.querySelectorAll("a[href^='/clip/']");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "/clip/k7m2p9q");
  // No anchor inside the card's main link.
  assert.equal(links[0].querySelectorAll("a").length, 0);

  await unmount();
});

test("the count is announced politely, so a screen reader hears the result", async () => {
  stubFetch(() => json({ items: [], nextCursor: null }));
  const { container, unmount } = await render(React.createElement(ClipsBrowser, baseProps()));

  const status = container.querySelector("[role='status']");
  assert.ok(status);
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.match(status.textContent ?? "", /2 clips/);

  await unmount();
});

test("Load more appends the next page and keeps the ones already read", async () => {
  stubFetch(() => json({ items: [item({ code: "next111" })], nextCursor: null }));
  const { container, unmount } = await render(
    React.createElement(ClipsBrowser, baseProps({ initialNextCursor: "cursor-1" })),
  );

  assert.equal(cards(container).length, 2);
  const loadMore = Array.from(container.querySelectorAll("button")).find((button) =>
    /Load more/i.test(button.textContent ?? ""),
  );
  assert.ok(loadMore, "the Load more button should exist while a cursor remains");

  await click(loadMore);
  await flush();

  assert.equal(cards(container).length, 3);
  assert.ok(cards(container).some((card) => card.getAttribute("data-clip-code") === "next111"));
  // The request carried the cursor, not a page number.
  assert.match(calls[0].url, /cursor=cursor-1/);
  // Nothing left to load: the button is replaced by the end marker.
  assert.equal(
    Array.from(container.querySelectorAll("button")).some((button) => /Load more/i.test(button.textContent ?? "")),
    false,
  );
  assert.ok(container.querySelector("[data-testid='clips-end']"));

  await unmount();
});

test("changing the sort asks the API for that order and updates the URL", async () => {
  stubFetch(() => json({ items: [item({ views: 99 })], nextCursor: null }));
  const bag = globalThis as unknown as { __searchTestNavigation?: { pushed?: string[] } };
  bag.__searchTestNavigation = { pushed: [] };

  const { container, unmount } = await render(React.createElement(ClipsBrowser, baseProps()));

  const views = Array.from(container.querySelectorAll("[role='tab']")).find((tab) =>
    /Most viewed/i.test(tab.textContent ?? ""),
  );
  await click(views ?? null);
  await flush();

  assert.match(calls[0].url, /sort=views/);
  assert.equal(bag.__searchTestNavigation?.pushed?.[0], "/clips?sort=views");
  const selected = Array.from(container.querySelectorAll("[role='tab']")).find(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  assert.match(selected?.textContent ?? "", /Most viewed/);

  await unmount();
});

test("a filter change shows the skeleton first, then the new cards", async () => {
  let release: (() => void) | null = null;
  stubFetch(
    () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json({ items: [item({ code: "fresh01" })], nextCursor: null }));
      }),
  );

  const { container, unmount } = await render(React.createElement(ClipsBrowser, baseProps()));
  const week = Array.from(container.querySelectorAll("[role='tab']")).find((tab) =>
    /This week/i.test(tab.textContent ?? ""),
  );

  await click(week ?? null); // stays pending: the promise has not resolved
  assert.ok(container.querySelector("[data-testid='clips-skeleton']"), "the skeleton should be visible while loading");
  // The old list is gone rather than half-updated.
  assert.equal(cards(container).length, 0);

  // Assigned inside the fetch closure above, so TS still sees the initial null.
  (release as (() => void) | null)?.();
  await flush();

  assert.equal(container.querySelector("[data-testid='clips-skeleton']"), null);
  assert.equal(cards(container).length, 1);
  await unmount();
});

test("an empty result explains itself and offers a way out", async () => {
  stubFetch(() => json({ items: [], nextCursor: null }));
  const { container, unmount } = await render(
    React.createElement(ClipsBrowser, baseProps({ initialItems: [], initialCount: 0 })),
  );

  const empty = container.querySelector("[data-testid='clips-empty']");
  assert.ok(empty);
  assert.match(empty.textContent ?? "", /No clips yet/);
  assert.ok(empty.querySelector("a[href='/search']"));
  assert.equal(cards(container).length, 0);

  await unmount();
});

test("a failed filter change keeps the filters and retries the same request", async () => {
  stubFetch(() => json({ error: "unavailable" }, 503));
  const { container, unmount } = await render(React.createElement(ClipsBrowser, baseProps()));

  const views = Array.from(container.querySelectorAll("[role='tab']")).find((tab) =>
    /Most viewed/i.test(tab.textContent ?? ""),
  );
  await click(views ?? null);
  await flush();

  const error = container.querySelector("[data-testid='clips-error']");
  assert.ok(error);
  assert.equal(error.getAttribute("role"), "alert");
  // The sort control still shows the choice the reader made.
  const selected = Array.from(container.querySelectorAll("[role='tab']")).find(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  assert.match(selected?.textContent ?? "", /Most viewed/);

  // Retry hits the same URL again rather than reloading to the defaults.
  stubFetch(() => json({ items: [item()], nextCursor: null }));
  const retry = Array.from(container.querySelectorAll("button")).find((button) =>
    /Try again/i.test(button.textContent ?? ""),
  );
  await click(retry ?? null);
  await flush();
  assert.match(calls[0].url, /sort=views/);
  assert.equal(container.querySelector("[data-testid='clips-error']"), null);

  await unmount();
});

test("searching waits for 300ms and needs two characters", async () => {
  stubFetch(() => json({ items: [item()], nextCursor: null }));
  const { container, unmount } = await render(React.createElement(ClipsBrowser, baseProps()));

  const input = container.querySelector("#clips-search") as HTMLInputElement | null;
  assert.ok(input);

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  const type = async (value: string) => {
    await React.act(async () => {
      setValue?.call(input, value);
      input?.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  };

  // One character is not a search: nothing is requested.
  await type("n");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(calls.length, 0);

  await type("naruto");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /q=naruto/);

  // Submitting the form searches immediately, without waiting.
  await type("bleach");
  const form = container.querySelector("form[role='search']") as HTMLFormElement | null;
  await submit(form);
  assert.match(calls[1].url, /q=bleach/);

  await unmount();
});

test("the clear button restores the unfiltered list", async () => {
  stubFetch(() => json({ items: [item()], nextCursor: null }));
  const { container, unmount } = await render(
    React.createElement(ClipsBrowser, baseProps({ initialQuery: { sort: "latest", q: "naruto", anime: null } })),
  );

  const clear = container.querySelector("button[aria-label='Clear the search']");
  assert.ok(clear);
  await click(clear);
  await flush();

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, /q=/);
  await unmount();
});

test("an adult clip is a placeholder with no title, no link and no thumbnail when the setting is off", async () => {
  stubFetch(() => json({ items: [], nextCursor: null }));
  const { container, unmount } = await render(
    React.createElement(
      ClipsBrowser,
      baseProps({
        initialItems: [
          item({
            code: "adult01",
            adult: true,
            animeTitle: null,
            episode: null,
            start: null,
            end: null,
            durationSec: null,
            thumb: null,
            authorName: null,
          }),
        ],
        initialCount: 1,
      }),
    ),
  );

  const card = cards(container)[0];
  assert.equal(card.getAttribute("data-adult"), "placeholder");
  assert.match(card.textContent ?? "", /Adult content 18\+/);
  assert.equal(card.querySelector("a[href^='/clip/']"), null);
  assert.ok(card.querySelector("a[href='/settings']"));
  // Nothing adult leaks into the DOM, not even an image URL.
  assert.equal(card.querySelector("img"), null);

  await unmount();
});

test("with the adult setting on, the same row opens the clip page", async () => {
  stubFetch(() => json({ items: [], nextCursor: null }));
  const { container, unmount } = await render(
    React.createElement(
      ClipsBrowser,
      baseProps({
        showAdult: true,
        initialItems: [
          item({ code: "adult01", adult: true, animeTitle: null, episode: null, start: null, end: null, thumb: null }),
        ],
        initialCount: 1,
      }),
    ),
  );

  const card = cards(container)[0];
  assert.equal(card.getAttribute("data-adult"), "true");
  assert.match(card.textContent ?? "", /Adult clip/);
  assert.equal(card.querySelector("a[href^='/clip/adult01']")?.getAttribute("href"), "/clip/adult01");

  await unmount();
});

test("a card carries the filters forward, so Back restores them", async () => {
  stubFetch(() => json({ items: [], nextCursor: null }));
  const { container, unmount } = await render(
    React.createElement(
      ClipsBrowser,
      baseProps({ initialQuery: { sort: "views", q: "naruto", anime: null }, initialNextCursor: null }),
    ),
  );

  const link = cards(container)[0].querySelector("a[href^='/clip/']");
  const href = decodeURIComponent(link?.getAttribute("href") ?? "");
  assert.match(href, /^\/clip\/k7m2p9q\?from=\?sort=views&q=naruto$/);

  await unmount();
});
