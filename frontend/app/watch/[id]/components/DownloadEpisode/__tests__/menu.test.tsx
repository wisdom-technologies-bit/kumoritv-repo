// Prompt 41 (B): the download dropdown - order, links, roles, and the maths
// that keeps it on screen at 360px.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { createRoot } from "react-dom/client";
import { DownloadMenu, orderedGroups, type DownloadPayload } from "../menu";
import { placeMenu, sortQualities } from "../position";

const act = (React as unknown as { act: (cb: () => Promise<void> | void) => Promise<void> }).act;

const payload: DownloadPayload = {
  available: true,
  provider: "Kiwi",
  note: null,
  groups: [
    { audio: "dub", options: [{ quality: "360p", url: "https://dl.example/dub-360" }] },
    {
      audio: "sub",
      options: [
        { quality: "360p", url: "https://dl.example/sub-360" },
        { quality: "1080p", url: "https://dl.example/sub-1080" },
        { quality: "800p", url: "https://dl.example/sub-800" },
      ],
    },
  ],
};

async function render(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("the menu lists Sub before Dub, qualities high to low, as real links", async () => {
  let selected = 0;
  const view = await render(
    <DownloadMenu episode={6} payload={payload} onSelect={() => (selected += 1)} />,
  );

  const menu = view.container.querySelector('[role="menu"]');
  assert.ok(menu, "a menu");
  assert.match(menu!.getAttribute("aria-label") || "", /Download Episode 6/);
  assert.match(view.container.textContent || "", /Source:\s*Kiwi/);

  const audio = Array.from(view.container.querySelectorAll("p")).map((node) => node.textContent);
  assert.ok(audio.includes("Sub") && audio.includes("Dub"));
  assert.ok(audio.indexOf("Sub") < audio.indexOf("Dub"), "Sub first");

  const links = Array.from(view.container.querySelectorAll('a[role="menuitem"]')) as HTMLAnchorElement[];
  assert.deepEqual(
    links.map((link) => link.textContent?.trim()),
    ["1080p", "800p", "360p", "360p"],
    "sub qualities descending, then the dub group",
  );
  for (const link of links) {
    assert.equal(link.target, "_blank");
    const rel = (link.getAttribute("rel") || "").split(/\s+/);
    for (const token of ["noopener", "noreferrer", "nofollow"]) assert.ok(rel.includes(token), token);
    assert.match(link.getAttribute("href") || "", /^https:\/\/dl\.example\//);
  }
  assert.equal(links[0].getAttribute("href"), "https://dl.example/sub-1080");

  await act(async () => {
    links[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  assert.equal(selected, 1, "the sponsor/ad callback runs on the quality click");

  assert.match(view.container.textContent || "", /Opens an external page\. It may show ads\./);
  await view.unmount();
});

test("only the groups the API returned are shown, and odd qualities keep their place", () => {
  const only = orderedGroups([{ audio: "dub", options: [] }]);
  assert.deepEqual(only.map((group) => group.audio), ["dub"]);
  assert.deepEqual(
    sortQualities([{ quality: "480p" }, { quality: "1080p" }, { quality: "800p" }]).map((o) => o.quality),
    ["1080p", "800p", "480p"],
  );
});

test("the dropdown stays inside 360px, 390px and 1280px viewports", () => {
  for (const width of [360, 390, 1280]) {
    // A pill tucked against the right edge is the worst case.
    const placement = placeMenu(
      { left: width - 70, right: width - 10, top: 700, bottom: 736 },
      { width: 320, height: 300 },
      { width, height: 800 },
    );
    assert.ok(placement.left >= 12, `left margin at ${width}`);
    assert.ok(placement.left + placement.width <= width - 12, `right edge at ${width}`);
    assert.ok(placement.width <= 320);
  }
});

test("the dropdown flips above when there is no room below", () => {
  const flipped = placeMenu(
    { left: 40, right: 150, top: 500, bottom: 536 },
    { width: 300, height: 320 },
    { width: 390, height: 640 },
  );
  assert.equal(flipped.flipped, true);
  assert.ok(flipped.top >= 12);
  assert.ok(flipped.top + 320 <= 500, "it sits above the pill");

  const below = placeMenu(
    { left: 40, right: 150, top: 100, bottom: 136 },
    { width: 300, height: 200 },
    { width: 390, height: 640 },
  );
  assert.equal(below.flipped, false);
  assert.equal(below.top, 142);
});
