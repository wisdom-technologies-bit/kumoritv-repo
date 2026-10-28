import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, render } from "../../../../../test-harness/render";
import NavigationSideBar from "..";
import type { TestNavigationState } from "../../../../../test-harness/stubs/next-navigation";

type NavigationBag = { __searchTestNavigation?: TestNavigationState };
const bag = globalThis as unknown as NavigationBag;

function setUrl(search: string) {
  bag.__searchTestNavigation = { pathname: "/search", search, pushed: [] };
}

function pushed(): string[] {
  return bag.__searchTestNavigation?.pushed ?? [];
}

/** The checkbox whose <label> text is `label`. */
function genreCheckbox(container: HTMLElement, label: string): HTMLInputElement | null {
  const labels = Array.from(container.querySelectorAll("label"));

  for (const element of labels) {
    if (element.textContent?.trim().toLowerCase() === label.toLowerCase()) {
      return element.querySelector('input[type="checkbox"]');
    }
  }

  return null;
}

function checkedGenres(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((input) => input.checked)
    .map((input) => input.value);
}

test("the sidebar lists Adventure and Slice of Life with their canonical slugs", async () => {
  setUrl("");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  assert.equal(genreCheckbox(tree.container, "Adventure")?.value, "adventure");
  assert.equal(genreCheckbox(tree.container, "Slice of Life")?.value, "slice-of-life");

  // the old lowercase-l value ("slice-of-Life") no longer exists and nothing is
  // ticked for an unfiltered /search page
  assert.deepEqual(checkedGenres(tree.container), []);

  await tree.unmount();
});

test("checkboxes reflect the genre parameter of the URL", async () => {
  setUrl("?genre=%5Badventure-slice-of-life%5D");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  assert.equal(genreCheckbox(tree.container, "Adventure")?.checked, true);
  assert.equal(genreCheckbox(tree.container, "Slice of Life")?.checked, true);
  assert.equal(genreCheckbox(tree.container, "Comedy")?.checked, false);

  await tree.unmount();
});

test("checkboxes also reflect the media page chip format (spaces, lower case)", async () => {
  setUrl("?genre=%5Bslice%20of%20life%5D");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  assert.equal(genreCheckbox(tree.container, "Slice of Life")?.checked, true);

  await tree.unmount();
});

test("adding a genre builds the bracket URL", async () => {
  setUrl("");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  await click(genreCheckbox(tree.container, "Adventure"));

  assert.deepEqual(pushed(), ["/search?genre=[adventure]"]);

  await tree.unmount();
});

test("adding a second genre appends to the bracket list", async () => {
  setUrl("?genre=[adventure]");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  await click(genreCheckbox(tree.container, "Comedy"));

  assert.deepEqual(pushed(), ["/search?genre=[adventure-comedy]"]);

  await tree.unmount();
});

test("removing the FIRST genre keeps the rest", async () => {
  setUrl("?genre=[action-comedy]");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  assert.equal(genreCheckbox(tree.container, "Action")?.checked, true);
  assert.equal(genreCheckbox(tree.container, "Comedy")?.checked, true);

  await click(genreCheckbox(tree.container, "Action"));

  assert.deepEqual(pushed(), ["/search?genre=[comedy]"]);

  await tree.unmount();
});

test("removing the last genre drops the parameter entirely", async () => {
  setUrl("?genre=[adventure]&year=2024");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  await click(genreCheckbox(tree.container, "Adventure"));

  assert.deepEqual(pushed(), ["/search?year=2024"]);
  assert.ok(!pushed()[0].includes("genre"));

  await tree.unmount();
});

test("toggling a chip-format genre (spaces, lower case) removes it cleanly", async () => {
  setUrl("?genre=%5Bslice%20of%20life-comedy%5D");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  await click(genreCheckbox(tree.container, "Slice of Life"));

  assert.deepEqual(pushed(), ["/search?genre=[comedy]"]);

  await tree.unmount();
});

test("demographic checkboxes work like the other genres", async () => {
  setUrl("");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  await click(genreCheckbox(tree.container, "Shoujo"));

  assert.deepEqual(pushed(), ["/search?genre=[shoujo]"]);

  await tree.unmount();
});

test("toggling a genre keeps the other filters in the URL", async () => {
  setUrl("?type=tv&year=2024");
  const tree = await render(<NavigationSideBar isMobile={false} />);

  await click(genreCheckbox(tree.container, "Adventure"));

  assert.deepEqual(pushed(), ["/search?type=tv&year=2024&genre=[adventure]"]);

  await tree.unmount();
});
