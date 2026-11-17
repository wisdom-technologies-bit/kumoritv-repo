// Phase 4, part B2: the composer, without a network and without timers.
//
// The toolbar, the live preview, the mobile tabs, the confirm step and the draft
// are all reachable here; the publish POST itself is covered by the route tests.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act } from "react";
import { click, flush, render, type RenderedTree } from "../../../../test-harness/render";
import Composer from "@/app/community/admin/announcements/Composer";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000d4";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    title: "Season 2 of the weekly digest starts Sunday",
    body: "Every Sunday at 09:00 the bell will carry one digest.",
    image: null,
    url: null,
    createdAt: "2026-11-10T09:00:00.000Z",
    expiresAt: null,
    pushed: true,
    ...overrides,
  };
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!element) throw new Error("missing field");
  const prototype =
    element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await flush();
}

type HarnessGlobal = typeof globalThis & {
  __searchTestNavigation?: { pathname: string };
  __commentsTestAuth?: Record<string, unknown>;
};

async function mount(): Promise<RenderedTree> {
  const harness = globalThis as HarnessGlobal;
  harness.__searchTestNavigation = { pathname: "/community/admin/announcements" };
  harness.__commentsTestAuth = {
    user: { id: ADMIN_ID, is_anonymous: false },
    profile: { community_toasts: true },
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
  try {
    window.localStorage.removeItem("kumori.announcement.draft");
  } catch {
    /* ignore */
  }
  return render(<Composer initialRows={[row()]} />);
}

test("the form starts empty with Publish disabled", async () => {
  const tree = await mount();
  const publish = tree.container.querySelector('[data-testid="composer-publish"]') as HTMLButtonElement;
  assert.ok(publish);
  assert.equal(publish.disabled, true);
  assert.ok(tree.container.querySelector('[data-testid="composer-body"]'));
  await tree.unmount();
});

test("a title and a body enable Publish, and the preview shows the same text", async () => {
  const tree = await mount();
  await setValue(tree.container.querySelector('[data-testid="composer-title"]') as HTMLInputElement, "We are back");
  await setValue(
    tree.container.querySelector('[data-testid="composer-body"]') as HTMLTextAreaElement,
    "# We are back\n\n**Thank you**",
  );

  const publish = tree.container.querySelector('[data-testid="composer-publish"]') as HTMLButtonElement;
  assert.equal(publish.disabled, false);

  // The preview pane uses the real renderer, so the heading is an h2 in both.
  const previews = tree.container.querySelectorAll('[data-markdown-body="true"]');
  assert.ok(previews.length >= 1);
  const preview = previews[previews.length - 1];
  assert.equal(preview.querySelector("h2")?.textContent, "We are back");
  assert.ok(preview.querySelector("strong"));
  await tree.unmount();
});

test("the toolbar inserts Markdown around the selection", async () => {
  const tree = await mount();
  const body = tree.container.querySelector('[data-testid="composer-body"]') as HTMLTextAreaElement;
  await setValue(body, "hello world");
  body.focus();
  body.setSelectionRange(6, 11);

  await click(tree.container.querySelector('[data-testid="toolbar-bold"]'));
  assert.equal(body.value, "hello **world**");
  assert.match(body.value, /\*\*world\*\*/);
  await tree.unmount();
});

test("the mobile tabs switch between Write and Preview", async () => {
  const tree = await mount();
  const tabs = Array.from(tree.container.querySelectorAll('[role="tab"]'));
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");

  await click(tabs[1]);
  const after = Array.from(tree.container.querySelectorAll('[role="tab"]'));
  assert.equal(after[1].getAttribute("aria-selected"), "true");
  assert.equal(after[0].getAttribute("aria-selected"), "false");
  await tree.unmount();
});

test("Publish opens a confirm step that states whether a push goes out", async () => {
  const tree = await mount();
  await setValue(tree.container.querySelector('[data-testid="composer-title"]') as HTMLInputElement, "Back online");
  await setValue(
    tree.container.querySelector('[data-testid="composer-body"]') as HTMLTextAreaElement,
    "**We're back.**",
  );

  await click(tree.container.querySelector('[data-testid="composer-publish"]'));
  const confirm = tree.container.querySelector('[data-testid="composer-confirm"]');
  assert.ok(confirm, "the confirm step is shown");
  assert.ok((confirm?.textContent ?? "").includes("A push notification will be sent"));
  assert.ok((confirm?.textContent ?? "").includes("We're back."));

  // No fetch stub here: the click must not throw, it must report a failure.
  await click(tree.container.querySelector('[data-testid="composer-confirm-publish"]'));
  assert.ok(tree.container.querySelector('[data-testid="composer-error"]'));
  await tree.unmount();
});

test("the draft is kept in localStorage while typing", async () => {
  const tree = await mount();
  await setValue(
    tree.container.querySelector('[data-testid="composer-body"]') as HTMLTextAreaElement,
    "half a thought",
  );
  const raw = window.localStorage.getItem("kumori.announcement.draft");
  assert.ok(raw);
  assert.equal(JSON.parse(String(raw)).body, "half a thought");
  await tree.unmount();
});

test("the recent list shows status, push state and the three actions", async () => {
  const tree = await mount();
  const text = tree.container.textContent ?? "";
  assert.ok(text.includes("Season 2 of the weekly digest starts Sunday"));
  assert.ok(text.includes("active"));
  assert.ok(text.includes("push sent"));
  assert.ok(text.includes("Edit"));
  assert.ok(text.includes("Expire now"));
  assert.ok(text.includes("Delete"));
  await tree.unmount();
});

test("Edit fills the form and disables the push checkbox", async () => {
  const tree = await mount();
  const edit = Array.from(tree.container.querySelectorAll("button")).find(
    (button) => (button.textContent ?? "").trim() === "Edit",
  ) as HTMLButtonElement;
  await click(edit);

  const title = tree.container.querySelector('[data-testid="composer-title"]') as HTMLInputElement;
  assert.equal(title.value, "Season 2 of the weekly digest starts Sunday");

  const push = tree.container.querySelector('[data-testid="composer-send-push"]') as HTMLInputElement;
  assert.equal(push.disabled, true, "editing never re-sends");
  await tree.unmount();
});
