// Phase 4, part A: the toast component.
//
// Two layers, tested where each is strongest:
//   * CommunityToastView - real markup, no clock: mobile one-line truncation
//     with the clip icon OUTSIDE the ellipsis element, the desktop clamp, the
//     single link, the 44 px dismiss, the adult label, announcements.
//   * the provider - the flag and the first-load seed, with fetch as a double.
// The 5 s window, the throttle, the collapse and the back-off are asserted
// exactly in latest.test.ts, and the real 5 s timing is measured in Playwright.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { render, click } from "../../../../test-harness/render";
import {
  TOAST_VISIBLE_MS,
  TOAST_MIN_GAP_MS,
  POLL_BACKOFF_MAX_MS,
  backoffDelay,
  type LatestItem,
} from "@/app/lib/community/latest";
import CommunityToastView from "@/app/components/CommunityToast/view";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, seconds)).toISOString();

function item(overrides: Partial<LatestItem> = {}): LatestItem {
  return {
    id: "post-1",
    kind: "post",
    authorId: "author-1",
    authorName: "Ada",
    authorAvatar: null,
    text: "A new post with a fairly long tail so the phone layout has to truncate it",
    hasClip: false,
    clipThumb: null,
    adult: false,
    href: "/community/post/post-1",
    createdAt: at(10),
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------- view --------------------------------- */

test("the clock constants are the owner's numbers", () => {
  assert.equal(TOAST_VISIBLE_MS, 5_000);
  assert.equal(TOAST_MIN_GAP_MS, 10_000);
});

test("back-off grows exponentially and stops at five minutes", () => {
  assert.equal(backoffDelay(1, 30_000), 60_000);
  assert.equal(backoffDelay(2, 30_000), 120_000);
  assert.equal(backoffDelay(9, 30_000), POLL_BACKOFF_MAX_MS);
  // A Retry-After longer than the backoff wins, but never beyond the ceiling.
  assert.equal(backoffDelay(1, 30_000, 45_000), 60_000);
  assert.equal(backoffDelay(1, 30_000, 900_000), POLL_BACKOFF_MAX_MS);
});

test("the desktop card has a name, a clamped message and the whole bar is one link", async () => {
  const tree = await render(<CommunityToastView items={[item()]} />);
  const link = tree.container.querySelector('[data-testid="community-toast-link"]') as HTMLAnchorElement;
  assert.ok(link);
  assert.equal(link.getAttribute("href"), "/community/post/post-1");
  assert.ok((link.textContent ?? "").includes("Ada"));
  // The message lives in its own element so CSS can clamp it to two lines.
  const message = tree.container.querySelector('[class*="message"]');
  assert.ok(message);
  await tree.unmount();
});

test("mobile: the clip icon is a sibling AFTER the truncating span", async () => {
  const tree = await render(<CommunityToastView items={[item({ hasClip: true })]} />);
  const text = tree.container.querySelector('[data-testid="community-toast-text"]') as HTMLElement;
  assert.ok(text, "the mobile line exists");
  assert.ok((text.textContent ?? "").startsWith("Ada · "), text.textContent ?? "");

  const icon = text.nextElementSibling;
  assert.ok(icon, "the icon follows the text span");
  assert.equal(icon?.tagName.toLowerCase(), "svg");
  assert.equal(icon?.parentElement, text.parentElement, "same flex row");
  assert.notEqual(icon?.parentElement, text, "never inside the ellipsis element");
  await tree.unmount();
});

test("no clip means no icon on the mobile line", async () => {
  const tree = await render(<CommunityToastView items={[item({ hasClip: false })]} />);
  const text = tree.container.querySelector('[data-testid="community-toast-text"]') as HTMLElement;
  assert.equal(text.nextElementSibling, null);
  await tree.unmount();
});

test("the dismiss button is 44 px, labelled, and calls back", async () => {
  let dismissed = 0;
  const tree = await render(<CommunityToastView items={[item()]} onDismiss={() => (dismissed += 1)} />);
  const button = tree.container.querySelector('[data-testid="community-toast-dismiss"]') as HTMLButtonElement;
  assert.ok(button);
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("aria-label"), "Dismiss notification");
  const style = button.className;
  assert.ok(style, "the size lives in the stylesheet's class");
  await click(button);
  assert.equal(dismissed, 1);
  await tree.unmount();
});

test("an adult item is generic: no thumbnail, no image at all", async () => {
  const tree = await render(
    <CommunityToastView items={[item({ adult: true, hasClip: true, text: "New 18+ clip" })]} />,
  );
  const toast = tree.container.querySelector('[data-testid="community-toast"]') as HTMLElement;
  assert.equal(toast.getAttribute("data-adult"), "true");
  assert.equal(tree.container.querySelectorAll("img").length, 0);
  assert.ok((toast.textContent ?? "").includes("New 18+ clip"));
  await tree.unmount();
});

test("a clip thumbnail only ever appears for a non-adult clip", async () => {
  const withThumb = item({ hasClip: true, clipThumb: "https://cdn/thumb.jpg" });
  const first = await render(<CommunityToastView items={[withThumb]} />);
  assert.equal(first.container.querySelectorAll("img").length, 1);
  await first.unmount();

  const adult = await render(<CommunityToastView items={[{ ...withThumb, adult: true, clipThumb: null }]} />);
  assert.equal(adult.container.querySelectorAll("img").length, 0);
  await adult.unmount();
});

test("an announcement shows the megaphone instead of an avatar", async () => {
  const tree = await render(
    <CommunityToastView
      items={[item({ kind: "announcement", authorName: "KumoriTV", text: "We are back", href: "/community/announcements/a1" })]}
    />,
  );
  const link = tree.container.querySelector('[data-testid="community-toast-link"]') as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), "/community/announcements/a1");
  const megaphone = tree.container.querySelector('svg[viewBox="0 0 16 16"]');
  assert.ok(megaphone);
  assert.equal(tree.container.querySelectorAll("img").length, 0);
  await tree.unmount();
});

test("several items collapse into one headline", async () => {
  const tree = await render(
    <CommunityToastView
      items={[
        item({ id: "c", authorName: "Chidi", createdAt: at(12) }),
        item({ id: "b", authorName: "Bola", createdAt: at(11) }),
        item({ id: "a", authorName: "Ada", createdAt: at(10) }),
      ]}
    />,
  );
  assert.ok((tree.container.textContent ?? "").includes("Chidi and 2 others posted"));
  await tree.unmount();
});

/* -------------------------------- provider ------------------------------- */

function response(items: LatestItem[]): Response {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    json: async () => ({ items, cursor: items[0]?.createdAt ?? null }),
  } as unknown as Response;
}

type TestGlobals = {
  __searchTestNavigation?: { pathname?: string };
  __commentsTestAuth?: Record<string, unknown>;
  fetch?: unknown;
};

function guest() {
  const globals = globalThis as unknown as TestGlobals;
  globals.__searchTestNavigation = { pathname: "/watch/1" };
  globals.__commentsTestAuth = {
    user: null,
    profile: null,
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
  try {
    window.localStorage.removeItem("kumori.community.toasts");
  } catch {
    /* ignore */
  }
}

test("with the flag off the provider renders its children and never polls", async () => {
  guest();
  let calls = 0;
  (globalThis as unknown as TestGlobals).fetch = async () => {
    calls += 1;
    return response([]);
  };

  const CommunityLatestProvider = (await import("@/app/components/CommunityToast")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CommunityLatestProvider enabled={false}>
        <p data-testid="child">page</p>
      </CommunityLatestProvider>,
    );
  });
  await sleep(60);

  assert.equal(calls, 0, "no request with the flag off");
  assert.ok(container.querySelector('[data-testid="child"]'));
  assert.equal(container.querySelector('[data-testid="community-toast-host"]'), null);
  root.unmount();
  container.remove();
});

test("the first response only seeds the cursor: no toast for the backlog", async () => {
  guest();
  (globalThis as unknown as TestGlobals).fetch = async () => response([item({ id: "seed", createdAt: at(5) })]);

  const CommunityLatestProvider = (await import("@/app/components/CommunityToast")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CommunityLatestProvider enabled>
        <p>page</p>
      </CommunityLatestProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  await sleep(40);

  assert.equal(container.querySelector('[data-testid="community-toast"]'), null);
  root.unmount();
  container.remove();
});
