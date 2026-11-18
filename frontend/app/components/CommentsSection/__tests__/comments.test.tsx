import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { Provider } from "react-redux";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import { click, flush, makeTestStore, render, submit, text, typeInto } from "../../../../test-harness/render";
import CommentsSection from "..";

const MEDIA = { id: 21, title: { romaji: "One Piece" }, format: "TV" } as never;

type Globals = {
  __commentsTestClient?: unknown;
  __commentsTestAuth?: unknown;
};

const globals = globalThis as unknown as Globals;

function setSession(user: { id: string } | null) {
  globals.__commentsTestAuth = user
    ? {
      user,
      profile: { id: user.id, username: "kumori", display_name: "Kumori TV", avatar_url: null },
      isAnonymous: false,
      loading: false,
      signOut: async () => {},
    }
    : { user: null, profile: null, isAnonymous: false, loading: false, signOut: async () => {} };
}

function feedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "comment-1",
    anilist_id: 21,
    episode_number: null,
    parent_id: null,
    user_id: "user-1",
    body: "first comment",
    is_spoiler: false,
    created_at: "2026-10-01T10:00:00.000Z",
    username: "kumori",
    display_name: null,
    avatar_url: null,
    likes: 0,
    dislikes: 0,
    ...overrides,
  };
}

async function mountSection(options: {
  client: FakeSupabaseClient | null;
  user?: { id: string } | null;
  episodeNumber?: number;
  fail?: { status: number; message: string };
}) {
  const { store, actions } = makeTestStore();
  installApi();
  api.fail = options.fail ?? null;
  globals.__commentsTestClient = options.client;
  setSession(options.user === undefined ? { id: "user-1" } : options.user);

  const tree = await render(
    <Provider store={store}>
      <CommentsSection
        mediaInfo={MEDIA}
        isOnWatchPage={options.episodeNumber !== undefined}
        episodeNumber={options.episodeNumber}
      />
    </Provider>,
  );

  return { tree, store, actions };
}

const MODAL_ACTION = "ShowLoginModal/toggleShowLoginModalValue";

/**
 * Phase 6, part E: comment writes go through /api/comments, not the browser
 * client. This stub is the API: it records what was sent, answers 201 with the
 * row the server would return, and can be told to fail.
 */
type ApiCall = { method: string; url: string; body: Record<string, unknown> | null };
const api = {
  calls: [] as ApiCall[],
  fail: null as null | { status: number; message: string },
  /** What the server would have stored: the body is normalised server-side. */
  posts(): Record<string, unknown>[] {
    return this.calls
      .filter((call) => call.method === "POST")
      .map((call) => ({ ...(call.body ?? {}), body: String(call.body?.body ?? "").trim() }));
  },
  deletes(): string[] {
    return this.calls.filter((call) => call.method === "DELETE").map((call) => call.url.split("/").pop() ?? "");
  },
};

function installApi() {
  api.calls = [];
  api.fail = null;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    api.calls.push({ method, url, body });

    if (api.fail) {
      return new Response(JSON.stringify({ error: "rate_limited", message: api.fail.message }), {
        status: api.fail.status,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "POST") {
      return new Response(
        JSON.stringify({
          comment: {
            id: "new-comment",
            target_type: body?.targetKind ?? "anime",
            post_id: null,
            announcement_id: null,
            anilist_id: body?.anilistId ?? null,
            episode_number: body?.episodeNumber ?? null,
            parent_id: body?.parentId ?? null,
            user_id: "user-1",
            body: String(body?.body ?? "").trim(),
            is_spoiler: body?.isSpoiler === true,
            created_at: "2026-10-03T10:00:00.000Z",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as never;
}

/** The composer starts as one underlined line; it expands when it is used. */
async function openComposer(container: HTMLElement) {
  const collapsed = container.querySelector('[data-testid="composer-collapsed"]');
  if (collapsed) await click(collapsed);
}

test("guest: writing, replying and reacting all open the login modal", async () => {
  const client = new FakeSupabaseClient({ comment_feed: [feedRow()] });

  const { tree, store, actions } = await mountSection({ client, user: null });
  const { container } = tree;

  assert.equal(store.getState().ShowLoginModal.value, false);

  // Tapping the collapsed composer is the guest's way in.
  await openComposer(container);
  assert.equal(store.getState().ShowLoginModal.value, true);
  assert.equal(container.querySelector("textarea"), null);
  assert.equal(actions.filter((type) => type === MODAL_ACTION).length, 1);
  assert.equal(api.posts().length, 0);

  await click(container.querySelector('[data-testid="like-comment-1"]'));
  assert.equal(actions.filter((type) => type === MODAL_ACTION).length, 2);
  assert.equal(client.rows("comment_reactions").length, 0);

  await click(container.querySelector('[data-testid="reply-comment-1"]'));
  assert.equal(actions.filter((type) => type === MODAL_ACTION).length, 3);
  // no reply box is opened for a guest
  assert.equal(container.querySelectorAll("textarea").length, 0);

  await tree.unmount();
});

test("signed in: posting adds the comment to the list immediately", async () => {
  const client = new FakeSupabaseClient({ comment_feed: [feedRow()] });

  const { tree } = await mountSection({ client });
  const { container } = tree;

  assert.match(text(container), /1 Comment(?!s)/);

  await openComposer(container);
  await typeInto(container.querySelector("textarea"), "  a brand new take  ");
  await submit(container.querySelector("form"));

  assert.match(text(container), /a brand new take/);
  assert.match(text(container), /2 Comments/);

  const rows = api.posts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, "a brand new take");
  // Part E: the browser never sends user_id - the server stamps it from the session.
  assert.equal(rows[0].user_id, undefined);
  assert.equal(rows[0].episodeNumber, null);

  await tree.unmount();
});

test("signed in on the watch page: only this episode is listed and stored", async () => {
  const client = new FakeSupabaseClient({
    comment_feed: [
      feedRow({ id: "ep-two", body: "episode two talk", episode_number: 2 }),
      feedRow({ id: "other-ep", body: "episode one talk", episode_number: 1 }),
    ],
  });

  const { tree } = await mountSection({ client, episodeNumber: 2 });
  const { container } = tree;

  assert.match(text(container), /episode two talk/);
  assert.doesNotMatch(text(container), /episode one talk/);

  await openComposer(container);
  await typeInto(container.querySelector("textarea"), "episode thread");
  await submit(container.querySelector("form"));

  assert.equal(api.posts()[0].episodeNumber, 2);

  await tree.unmount();
});

test("signed in: like, switch to dislike, then remove the reaction", async () => {
  const client = new FakeSupabaseClient({ comment_feed: [feedRow()] });

  const { tree } = await mountSection({ client });
  const { container } = tree;

  assert.equal(container.querySelector('[data-testid="like-comment-1"]')!.getAttribute("aria-pressed"), "false");

  await click(container.querySelector('[data-testid="like-comment-1"]'));
  assert.equal(container.querySelector('[data-testid="like-comment-1"]')!.getAttribute("aria-pressed"), "true");
  assert.equal(client.rows("comment_reactions").length, 1);
  assert.equal(client.rows("comment_reactions")[0].value, 1);
  assert.match(container.querySelector('[data-testid="like-comment-1"]')!.textContent ?? "", /1/);

  await click(container.querySelector('[data-testid="dislike-comment-1"]'));
  assert.equal(client.rows("comment_reactions").length, 1);
  assert.equal(client.rows("comment_reactions")[0].value, -1);
  assert.equal(container.querySelector('[data-testid="like-comment-1"]')!.getAttribute("aria-pressed"), "false");
  assert.equal(container.querySelector('[data-testid="dislike-comment-1"]')!.getAttribute("aria-pressed"), "true");

  await click(container.querySelector('[data-testid="dislike-comment-1"]'));
  assert.equal(client.rows("comment_reactions").length, 0);
  assert.equal(container.querySelector('[data-testid="dislike-comment-1"]')!.getAttribute("aria-pressed"), "false");

  await tree.unmount();
});

test("signed in: only my own comment shows Delete, and it soft deletes", async () => {
  const client = new FakeSupabaseClient({
    comment_feed: [
      feedRow({ id: "mine", body: "my comment", user_id: "user-1" }),
      feedRow({ id: "theirs", body: "their comment", user_id: "user-2", created_at: "2026-10-02T10:00:00.000Z" }),
    ],
    comments: [
      { id: "mine", anilist_id: 21, user_id: "user-1", body: "my comment", parent_id: null, episode_number: null, is_spoiler: false, deleted_at: null, created_at: "", updated_at: "" },
      { id: "theirs", anilist_id: 21, user_id: "user-2", body: "their comment", parent_id: null, episode_number: null, is_spoiler: false, deleted_at: null, created_at: "", updated_at: "" },
    ],
  });

  const { tree } = await mountSection({ client });
  const { container } = tree;

  const deleteButtons = container.querySelectorAll('[data-testid^="delete-"]');
  assert.equal(deleteButtons.length, 1);
  assert.equal(deleteButtons[0].getAttribute("data-testid"), "delete-mine");

  await click(container.querySelector('[data-testid="delete-mine"]'));

  assert.doesNotMatch(text(container), /my comment/);
  assert.match(text(container), /their comment/);
  assert.deepEqual(api.deletes(), ["mine"], "only my own comment is deleted, through the API");

  await tree.unmount();
});

test("spoiler comments stay hidden until they are clicked", async () => {
  const client = new FakeSupabaseClient({
    comment_feed: [feedRow({ id: "spoiler", body: "the big reveal", is_spoiler: true })],
  });

  const { tree } = await mountSection({ client });
  const { container } = tree;

  const item = container.querySelector('[data-testid="comment-spoiler"]')!;
  assert.equal(item.getAttribute("data-has-spoiler"), "true");

  const reveal = container.querySelector('[data-testid="spoiler-spoiler"]');
  assert.ok(reveal, "expected the spoiler bar");
  assert.doesNotMatch(text(container), /the big reveal/);

  await click(reveal!);
  assert.match(text(container), /the big reveal/);
  assert.equal(container.querySelector('[data-testid="comment-spoiler"]')!.getAttribute("data-has-spoiler"), "false");

  await tree.unmount();
});

test("'commenting too fast' is shown under the form and the text is kept", async () => {
  const client = new FakeSupabaseClient({ comment_feed: [feedRow()] });
  const { tree } = await mountSection({
    client,
    fail: { status: 429, message: "You are commenting too fast. Please wait a few seconds." },
  });
  const { container } = tree;

  await openComposer(container);
  await typeInto(container.querySelector("textarea"), "too soon");
  await submit(container.querySelector("form"));

  const alert = container.querySelector('[role="alert"]');
  assert.ok(alert, "expected an error message under the form");
  assert.match(alert!.textContent ?? "", /You are commenting too fast/);
  assert.equal((container.querySelector("textarea") as HTMLTextAreaElement).value, "too soon");

  await tree.unmount();
});

test("a generic failure keeps the typed text and shows a short error", async () => {
  const client = new FakeSupabaseClient({ comment_feed: [feedRow()] });
  const { tree } = await mountSection({
    client,
    fail: { status: 500, message: "We could not save that comment. Please try again." },
  });
  const { container } = tree;

  await openComposer(container);
  await typeInto(container.querySelector("textarea"), "unsent words");
  await submit(container.querySelector("form"));

  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Could not send your comment/);
  assert.equal((container.querySelector("textarea") as HTMLTextAreaElement).value, "unsent words");
  // The attempt reached the API and was refused, so no comment was added.
  assert.equal(api.posts().length, 1);
  assert.equal(container.querySelectorAll('[data-testid^="comment-"]').length, 1);

  await tree.unmount();
});

test("comments are unavailable when the view cannot be read", async () => {
  const client = new FakeSupabaseClient({ comment_feed: [feedRow()] });
  client.failOn("comment_feed");

  const { tree } = await mountSection({ client });
  const { container } = tree;

  assert.match(text(container), /Comments are unavailable right now\./);

  await tree.unmount();
});

test("a missing Supabase client does not crash the page", async () => {
  const { tree } = await mountSection({ client: null });
  const { container } = tree;

  assert.match(text(container), /Comments are unavailable right now\./);

  await flush();
  await tree.unmount();
});

test("replies render nested under their top-level comment and attach to it", async () => {
  const client = new FakeSupabaseClient({
    comment_feed: [
      feedRow({ id: "parent", body: "parent comment" }),
      feedRow({
        id: "reply-1",
        parent_id: "parent",
        body: "a nested reply",
        user_id: "user-2",
        created_at: "2026-10-01T11:00:00.000Z",
      }),
    ],
  });

  const { tree } = await mountSection({ client });
  const { container } = tree;

  const parent = container.querySelector('[data-testid="comment-parent"]')!;
  assert.ok(parent, "expected the parent comment");

  // replies load only when the toggle is used
  await flush();
  await click(container.querySelector('[data-testid="replies-parent"]'));
  await flush();
  assert.ok(container.querySelector('[data-testid="comment-parent"]')!.textContent?.includes("a nested reply"));

  // replying to a reply still attaches to the top-level comment
  await click(container.querySelector('[data-testid="reply-reply-1"]'));
  const replyForm = container.querySelectorAll("form")[1];
  assert.ok(replyForm, "expected the reply form to open");
  await typeInto(replyForm.querySelector("textarea"), "reply to the reply");
  await submit(replyForm);

  const written = api.posts();
  assert.equal(written.length, 1);
  assert.equal(written[0].parentId, "parent");
  assert.equal(written[0].body, "reply to the reply");

  await tree.unmount();
});
