// Prompt 16, part 2: the settings modal (dark cards, sub/dub audio, confirms).

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, flush, render, submit, type RenderedTree } from "../../test-harness/render";
// Imported by relative path on purpose: the shared harness replaces the
// "@/app/layout/header/components/User/UserSettingsModal" specifier with a stub
// for the header test, and this suite needs the real component.
import UserSettingsModal from "../layout/header/components/User/UserSettingsModal";
import { __setDefaultContextForTests } from "@/app/lib/user-data/context";

type Globals = { __commentsTestAuth?: unknown; __commentsTestClient?: unknown };
const globals = globalThis as unknown as Globals;

const reactWithAct = React as unknown as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

type Update = { table: string; payload: Record<string, unknown> };

/** Chainable stand-in for the Supabase query builder, recording what is written. */
function fakeClient(options: { prefsRow?: Record<string, unknown> | null } = {}) {
  const updates: Update[] = [];
  const deletes: string[] = [];

  const builder: any = {
    select() {
      return builder;
    },
    update(payload: Record<string, unknown>) {
      updates.push({ table: builder.__table, payload });
      return builder;
    },
    delete() {
      deletes.push(builder.__table);
      return builder;
    },
    eq() {
      return builder;
    },
    is() {
      return builder;
    },
    in() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: options.prefsRow ?? null, error: null });
    },
    single() {
      return Promise.resolve({ data: options.prefsRow ?? null, error: null });
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };

  return {
    updates,
    deletes,
    from(table: string) {
      builder.__table = table;

      return builder;
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
      signOut: async () => ({ error: null }),
    },
  };
}

type FetchRecord = { url: string; method: string; body: unknown };

function mockFetch(succeed = true) {
  const calls: FetchRecord[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;

    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    calls.push({ url, method, body });

    if (!succeed) {
      return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
    }

    // GET /api/adult-content reports the stored flag.
    return new Response(JSON.stringify({ show: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function setSignedInUser(anonymous = false) {
  globals.__commentsTestAuth = {
    user: { id: "u1", is_anonymous: anonymous, user_metadata: { username: "meze" } },
    profile: {
      id: "u1",
      username: "meze",
      display_name: "meze",
      avatar_url: null,
      title_language: "romaji",
      show_adult: false,
      subtitle_language: "English",
      preferred_audio: "sub",
      auto_next: true,
      auto_skip: false,
      video_quality: "auto",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    isAnonymous: anonymous,
    loading: false,
    signOut: async () => {},
  };
}

function setGuestUser() {
  globals.__commentsTestAuth = {
    user: null,
    profile: null,
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
}

function useSignedInContext(client: ReturnType<typeof fakeClient>) {
  __setDefaultContextForTests({
    userId: "u1",
    client: client as never,
    storage: window.localStorage as never,
    now: () => Date.now(),
  });
}

function useGuestContext() {
  __setDefaultContextForTests({
    userId: null,
    client: null,
    storage: window.localStorage as never,
    now: () => Date.now(),
  });
}

async function mountModal(extra: { onClick?: () => void; newUser?: boolean } = {}) {
  return render(
    <UserSettingsModal
      onClick={extra.onClick as never}
      newUser={extra.newUser}
    />,
  );
}

function saveButton(container: HTMLElement) {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

async function changeInput(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    element instanceof window.HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  await reactWithAct.act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await flush();
}

async function toggle(element: HTMLInputElement | null) {
  if (!element) throw new Error("missing checkbox");

  await reactWithAct.act(async () => {
    element.click();
  });
  await flush();
}

test.afterEach(() => {
  __setDefaultContextForTests(null);
  delete globals.__commentsTestAuth;
  delete globals.__commentsTestClient;
});

// ------------------------------------------------------------------ structure & copy

test("the modal groups its settings into cards and drops every legacy word", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    const text = tree.container.textContent ?? "";

    assert.match(text, /Profile/);
    assert.match(text, /Playback/);
    assert.match(text, /Content/);
    assert.match(text, /Data/);

    for (const legacy of ["Aniwatch", "Crunchyroll", "GoGoAnime", "Consumet", "Zoro", "BETA"]) {
      assert.equal(text.includes(legacy), false, `"${legacy}" must not appear`);
    }

    assert.equal(text.includes("Main Source of Episodes"), false);
    assert.match(text, /Skip intro & outro/);
    assert.match(text, /Autoplay next episode/);
    assert.match(text, /Used when the stream offers this language\./);
    assert.equal(text.includes("Only works with"), false);

    const dialog = tree.container.querySelector('[role="dialog"]');
    assert.ok(dialog, "the modal is a dialog");
    assert.equal(dialog!.getAttribute("aria-modal"), "true");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

test("settings the app never reads are hidden, the ones it reads are shown", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    assert.equal(tree.container.querySelector('select[name="quality"]'), null, "video quality is not read");
    assert.equal(tree.container.querySelector('select[name="mediaTitlePreferredLang"]'), null, "title language is not read");
    assert.equal(tree.container.querySelector('select[name="source"]'), null, "legacy source selector is gone");
    assert.equal(tree.container.querySelector('input[name="playVideoWhenMismatch"]'), null, "wrong media alert is gone");

    assert.ok(tree.container.querySelector('select[name="subtitleLanguage"]'), "subtitle language is shown");
    assert.ok(tree.container.querySelector('input[name="autoSkip"]'), "skip intro is shown");
    assert.ok(tree.container.querySelector('input[name="autoNext"]'), "autoplay is shown");
    assert.ok(tree.container.querySelector('input[name="showAdultContent"]'), "adult content is shown");
    assert.ok(tree.container.querySelector('button[data-audio="sub"]'), "preferred audio is shown");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

// ------------------------------------------------------------------ preferred audio

test("the sub/dub control saves preferred_audio and never writes a legacy source name", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();
  window.localStorage.removeItem("dubEpisodes");

  const tree = await mountModal();

  try {
    const dub = tree.container.querySelector('button[data-audio="dub"]') as HTMLButtonElement;
    assert.equal(dub.getAttribute("aria-pressed"), "false");

    await click(dub);
    assert.equal(dub.getAttribute("aria-pressed"), "true", "dub is selected");

    await submit(tree.container.querySelector("form"));

    const audioWrites = client.updates.filter(
      (entry) => "preferred_audio" in entry.payload
    );

    assert.deepEqual(
      audioWrites.map((entry) => entry.payload.preferred_audio),
      ["dub"],
      "only the sub/dub value reaches profiles.preferred_audio"
    );

    for (const entry of client.updates) {
      for (const legacy of ["crunchyroll", "gogoanime", "zoro", "aniwatch"]) {
        assert.equal(
          JSON.stringify(entry.payload).includes(legacy),
          false,
          `no write may contain the legacy source "${legacy}"`
        );
      }
    }

    assert.equal(window.localStorage.getItem("dubEpisodes"), "true");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

test("switching back to sub writes preferred_audio sub", async () => {
  setSignedInUser();
  const client = fakeClient({ prefsRow: { auto_skip: false, auto_next: true, preferred_audio: "dub", subtitle_language: "English" } });
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    const sub = tree.container.querySelector('button[data-audio="sub"]') as HTMLButtonElement;
    await click(sub);
    await submit(tree.container.querySelector("form"));

    const writes = client.updates
      .filter((entry) => "preferred_audio" in entry.payload)
      .map((entry) => entry.payload.preferred_audio);

    assert.deepEqual(writes, ["sub"]);
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

// ------------------------------------------------------------------ saving

test("Save stays disabled until something changes and confirms afterwards", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    const button = saveButton(tree.container);

    assert.equal(button.disabled, true, "nothing changed yet");
    assert.match(button.textContent ?? "", /Save changes/);

    await toggle(tree.container.querySelector('input[name="autoSkip"]') as HTMLInputElement);

    assert.equal(button.disabled, false, "a change enables saving");

    await submit(tree.container.querySelector("form"));

    assert.match((tree.container.textContent ?? ""), /Saved/);
    assert.equal(saveButton(tree.container).disabled, true, "clean again after saving");

    const adultPost = fetchSpy.calls.find(
      (call) => call.url.includes("/api/adult-content") && call.method === "POST"
    );
    assert.ok(adultPost, "the adult preference is still posted");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

test("a failed save shows an inline error instead of pretending it worked", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch(false);

  const tree = await mountModal();

  try {
    await toggle(tree.container.querySelector('input[name="autoNext"]') as HTMLInputElement);
    await submit(tree.container.querySelector("form"));

    const alert = tree.container.querySelector('[role="alert"]');
    assert.ok(alert, "an error is announced");
    assert.match(alert!.textContent ?? "", /could not save/i);
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

test("the adult toggle posts to /api/adult-content", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    await toggle(tree.container.querySelector('input[name="showAdultContent"]') as HTMLInputElement);
    await submit(tree.container.querySelector("form"));

    const post = fetchSpy.calls.find(
      (call) => call.url.includes("/api/adult-content") && call.method === "POST"
    );

    assert.ok(post, "a POST was made");
    assert.deepEqual(post!.body, { enabled: true });
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

// ------------------------------------------------------------------ deletes

test("delete asks first: cancelling does nothing, confirming clears that data", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    const openHistory = Array.from(tree.container.querySelectorAll("button")).find((button) =>
      /Delete watch history/.test(button.textContent ?? "")
    ) as HTMLButtonElement;

    assert.ok(openHistory, "the data card has a delete button");
    await click(openHistory);

    const confirm = tree.container.querySelector('[role="dialog"][aria-label="Delete watch history?"]');
    assert.ok(confirm, "a confirm dialog opens");
    assert.match(confirm!.textContent ?? "", /This cannot be undone\./);

    const cancel = Array.from(confirm!.querySelectorAll("button")).find((button) =>
      /Cancel/.test(button.textContent ?? "")
    ) as HTMLButtonElement;

    await click(cancel);

    assert.equal(tree.container.querySelector('[role="dialog"][aria-label="Delete watch history?"]'), null);
    assert.deepEqual(client.deletes, [], "nothing was deleted");

    await click(openHistory);

    const confirmAgain = tree.container.querySelector('[role="dialog"][aria-label="Delete watch history?"]');
    const dangerButton = Array.from(confirmAgain!.querySelectorAll("button")).find((button) =>
      /^Delete$/.test((button.textContent ?? "").trim())
    ) as HTMLButtonElement;

    await click(dangerButton);

    assert.deepEqual(client.deletes, ["watch_progress"], "watch history was cleared");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

test("deleting the account needs the word DELETE typed in", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    const openAccount = Array.from(tree.container.querySelectorAll("button")).find((button) =>
      /Delete account/.test(button.textContent ?? "")
    ) as HTMLButtonElement;

    await click(openAccount);

    const dialog = tree.container.querySelector('[role="dialog"][aria-label="Delete account?"]');
    assert.ok(dialog, "the account confirm opens");

    const danger = Array.from(dialog!.querySelectorAll("button")).find((button) =>
      /^Delete$/.test((button.textContent ?? "").trim())
    ) as HTMLButtonElement;

    assert.equal(danger.disabled, true, "blocked before typing");

    await changeInput(
      dialog!.querySelector('input[name="deleteAccountConfirm"]') as HTMLInputElement,
      "DELETE"
    );

    assert.equal(danger.disabled, false, "enabled after typing DELETE");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

// ------------------------------------------------------------------ guests

test("a guest gets the playback cards but no profile fields", async () => {
  setGuestUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useGuestContext();
  const fetchSpy = mockFetch();
  window.localStorage.removeItem("autoSkip");

  const tree = await mountModal();

  try {
    assert.equal(tree.container.querySelector('input[name="username"]'), null, "no username field");
    assert.equal(tree.container.querySelector("[data-avatar-container]"), null, "no avatar picker");
    assert.equal(
      Array.from(tree.container.querySelectorAll("button")).some((button) =>
        /Change avatar/.test(button.textContent ?? "")
      ),
      false
    );

    assert.ok(tree.container.querySelector('input[name="autoSkip"]'), "playback prefs still work");
    assert.ok(tree.container.querySelector('input[name="showAdultContent"]'), "adult content still works");

    await toggle(tree.container.querySelector('input[name="autoSkip"]') as HTMLInputElement);
    await submit(tree.container.querySelector("form"));

    assert.equal(window.localStorage.getItem("autoSkip"), "true", "saved locally for a guest");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

test("an anonymous user sees the username field disabled", async () => {
  setSignedInUser(true);
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const tree = await mountModal();

  try {
    const username = tree.container.querySelector('input[name="username"]') as HTMLInputElement;

    assert.ok(username, "the field is visible");
    assert.equal(username.disabled, true, "but not editable");
    assert.equal(username.getAttribute("maxlength"), "40");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});

// ------------------------------------------------------------------ closing

test("Escape closes the modal and hands focus back to the opener", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  const opened = document.createElement("button");
  opened.textContent = "open settings";
  document.body.appendChild(opened);
  opened.focus();

  function Harness() {
    const [isOpen, setIsOpen] = React.useState(true);

    return isOpen ? (
      <UserSettingsModal onClick={() => setIsOpen(false)} />
    ) : (
      <p>settings closed</p>
    );
  }

  const tree = await render(<Harness />);

  try {
    const dialog = tree.container.querySelector('[role="dialog"]');
    assert.ok(dialog, "the modal is open");
    assert.equal(
      dialog!.contains(document.activeElement),
      true,
      "focus moved into the modal when it opened",
    );

    await reactWithAct.act(async () => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();

    assert.equal(tree.container.querySelector('[role="dialog"]'), null, "Escape closed it");
    assert.equal(document.activeElement, opened, "focus returned to the opener");
  } finally {
    await tree.unmount();
    opened.remove();
    fetchSpy.restore();
  }
});

test("a click on the backdrop closes the modal, a click inside does not", async () => {
  setSignedInUser();
  const client = fakeClient();
  globals.__commentsTestClient = client;
  useSignedInContext(client);
  const fetchSpy = mockFetch();

  let closed = 0;

  const tree: RenderedTree = await mountModal({ onClick: () => { closed += 1; } });

  try {
    const backdrop = tree.container.firstElementChild as HTMLElement;

    await click(tree.container.querySelector('[role="dialog"]'));
    assert.equal(closed, 0, "clicks inside stay open");

    await click(backdrop);
    assert.equal(closed, 1, "the backdrop closes it");
  } finally {
    await tree.unmount();
    fetchSpy.restore();
  }
});
