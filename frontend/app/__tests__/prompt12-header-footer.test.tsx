import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { render } from "../../test-harness/render";
import Header from "@/app/layout/header";
import NavLinks from "@/app/layout/footer/components/navLinks";

const originalFetch = globalThis.fetch;

// The real store module would drag in a circular import chain (store <->
// anilistUserLoginOptions) that only works inside Next's bundler, so the header
// test builds the two slices it reads.
const userInfoReducer = (state: unknown = { value: null }) => state;
const loginModalReducer = (state: unknown = { value: false }) => state;

function makeStore() {
  return configureStore({
    reducer: { UserInfo: userInfoReducer, ShowLoginModal: loginModalReducer },
  });
}

test.beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("header keeps the logo, both desktop nav items, search, notifications and user", async () => {
  const store = makeStore();
  const tree = await render(
    <Provider store={store}>
      <Header />
    </Provider>,
  );

  try {
    const text = tree.container.textContent ?? "";
    assert.match(text, /Animes/);
    assert.match(text, /Mangas/);

    assert.ok(tree.container.querySelector('a[href="/"]'), "the logo still links home");
    assert.ok(
      tree.container.querySelector('input[type="search"], input[type="text"]'),
      "the search box is still there",
    );
    assert.ok(tree.container.querySelector('nav[aria-label="Main navigation"]'));
  } finally {
    await tree.unmount();
  }
});

test("header has no menu button and no sidebar trigger", async () => {
  const store = makeStore();
  const tree = await render(
    <Provider store={store}>
      <Header />
    </Provider>,
  );

  try {
    const buttons = Array.from(tree.container.querySelectorAll("button"));
    // The user button is labelled "Click to Show User Menu": only a *sidebar*
    // trigger counts as the removed menu button.
    const menuButtons = buttons.filter((button) =>
      /sidebar|open menu|main menu|menu list/i.test(
        `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`,
      ),
    );

    assert.deepEqual(menuButtons.map((button) => button.outerHTML.slice(0, 60)), []);

    const menuIcons = Array.from(tree.container.querySelectorAll("svg")).filter((icon) =>
      /menu/i.test(`${icon.getAttribute("alt") ?? ""} ${icon.getAttribute("aria-label") ?? ""}`),
    );

    assert.equal(menuIcons.length, 0, "no hamburger icon is rendered");
    assert.equal(tree.container.querySelector('[data-menu-list="true"]'), null);
    // The menu icon was an <svg> inside a button in the old header; no burger here.
    assert.equal(tree.container.querySelector("#menu_button_container"), null);
  } finally {
    await tree.unmount();
  }
});

test("footer Explore links to Home, Search Anime and Search Manga only", async () => {
  const tree = await render(<NavLinks />);

  try {
    const hrefs = Array.from(tree.container.querySelectorAll("a")).map((anchor) =>
      anchor.getAttribute("href"),
    );

    assert.ok(!hrefs.includes("/airing-schedule"), "/airing-schedule is a 404");
    assert.ok(!hrefs.includes("/genres"), "/genres is a 404");
    assert.ok(hrefs.includes("/"));
    assert.ok(hrefs.includes("/search?type=tv"));
    assert.ok(hrefs.includes("/search?type=manga"));

    const text = tree.container.textContent ?? "";
    assert.match(text, /Search Anime/);
    assert.match(text, /Search Manga/);
    // Categories and Airing This Week stay
    assert.match(text, /Categories/);
  } finally {
    await tree.unmount();
  }
});
