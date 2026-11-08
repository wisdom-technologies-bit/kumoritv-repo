// Prompt 30: the watch page's UI-only view modes and the restyled controls.
//
// Pinned here:
//   - Auto-next / Auto-skip are the SAME saved preferences (usePrefs), toggled
//     from the toolbar;
//   - Theater is remembered in localStorage and survives a throwing storage;
//   - Lights off opens on click and closes on Esc;
//   - the server notice can be dismissed and stays dismissed, and never names a
//     provider (server names only);
//   - SUB | DUB disables the audio the episode does not have.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render, flush, click } from "../../test-harness/render";
import WatchLayout, {
  THEATER_STORAGE_KEY,
} from "@/app/watch/[id]/components/WatchLayout";
import PlayerToolbar from "@/app/watch/[id]/components/PlayerToolbar";
import WatchControls, {
  SERVER_NOTICE_KEY,
} from "@/app/watch/[id]/components/WatchControls";
import { WatchState } from "@/app/watch/[id]/components/WatchState";

const act = (React as unknown as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
}).act;

type Payload = {
  servers?: { id: string; label?: string }[];
  serverId?: string;
  hasBackup?: boolean;
  availableAudio?: string[];
  provider?: string;
};

/** Answers /api/watch like the route does; everything else is ignored. */
function stubWatch(payload: Payload) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function findButton(container: HTMLElement, label: string) {
  return (
    [...container.querySelectorAll("button")].find((node) =>
      (node.textContent || "").includes(label),
    ) || null
  );
}

async function renderToolbar(episode = 3, episodeCount: number | null = 12) {
  return render(
    <WatchLayout>
      <PlayerToolbar
        anilistId={21}
        episode={episode}
        audio="sub"
        episodeCount={episodeCount}
      />
    </WatchLayout>,
  );
}

test("Auto-next and Auto-skip toggles read and write the saved preferences", async () => {
  window.localStorage.clear();
  const tree = await renderToolbar();

  const autoNext = findButton(tree.container, "Auto-next")!;
  const autoSkip = findButton(tree.container, "Auto-skip")!;

  // defaults: autoNext on, autoSkip off
  assert.equal(autoNext.getAttribute("aria-pressed"), "true");
  assert.equal(autoSkip.getAttribute("aria-pressed"), "false");

  await click(autoNext);
  assert.equal(autoNext.getAttribute("aria-pressed"), "false");
  assert.equal(
    window.localStorage.getItem("autoNext"),
    "false",
    "the toolbar writes the same pref the settings page and the player read",
  );

  await click(autoSkip);
  assert.equal(autoSkip.getAttribute("aria-pressed"), "true");
  assert.equal(window.localStorage.getItem("autoSkip"), "true");

  await tree.unmount();
});

test("Theater toggles the grid, remembers the choice and survives blocked storage", async () => {
  window.localStorage.clear();
  const first = await renderToolbar();

  const theater = findButton(first.container, "Theater")!;
  assert.equal(theater.getAttribute("aria-pressed"), "false");

  const grid = first.container.querySelector('[data-theater="true"]');
  assert.equal(grid, null, "starts in the standard two-column layout");

  await click(theater);
  assert.equal(theater.getAttribute("aria-pressed"), "true");
  assert.equal(
    window.localStorage.getItem(THEATER_STORAGE_KEY),
    "true",
    "theater is persisted",
  );
  assert.ok(
    first.container.querySelector('[data-theater="true"]'),
    "the grid carries the theater state",
  );

  await first.unmount();

  // A new visit restores it from storage.
  const second = await renderToolbar();
  assert.equal(
    findButton(second.container, "Theater")!.getAttribute("aria-pressed"),
    "true",
  );
  await second.unmount();

  // Blocked storage: the toggle still works, nothing throws.
  const realLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new Error("storage is blocked");
      },
      setItem() {
        throw new Error("storage is blocked");
      },
      removeItem() {
        throw new Error("storage is blocked");
      },
      clear() {},
    },
  });

  try {
    const third = await renderToolbar();
    const blockedTheater = findButton(third.container, "Theater")!;
    await click(blockedTheater);
    assert.equal(
      blockedTheater.getAttribute("aria-pressed"),
      "true",
      "the layout still switches when the storage write fails",
    );
    await third.unmount();
  } finally {
    if (realLocalStorage) Object.defineProperty(window, "localStorage", realLocalStorage);
  }
});

test("Lights off opens on click and closes on Esc", async () => {
  const tree = await renderToolbar();
  const lights = findButton(tree.container, "Lights off")!;

  assert.equal(
    tree.container.querySelector('[data-testid="lights-off-overlay"]'),
    null,
  );

  await click(lights);
  assert.equal(lights.getAttribute("aria-pressed"), "true");
  assert.ok(
    tree.container.querySelector('[data-testid="lights-off-overlay"]'),
    "the scrim is up",
  );

  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  });
  await flush();

  assert.equal(lights.getAttribute("aria-pressed"), "false");
  assert.equal(
    tree.container.querySelector('[data-testid="lights-off-overlay"]'),
    null,
    "Esc takes the scrim down",
  );

  // and a click on the scrim closes it too
  await click(lights);
  const overlay = tree.container.querySelector(
    '[data-testid="lights-off-overlay"]',
  ) as HTMLElement;
  assert.ok(overlay);
  await click(overlay);
  assert.equal(
    tree.container.querySelector('[data-testid="lights-off-overlay"]'),
    null,
  );

  await tree.unmount();
});

test("the server notice is dismissible, stays dismissed and names no provider", async () => {
  window.localStorage.clear();
  const restore = stubWatch({
    servers: [
      { id: "hd-1", label: "HD-1" },
      { id: "vs-2", label: "Vidstream-2" },
    ],
    serverId: "hd-1",
    hasBackup: true,
    availableAudio: ["sub", "dub"],
    provider: "internalproviderslug",
  });

  try {
    const renderControls = () =>
      render(
        <WatchState
          anilistId={21}
          episode={2}
          initialAudio="sub"
          initialSubtitleLanguage="English"
        >
          <WatchControls anilistId={21} episode={2} audio="sub" episodeCount={12} />
        </WatchState>,
      );

    const tree = await renderControls();
    await flush();

    const wrapper = tree.container.querySelector('[data-testid="watch-controls"]');
    assert.ok(wrapper, "the controls render");

    const text = wrapper!.textContent || "";
    assert.match(text, /Video not loading or out of sync\?/);
    assert.match(text, /Backup server/);
    assert.ok(
      !/internalproviderslug/i.test(text),
      "server names only: the provider never reaches the UI",
    );

    const dismiss = tree.container.querySelector(
      'button[aria-label="Dismiss notice"]',
    );
    assert.ok(dismiss, "the notice has a close button");

    await click(dismiss!);
    assert.ok(
      !/Video not loading or out of sync\?/.test(wrapper!.textContent || ""),
      "the notice is gone",
    );
    assert.equal(window.localStorage.getItem(SERVER_NOTICE_KEY), "true");

    await tree.unmount();

    // A fresh mount remembers the dismissal.
    const again = await renderControls();
    await flush();
    assert.ok(
      !/Video not loading or out of sync\?/.test(again.container.textContent || ""),
      "a dismissed notice stays dismissed",
    );
    await again.unmount();
  } finally {
    restore();
  }
});

test("SUB | DUB disables the audio this episode does not have", async () => {
  const restore = stubWatch({
    servers: [{ id: "hd-1", label: "HD-1" }],
    serverId: "hd-1",
    hasBackup: false,
    availableAudio: ["sub"],
    provider: "internalproviderslug",
  });

  try {
    const tree = await render(
      <WatchState
        anilistId={21}
        episode={2}
        initialAudio="sub"
        initialSubtitleLanguage="English"
      >
        <WatchControls anilistId={21} episode={2} audio="sub" episodeCount={12} />
      </WatchState>,
    );
    await flush();

    const group = tree.container.querySelector('[role="group"][aria-label="Audio"]');
    assert.ok(group, "the audio control is one labelled segment");

    const sub = findButton(tree.container, "SUB")!;
    const dub = findButton(tree.container, "DUB")!;

    assert.equal(sub.getAttribute("aria-pressed"), "true");
    assert.equal(sub.hasAttribute("disabled"), false);

    assert.equal(dub.hasAttribute("disabled"), true, "no dub in this episode");
    assert.match(dub.getAttribute("title") || "", /No dub available/i);

    await tree.unmount();
  } finally {
    restore();
  }
});

test("Prev / Next live in the toolbar with the same texts and disabled rules", async () => {
  window.localStorage.clear();

  const first = await renderToolbar(1, 12);
  const prev = findButton(first.container, "‹ Prev") as HTMLButtonElement;
  assert.ok(prev, "a disabled Prev on episode 1");
  assert.equal(prev.disabled, true);
  await first.unmount();

  const last = await renderToolbar(12, 12);
  const next = findButton(last.container, "Next ›") as HTMLButtonElement;
  assert.ok(next, "no Next past the last aired episode");
  assert.equal(next.disabled, true);
  await last.unmount();
});
