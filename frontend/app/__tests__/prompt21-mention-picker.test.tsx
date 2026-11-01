// Prompt 21, part 4: the @-mention picker in the comment composer.
// The hook is driven through a small harness so the real keyboard map, debounce
// and insertion logic run.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, flush, render, type RenderedTree } from "../../test-harness/render";
import MentionPicker, {
  MENTION_DEBOUNCE_MS,
  fetchMentionUsers,
  useMentionPicker,
  type MentionUser,
} from "@/app/components/CommentsSection/components/MentionPicker";

const reactWithAct = React as unknown as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const USERS: MentionUser[] = [
  { username: "frieren", avatar_url: "https://art.test/frieren.jpg" },
  { username: "frieren_fan", avatar_url: null },
  { username: "frierenny", avatar_url: null },
];

type Harness = {
  tree: RenderedTree;
  textarea: HTMLTextAreaElement;
  inserted: Array<{ text: string; caret: number }>;
  calls: string[];
  type: (value: string, caret?: number) => Promise<void>;
  press: (key: string) => Promise<boolean>;
  picker: () => HTMLElement | null;
};

async function renderHarness(initial = "", fetcherUsers: MentionUser[] = USERS): Promise<Harness> {
  const inserted: Array<{ text: string; caret: number }> = [];
  const calls: string[] = [];

  function Harness() {
    const [text, setText] = React.useState(initial);
    const [caret, setCaret] = React.useState(initial.length);
    const picker = useMentionPicker({
      text,
      caret,
      onInsert: (value) => {
        inserted.push(value);
        setText(value.text);
        setCaret(value.caret);
      },
      fetcher: async (query) => {
        calls.push(query);
        return fetcherUsers.filter((user) => user.username.startsWith(query));
      },
    });

    return React.createElement(
      "div",
      null,
      React.createElement("textarea", {
        "data-testid": "composer",
        value: text,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          picker.handleKeyDown(event);
        },
      }),
      picker.isOpen
        ? React.createElement(MentionPicker, {
            results: picker.results,
            activeIndex: picker.activeIndex,
            onSelect: picker.select,
            onHover: picker.setActiveIndex,
          })
        : null,
    );
  }

  const tree = await render(React.createElement(Harness));
  const textarea = tree.container.querySelector("textarea") as HTMLTextAreaElement;

  return {
    tree,
    textarea,
    inserted,
    calls,
    picker: () => tree.container.querySelector("[data-testid='mention-picker']"),
    type: async (value: string, caret?: number) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      const position = caret ?? value.length;

      await reactWithAct.act(async () => {
        setter?.call(textarea, value);
        // The caret is placed BEFORE the input event so the composer reports it.
        textarea.setSelectionRange(position, position);
        textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await flush();
    },
    press: async (key: string) => {
      let consumed = false;

      await reactWithAct.act(async () => {
        const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        textarea.dispatchEvent(event);
        consumed = event.defaultPrevented;
      });
      await flush();

      return consumed;
    },
  };
}

/** The @handle of each row (the avatar's fallback initial is not part of it). */
function handleOf(harness: Harness): string[] {
  return [...harness.picker()!.querySelectorAll("[role='option']")].map((row) =>
    (row.lastElementChild?.textContent ?? "").trim(),
  );
}

/** Waits out the debounce and the fetch. */
async function settle() {
  await reactWithAct.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, MENTION_DEBOUNCE_MS + 60));
  });
  await flush();
}

test("typing '@' at the start of a word opens the picker", async () => {
  const harness = await renderHarness();

  try {
    await harness.type("@");
    await settle();

    assert.ok(harness.picker(), "the dropdown is open");
    assert.deepEqual(harness.calls, [""], "an empty handle lists everyone");
  } finally {
    await harness.tree.unmount();
  }
});

test("the list narrows as the handle is typed, and debounces", async () => {
  const harness = await renderHarness();

  try {
    await harness.type("@f");
    await settle();
    const first = handleOf(harness);
    assert.deepEqual(first, ["@frieren", "@frieren_fan", "@frierenny"]);

    await harness.type("@frieren_");
    await settle();
    const second = handleOf(harness);
    assert.deepEqual(second, ["@frieren_fan"]);

    // Three keystrokes in a row only fetch once, 200 ms after the last one.
    harness.calls.length = 0;
    await harness.type("@fr");
    await harness.type("@frie");
    await harness.type("@frier");
    await settle();
    assert.deepEqual(harness.calls, ["frier"], "the earlier keystrokes are dropped");
  } finally {
    await harness.tree.unmount();
  }
});

test("there are at most 6 rows", async () => {
  const many: MentionUser[] = Array.from({ length: 12 }, (_, index) => ({
    username: `user${index}`,
    avatar_url: null,
  }));
  const harness = await renderHarness("", many);

  try {
    await harness.type("@u");
    await settle();

    assert.equal(harness.picker()!.querySelectorAll("[role='option']").length, 6);
  } finally {
    await harness.tree.unmount();
  }
});

test("ArrowDown and Enter pick the highlighted user", async () => {
  const harness = await renderHarness();

  try {
    await harness.type("@frieren");
    await settle();

    await harness.press("ArrowDown");
    const rows = [...harness.picker()!.querySelectorAll("[role='option']")];
    assert.equal(rows[1].getAttribute("aria-selected"), "true");

    await harness.press("Enter");

    assert.equal(harness.inserted.length, 1);
    assert.equal(harness.inserted[0].text, "@frieren_fan ");
    assert.equal(harness.inserted[0].caret, "@frieren_fan ".length);
    assert.equal(harness.picker(), null, "the list closes after picking");
  } finally {
    await harness.tree.unmount();
  }
});

test("Tab also picks, and the handle is inserted in the middle of a sentence", async () => {
  const harness = await renderHarness("hey  watch this");

  try {
    // Caret sits right after "@f", in the middle of the sentence.
    await harness.type("hey @f watch this", 6);
    await settle();

    await harness.press("Tab");

    assert.equal(harness.inserted.length, 1);
    assert.equal(harness.inserted[0].text, "hey @frieren  watch this");
  } finally {
    await harness.tree.unmount();
  }
});

test("Escape closes the list", async () => {
  const harness = await renderHarness();

  try {
    await harness.type("@frier");
    await settle();
    assert.ok(harness.picker());

    const consumed = await harness.press("Escape");

    assert.equal(consumed, true, "Escape is consumed by the picker, not the composer");
    assert.equal(harness.picker(), null);
  } finally {
    await harness.tree.unmount();
  }
});

test("a space closes the list and does not insert anything", async () => {
  const harness = await renderHarness();

  try {
    await harness.type("@frier");
    await settle();
    assert.ok(harness.picker());

    const consumed = await harness.press(" ");

    assert.equal(consumed, false, "the space still reaches the textarea");
    assert.equal(harness.picker(), null);
    assert.equal(harness.inserted.length, 0);
  } finally {
    await harness.tree.unmount();
  }
});

test("an @ in the middle of a word never opens the list", async () => {
  const harness = await renderHarness();

  try {
    await harness.type("mail me@example");
    await settle();

    assert.equal(harness.picker(), null);
    assert.deepEqual(harness.calls, []);
  } finally {
    await harness.tree.unmount();
  }
});

test("tapping a row picks it on mobile", async () => {
  const harness = await renderHarness();

  try {
    await harness.type("@frieren_f");
    await settle();

    const row = harness.picker()!.querySelector("[role='option']");
    await click(row);

    assert.equal(harness.inserted.length, 1);
    assert.equal(harness.inserted[0].text, "@frieren_fan ");
  } finally {
    await harness.tree.unmount();
  }
});

test("the picker asks the search route and only keeps username + avatar", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));

    return new Response(
      JSON.stringify({
        users: [
          { username: "frieren", avatar_url: "https://art.test/a.jpg", id: "should-be-dropped" },
          { username: "fern", avatar_url: null },
          { username: "", avatar_url: null },
          { nope: true },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const users = await fetchMentionUsers("frie");

    assert.equal(urls[0], "/api/users/search?q=frie");
    assert.deepEqual(users, [
      { username: "frieren", avatar_url: "https://art.test/a.jpg" },
      { username: "fern", avatar_url: null },
    ]);
    assert.equal(JSON.stringify(users).includes("should-be-dropped"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("a failing search returns an empty list instead of throwing", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

  try {
    assert.deepEqual(await fetchMentionUsers("frie"), []);
  } finally {
    globalThis.fetch = original;
  }
});
