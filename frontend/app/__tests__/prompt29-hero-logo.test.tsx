// Prompt 29, part C: the home hero shows the stored TMDB wordmark instead of the
// plain text title when one exists.
//
// The logo is decoration on top of the same heading: the link still points at
// /media/{id}, the real title still lives in the DOM (visually hidden, never
// display: none) so the heading, the link text, SEO and screen readers are
// unchanged, and a title without a logo renders exactly as it did before.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, flush } from "../../test-harness/render";
import HeroCarousel from "@/app/components/HomePage/HeroCarouselHomePage";
import UserInfo from "@/app/lib/redux/features/manageUserData";
import ShowLoginModal from "@/app/lib/redux/features/loginModal";
import { displayTitle } from "@/app/lib/titles";

/** The hero's favourite button reads the redux store, so each render needs one. */
function store() {
  return configureStore({
    reducer: { UserInfo, ShowLoginModal },
  });
}

// What the hero shows: the same helper the component uses.
const EXPECTED = displayTitle({
  romaji: "Black Clover",
  english: "Black Clover",
  userPreferred: "Black Clover Season 2",
});

const TITLE = {
  romaji: "Black Clover",
  english: "Black Clover",
  userPreferred: "Black Clover Season 2",
};

function anime(id: number) {
  return {
    id,
    title: TITLE,
    format: "TV",
    type: "ANIME",
    status: "RELEASING",
    description: "Magic knights.",
    coverImage: {
      extraLarge: "https://img.example/cover.jpg",
      large: "https://img.example/cover-large.jpg",
    },
    bannerImage: "https://img.example/banner.jpg",
    genres: ["Action"],
    seasonYear: 2017,
    episodes: 170,
    duration: 24,
    nextAiringEpisode: null,
    trailer: null,
    mediaListEntry: null,
    relations: { edges: [] },
    externalLinks: [],
    streamingEpisodes: [],
  } as never;
}

function hero(props: { titleLogos?: Record<number, { url: string; aspectRatio: number; width: number }> }) {
  return (
    <Provider store={store()}>
      <HeroCarousel animesList={[anime(101039)]} isOnMobileScreen={false} {...props} />
    </Provider>
  );
}

test("the hero renders the logo and keeps the text title in the DOM", async () => {
  const tree = await render(
    hero({
      titleLogos: {
        101039: {
          url: "https://image.tmdb.org/t/p/w500/abc123.png",
          aspectRatio: 3.2,
          width: 1600,
        },
      },
    }),
  );
  await flush();

  try {
    const heading = tree.container.querySelector("h2");
    const link = heading?.querySelector("a");
    const logo = heading?.querySelector("img");

    assert.ok(heading, "the heading is still an h2");
    assert.equal(link?.getAttribute("href"), "/media/101039", "the link is unchanged");
    assert.ok(logo, "the wordmark renders");
    assert.match(
      logo?.getAttribute("src") ?? "",
      /image\.tmdb\.org\/t\/p\/w500\/abc123\.png/,
    );
    assert.equal(logo?.getAttribute("alt"), EXPECTED, "alt carries the title");

    assert.equal(
      heading?.textContent,
      EXPECTED,
      "the real title is still the heading text",
    );

    const hidden = heading?.querySelector("span");
    assert.ok(hidden, "the title text sits in a hidden span, not display: none");
    assert.equal(hidden?.hasAttribute("hidden"), false);
    assert.equal(hidden?.style.display, "", "never display: none");
  } finally {
    await tree.unmount();
  }
});

test("without a logo the plain text title renders exactly as before", async () => {
  const tree = await render(hero({}));
  await flush();

  try {
    const heading = tree.container.querySelector("h2");

    assert.equal(heading?.querySelector("img"), null, "no artwork");
    assert.equal(heading?.textContent, EXPECTED);
    assert.equal(
      heading?.querySelector("a")?.getAttribute("href"),
      "/media/101039",
    );
  } finally {
    await tree.unmount();
  }
});

test("a logo for another id is not used", async () => {
  const tree = await render(
    hero({
      titleLogos: {
        999: { url: "https://image.tmdb.org/t/p/w500/other.png", aspectRatio: 3, width: 900 },
      },
    }),
  );
  await flush();

  try {
    const heading = tree.container.querySelector("h2");

    assert.equal(heading?.querySelector("img"), null);
    assert.equal(heading?.textContent, EXPECTED);
  } finally {
    await tree.unmount();
  }
});
