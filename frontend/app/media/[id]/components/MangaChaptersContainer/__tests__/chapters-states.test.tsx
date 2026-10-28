import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { flush, render } from "../../../../../../test-harness/render";
import MangaChaptersContainer from "..";

const userInfoReducer = (state: unknown = { value: null }) => state;
const loginModalReducer = (state: unknown = { value: false }) => state;
const store = configureStore({
  reducer: { UserInfo: userInfoReducer, ShowLoginModal: loginModalReducer },
});

const mediaInfo = {
  id: 21,
  title: { romaji: "Sousou no Frieren", userPreferred: "Frieren" },
  format: "MANGA",
  type: "MANGA",
  coverImage: { large: "l.jpg", extraLarge: "xl.jpg" },
} as never;

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
let respond: () => Promise<Response>;

const chaptersReady = {
  status: "ready",
  chapters: [
    { id: "c-1", chapterNumber: "1", volumeNumber: "1", title: "1", pages: 40 },
    { id: "c-2", chapterNumber: "2", volumeNumber: "1", title: "A walk", pages: 18 },
  ],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test.beforeEach(() => {
  console.error = () => {};
  respond = async () => json(chaptersReady);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost:3000");
    assert.match(url.pathname, /^\/api\/manga\/21\/chapters$/, "only our own route is called");
    return respond();
  }) as typeof fetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

function ui() {
  return (
    <Provider store={store}>
      <MangaChaptersContainer mediaInfo={mediaInfo} />
    </Provider>
  );
}

test("ready: lists the chapters with links into the reader", async () => {
  const tree = await render(ui());
  await flush();

  try {
    const text = tree.container.textContent ?? "";
    assert.match(text, /Chapter 1/);
    assert.match(text, /Chapter 2: A walk/);

    const hrefs = Array.from(tree.container.querySelectorAll("a")).map(
      (anchor) => anchor.getAttribute("href") ?? "",
    );
    assert.ok(hrefs.includes("/read/21?source=mangadex&chapter=1&q=c-1"));
    assert.ok(hrefs.includes("/read/21?source=mangadex&chapter=2&q=c-2"));
  } finally {
    await tree.unmount();
  }
});

test("loading: skeletons show while the chapters request is in flight", async () => {
  respond = () => new Promise<Response>(() => {});
  const tree = await render(ui());
  await flush();

  try {
    const list = tree.container.querySelector("ol");
    assert.equal(list?.getAttribute("data-loading"), "true");
    assert.match(tree.container.textContent ?? "", /^$|^\s*$/);
  } finally {
    await tree.unmount();
  }
});

test("unavailable: explains that the title may be licensed or not on MangaDex", async () => {
  respond = async () => json({ status: "unavailable", chapters: [] });
  const tree = await render(ui());
  await flush();

  try {
    assert.match(
      tree.container.textContent ?? "",
      /No chapters available for this title \(it may be licensed or not on MangaDex\)\./,
    );
  } finally {
    await tree.unmount();
  }
});

test("error: offers a retry instead of failing silently", async () => {
  respond = async () => json({ status: "error", chapters: [] });
  const tree = await render(ui());
  await flush();

  try {
    const text = tree.container.textContent ?? "";
    assert.match(text, /Chapters could not be loaded right now/);

    const retry = Array.from(tree.container.querySelectorAll("button")).find((button) =>
      /try again/i.test(button.textContent ?? ""),
    );
    assert.ok(retry, "a retry button is rendered");
  } finally {
    await tree.unmount();
  }
});
