// Prompt 38E: what the feed card says, and what it points at.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render } from "../../../../../test-harness/render";
import CommentCard from "..";
import type { FeedItem } from "@/app/lib/community/queries";

const COMMENT = "30000000-0000-0000-0000-000000000001";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    feed_key: `comment:${COMMENT}`,
    kind: "comment",
    created_at: "2026-11-13T10:00:00.000Z",
    author_id: "user-1",
    author_username: "mika",
    author_display_name: "Mika",
    author_avatar: null,
    body: "That last shot was incredible.",
    is_spoiler: false,
    title: null,
    image_url: null,
    link_url: null,
    clip_code: null,
    clip_start: null,
    clip_end: null,
    anime_id: 21,
    anime_title: "Frieren: Beyond Journey's End",
    anime_cover: null,
    episode_number: 12,
    target_url: `/watch/21?ep=12#comment-${COMMENT}`,
    reply_count: 0,
    likes: 4,
    dislikes: 1,
    is_adult: false,
    ...overrides,
  };
}

test("the whole card links to the comment's own deep link", async () => {
  const { container, unmount } = await render(<CommentCard item={item()} />);
  const link = container.querySelector('a[data-community-card="comment"]');
  assert.ok(link, "the card is a link");
  assert.equal(link?.getAttribute("href"), `/watch/21?ep=12#comment-${COMMENT}`);
  await unmount();
});

test("where it was made: anime, episode chip, author", async () => {
  const { container, unmount } = await render(<CommentCard item={item()} />);
  const text = container.textContent ?? "";
  assert.ok(text.includes("Frieren"), "prints the anime title");
  assert.ok(text.includes("Episode 12"), "prints the episode chip");
  assert.ok(text.includes("Mika"), "prints the author");
  assert.ok(text.includes("That last shot was incredible."), "prints the body");
  await unmount();
});

test("an anime-page comment says Anime page, and a missing author is neutral", async () => {
  const { container, unmount } = await render(
    <CommentCard item={item({ episode_number: null, author_display_name: null, author_username: null })} />,
  );
  const text = container.textContent ?? "";
  assert.ok(text.includes("Anime page"));
  assert.ok(text.includes("KumoriTV member"));
  await unmount();
});

test("reply count: plural, singular, and Reply when there are none", async () => {
  const many = await render(<CommentCard item={item({ reply_count: 12 })} />);
  assert.ok((many.container.textContent ?? "").includes("12 replies"));
  await many.unmount();

  const one = await render(<CommentCard item={item({ reply_count: 1 })} />);
  assert.ok((one.container.textContent ?? "").includes("1 reply"));
  assert.ok(!(one.container.textContent ?? "").includes("1 replies"));
  await one.unmount();

  const none = await render(<CommentCard item={item({ reply_count: 0 })} />);
  assert.ok((none.container.textContent ?? "").includes("Reply"));
  await none.unmount();
});

test("counts are shown, not offered: no reaction buttons in a feed card", async () => {
  const { container, unmount } = await render(<CommentCard item={item()} />);
  assert.equal(container.querySelectorAll("button").length, 0, "nothing to react to here");
  assert.ok((container.textContent ?? "").includes("4"));
  assert.ok((container.textContent ?? "").includes("1"));
  await unmount();
});

test("a spoiler body is hidden until the reader reveals it", async () => {
  const { container, unmount } = await render(
    <CommentCard item={item({ is_spoiler: true, body: "The twist is that she was alive." })} />,
  );
  const hidden = container.querySelector('[data-revealed="false"]');
  assert.ok(hidden, "the blur is rendered");
  assert.ok((container.textContent ?? "").includes("Spoiler"));

  const reveal = container.querySelector("button");
  assert.ok(reveal, "there is a reveal control");
  reveal?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok((container.textContent ?? "").includes("The twist is that she was alive."));
  await unmount();
});

test("the 18+ chip appears only on a row the server marked adult", async () => {
  const clean = await render(<CommentCard item={item({ is_adult: false })} />);
  assert.ok(!(clean.container.textContent ?? "").includes("18+"));
  await clean.unmount();

  const adult = await render(<CommentCard item={item({ is_adult: true })} />);
  assert.ok((adult.container.textContent ?? "").includes("18+"));
  await adult.unmount();
});
