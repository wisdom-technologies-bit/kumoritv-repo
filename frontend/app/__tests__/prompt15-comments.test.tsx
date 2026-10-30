// Prompt 15, part 2: the ani.pm-style comments UI.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render, flush } from "../../test-harness/render";
import Dropdown from "@/app/components/CommentsSection/components/Dropdown";
import CommentContainer from "@/app/components/CommentsSection/components/CommentContainer";
import { episodeFilterOptions } from "@/app/components/CommentsSection";
import {
  SORT_OPTIONS,
  countReplies,
  listComments,
  listCommentedEpisodes,
} from "@/app/lib/comments/queries";
import { formatTimeAgo } from "@/app/lib/comments/timeAgo";
import type { CommentFeedRow } from "@/app/lib/comments/queries";

/** A chainable stand-in for the Supabase query builder that records calls. */
function fakeClient(rows: unknown[] = [], count = rows.length) {
  const calls: unknown[][] = [];

  const builder: any = {
    select(columns?: string, options?: unknown) {
      calls.push(["select", columns, options]);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.push(["eq", column, value]);
      return builder;
    },
    is(column: string, value: unknown) {
      calls.push(["is", column, value]);
      return builder;
    },
    in(column: string, values: unknown) {
      calls.push(["in", column, values]);
      return builder;
    },
    not(column: string, operator: string, value: unknown) {
      calls.push(["not", column, operator, value]);
      return builder;
    },
    order(column: string, options?: unknown) {
      calls.push(["order", column, options]);
      return builder;
    },
    range(from: number, to: number) {
      calls.push(["range", from, to]);
      return Promise.resolve({ data: rows, error: null, count });
    },
    limit(value: number) {
      calls.push(["limit", value]);
      return builder;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null, count }).then(resolve, reject);
    },
  };

  return {
    calls,
    client: {
      from(table: string) {
        calls.push(["from", table]);
        return builder;
      },
    } as any,
  };
}

function comment(overrides: Partial<CommentFeedRow> = {}): CommentFeedRow {
  return {
    id: "c1",
    anilist_id: 21,
    episode_number: 3,
    parent_id: null,
    user_id: "u1",
    body: "Great episode",
    is_spoiler: false,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    username: "ren",
    display_name: "Ren",
    avatar_url: null,
    likes: 2,
    dislikes: 0,
    ...overrides,
  };
}

// ------------------------------------------------------------------ queries

test("filtering by episode adds the episode_number predicate, All does not", async () => {
  const filtered = fakeClient([]);
  await listComments(filtered.client, { anilistId: 21, episodeNumber: 4, sort: "likes", limit: 20 });
  assert.deepEqual(
    filtered.calls.filter((call) => call[0] === "eq"),
    [["eq", "anilist_id", 21], ["eq", "episode_number", 4]],
  );

  const all = fakeClient([]);
  await listComments(all.client, { anilistId: 21, episodeNumber: null, sort: "likes", limit: 20 });
  assert.equal(
    all.calls.filter((call) => call[0] === "eq" && call[1] === "episode_number").length,
    0,
    "All episodes sends no episode filter",
  );
});

test("each sort option maps to its own query", async () => {
  assert.deepEqual(
    SORT_OPTIONS.map((option) => option.label),
    ["Top comments", "Newest", "Oldest", "Most disliked"],
  );

  const expected: Record<string, unknown[]> = {
    likes: [["order", "likes", { ascending: false }], ["order", "created_at", { ascending: false }]],
    recent: [["order", "created_at", { ascending: false }]],
    oldest: [["order", "created_at", { ascending: true }]],
    dislikes: [["order", "dislikes", { ascending: false }], ["order", "created_at", { ascending: false }]],
  };

  for (const [sort, orders] of Object.entries(expected)) {
    const fake = fakeClient([]);
    await listComments(fake.client, { anilistId: 21, sort: sort as any, limit: 20 });
    assert.deepEqual(
      fake.calls.filter((call) => call[0] === "order"),
      orders,
      `sort ${sort}`,
    );
  }
});

test("a page of 20 asks for the right range", async () => {
  const fake = fakeClient([]);
  await listComments(fake.client, { anilistId: 21, sort: "likes", limit: 20 });
  assert.deepEqual(fake.calls.find((call) => call[0] === "range"), ["range", 0, 19]);
});

test("reply counts and commented episodes come from the view, without loading rows", async () => {
  const counts = fakeClient([
    { parent_id: "c1" },
    { parent_id: "c1" },
    { parent_id: "c2" },
    { parent_id: null },
  ]);
  const counted = await countReplies(counts.client, ["c1", "c2"]);
  assert.deepEqual(counted.data, { c1: 2, c2: 1 });

  const episodes = fakeClient([
    { episode_number: 5 },
    { episode_number: 2 },
    { episode_number: 5 },
    { episode_number: null },
  ]);
  const listed = await listCommentedEpisodes(episodes.client, { anilistId: 21 });
  assert.deepEqual(listed.data, [2, 5]);
});

test("the episode menu lists All first, then the current episode, then the rest", () => {
  const options = episodeFilterOptions([5, 2, 9], 9);
  assert.deepEqual(options, [
    { value: "all", label: "All episodes" },
    { value: "9", label: "Episode 9" },
    { value: "2", label: "Episode 2" },
    { value: "5", label: "Episode 5" },
  ]);

  assert.equal(episodeFilterOptions([], null)[0].value, "all");
});

test("time-ago reads naturally", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(formatTimeAgo("2026-10-30T11:59:40Z", now), "just now");
  assert.equal(formatTimeAgo("2026-10-30T11:00:00Z", now), "1 hour ago");
  assert.equal(formatTimeAgo("2026-10-23T12:00:00Z", now), "1 week ago");
  assert.equal(formatTimeAgo("2026-10-16T12:00:00Z", now), "2 weeks ago");
});

// ----------------------------------------------------------------- dropdown

test("the dropdown opens with the keyboard, moves and selects, and closes on Escape", async () => {
  const changes: string[] = [];
  const tree = await render(
    React.createElement(Dropdown, {
      ariaLabel: "Sort comments",
      value: "likes",
      options: [
        { value: "likes", label: "Top comments" },
        { value: "recent", label: "Newest" },
      ],
      onChange: (value: string) => changes.push(value),
    }),
  );

  try {
    const button = tree.container.querySelector("button") as HTMLButtonElement;
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    assert.equal(button.getAttribute("aria-expanded"), "true");
    const listbox = tree.container.querySelector('[role="listbox"]');
    assert.ok(listbox, "a listbox appears");

    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flush();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    assert.deepEqual(changes, ["recent"], "Enter picks the highlighted option");

    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    assert.equal(button.getAttribute("aria-expanded"), "false");
  } finally {
    await tree.unmount();
  }
});

test("clicking outside closes the dropdown", async () => {
  const tree = await render(
    React.createElement(Dropdown, {
      ariaLabel: "Filter comments by episode",
      value: "all",
      options: [{ value: "all", label: "All episodes" }],
      onChange: () => {},
    }),
  );

  try {
    const button = tree.container.querySelector("button") as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    assert.equal(button.getAttribute("aria-expanded"), "true");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    assert.equal(button.getAttribute("aria-expanded"), "false");
  } finally {
    await tree.unmount();
  }
});

// --------------------------------------------------------- comment container

function renderComment(overrides: Record<string, unknown> = {}) {
  return render(
    React.createElement(
      "ul",
      null,
      React.createElement(CommentContainer, {
        comment: comment(),
        isSignedIn: true,
        myReaction: null,
        canDelete: false,
        onGuestAttempt: () => {},
        onReact: () => {},
        onDelete: () => {},
        onSubmitReply: async () => ({ error: null }),
        ...overrides,
      } as any),
    ),
  );
}

test("a spoiler comment hides its body until it is revealed", async () => {
  const revealed = new Set<string>();
  const toggle = (id: string) => revealed.add(id);
  const spoiler = comment({ is_spoiler: true, body: "Someone dies" });

  const first = await renderComment({
    comment: spoiler,
    isSpoilerRevealed: revealed.has(spoiler.id),
    onToggleSpoiler: toggle,
  });

  try {
    const text = first.container.textContent ?? "";
    assert.match(text, /Spoiler — tap to reveal/);
    assert.ok(!text.includes("Someone dies"), "the body is not rendered while hidden");

    const reveal = first.container.querySelector(".spoiler_bar, button[aria-label='Reveal spoiler']") as HTMLButtonElement;
    reveal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    assert.deepEqual([...revealed], [spoiler.id]);
  } finally {
    await first.unmount();
  }

  const second = await renderComment({
    comment: spoiler,
    isSpoilerRevealed: true,
    onToggleSpoiler: toggle,
  });

  try {
    assert.match(second.container.textContent ?? "", /Someone dies/);
  } finally {
    await second.unmount();
  }
});

test("a comment shows @username, time ago, the EP pill and the reaction counts", async () => {
  const tree = await renderComment({ comment: comment({ likes: 4, dislikes: 1 }) });

  try {
    const text = tree.container.textContent ?? "";
    assert.match(text, /@ren/);
    assert.match(text, /minute ago/);
    assert.match(text, /EP 3/);
    assert.match(text, /Great episode/);
    assert.match(text, /4/);
    assert.match(text, /1/);

    const like = tree.container.querySelector("button[aria-label='Like this comment']");
    assert.ok(like, "the like button is labelled");
  } finally {
    await tree.unmount();
  }
});

test("a reaction the user already made is highlighted and can be toggled off", async () => {
  const reactions: number[] = [];
  const tree = await renderComment({
    myReaction: 1,
    onReact: (_row: CommentFeedRow, value: 1 | -1) => reactions.push(value),
  });

  try {
    const pressed = tree.container.querySelector("button[aria-pressed='true']");
    assert.ok(pressed, "the active reaction is marked pressed");
    assert.match(pressed!.getAttribute("aria-label") ?? "", /Remove like/);

    (pressed as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    assert.deepEqual(reactions, [1], "tapping again sends the same value, which the section reads as a removal");
  } finally {
    await tree.unmount();
  }
});

test("a guest tapping Reply is sent to sign in instead of opening the composer", async () => {
  let prompts = 0;
  const tree = await renderComment({
    isSignedIn: false,
    onGuestAttempt: () => {
      prompts += 1;
    },
  });

  try {
    const reply = [...tree.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reply",
    ) as HTMLButtonElement;
    reply.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    assert.equal(prompts, 1);
    assert.equal(tree.container.querySelector("textarea"), null, "no composer for a guest");
  } finally {
    await tree.unmount();
  }
});

test("replies stay collapsed behind a count and load once on demand", async () => {
  const toggles: string[] = [];
  const collapsed = await renderComment({
    replyCount: 3,
    onToggleReplies: (id: string) => toggles.push(id),
  });

  try {
    const toggle = [...collapsed.container.querySelectorAll("button")].find((button) =>
      /replies/.test(button.textContent ?? ""),
    ) as HTMLButtonElement;
    assert.ok(toggle, "the replies toggle is there");
    assert.match(toggle.textContent ?? "", /3 replies/);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    assert.deepEqual(toggles, ["c1"], "expanding asks the section for the rows");
  } finally {
    await collapsed.unmount();
  }

  const open = await renderComment({
    replyCount: 1,
    isRepliesOpen: true,
    onToggleReplies: () => {},
    children: React.createElement(
      "ul",
      null,
      React.createElement(CommentContainer, {
        comment: comment({ id: "r1", parent_id: "c1", username: "gojo" }),
        isReply: true,
        isSignedIn: true,
        myReaction: null,
        canDelete: false,
        onGuestAttempt: () => {},
        onReact: () => {},
        onDelete: () => {},
        onSubmitReply: async () => ({ error: null }),
      } as any),
    ),
  });

  try {
    const text = open.container.textContent ?? "";
    assert.match(text, /Hide replies/);
    assert.match(text, /@gojo/);
  } finally {
    await open.unmount();
  }
});
