// The media heading: the title text stays in the document as a real <h1> even
// when a TMDB logo is shown in its place, and a broken logo falls back to the
// text title.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { flush, render } from "../../test-harness/render";
import HeadingTextAndMediaLogo from "@/app/media/[id]/components/PageHeading/HeadingInfo/MediaTitleOrLogo";

const TITLE = {
  english: "Frieren: Beyond Journey's End",
  romaji: "Sousou no Frieren",
  native: "葬送のフリーレン",
  userPreferred: "Sousou no Frieren",
};

const ENGLISH = TITLE.english;
const NATIVE = TITLE.native;

const LOGO = {
  url: "https://image.tmdb.org/t/p/w500/frieren-logo.png",
  aspectRatio: 3,
  width: 1000,
};

const mounted: Array<{ unmount: () => Promise<void> }> = [];

async function mount(ui: React.ReactElement) {
  const tree = await render(ui);
  mounted.push(tree);

  return tree;
}

test.afterEach(async () => {
  while (mounted.length) await mounted.pop()!.unmount();
});

test("with a logo the h1 keeps the title for SEO but is visually hidden", async () => {
  const tree = await mount(<HeadingTextAndMediaLogo mediaTitles={TITLE} titleLogo={LOGO} />);
  const heading = tree.container.querySelector("h1");

  assert.ok(heading, "the heading is still an h1");
  assert.equal(heading!.textContent, ENGLISH, "the real title stays in the DOM");
  assert.equal(heading!.className, "sr_only", "clipped, not display:none");

  const logo = tree.container.querySelector("img");

  assert.ok(logo, "the logo image renders");
  assert.equal(logo!.getAttribute("alt"), ENGLISH, "the logo carries the title as alt text");
  assert.equal(logo!.getAttribute("src"), LOGO.url);

  assert.equal(tree.container.querySelector("small")?.textContent, NATIVE, "the native line stays");

  await tree.unmount();
});

test("without a logo the heading is plain visible text", async () => {
  const tree = await mount(<HeadingTextAndMediaLogo mediaTitles={TITLE} />);
  const heading = tree.container.querySelector("h1");

  assert.equal(heading!.textContent, ENGLISH);
  assert.notEqual(heading!.className, "sr_only");
  assert.equal(tree.container.querySelector("img"), null);

  await tree.unmount();
});

test("a logo that fails to load puts the text title back", async () => {
  const tree = await mount(<HeadingTextAndMediaLogo mediaTitles={TITLE} titleLogo={LOGO} />);
  const logo = tree.container.querySelector("img")!;

  logo.dispatchEvent(new Event("error"));
  await flush();

  const heading = tree.container.querySelector("h1");

  assert.equal(heading!.textContent, ENGLISH);
  assert.notEqual(heading!.className, "sr_only", "the text title becomes visible again");
  assert.equal(tree.container.querySelector("img"), null);

  await tree.unmount();
});

test("the legacy imdbMediaLogos prop still renders a logo", async () => {
  const tree = await mount(
    <HeadingTextAndMediaLogo
      mediaTitles={TITLE}
      imdbMediaLogos={[{ url: "https://example.test/logo.png", aspectRatio: 2 }] as never}
    />,
  );

  assert.equal(tree.container.querySelector("h1")?.textContent, ENGLISH);
  assert.equal(tree.container.querySelector("img")?.getAttribute("alt"), ENGLISH);

  await tree.unmount();
});

test("the native line is hidden when it would repeat the heading", async () => {
  const tree = await mount(<HeadingTextAndMediaLogo mediaTitles={{ romaji: TITLE.romaji } as never} />);

  assert.equal(tree.container.querySelector("h1")?.textContent, TITLE.romaji);
  assert.equal(tree.container.querySelector("small"), null);

  await tree.unmount();
});
