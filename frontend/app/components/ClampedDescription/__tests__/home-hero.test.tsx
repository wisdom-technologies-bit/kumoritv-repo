// Part F: every home block that shows a synopsis renders the SHARED clamped
// component, and its Watch Now / Favourite buttons sit outside the clamped box
// so they are always reachable without scrolling.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the home featured hero uses the shared clamp, not its own parsed copy", () => {
  const hero = read("../../HomePage/NavigationThroughMedias/index.tsx");
  assert.match(hero, /<ClampedDescription text=\{mediaSelect\.description\}/);
  assert.doesNotMatch(hero, /html-react-parser/);
  // Buttons stay a sibling of the description block, never inside it.
  const descIndex = hero.indexOf("<ClampedDescription");
  const buttonsIndex = hero.indexOf("btns_container");
  assert.ok(descIndex > 0 && buttonsIndex > descIndex, "buttons must follow the clamped description");
  assert.ok(hero.indexOf("<AddToFavourites.Button") > descIndex);
});

test("Newest Anime Episodes and the drop-downs share the same component", () => {
  const mediaExpanded = read(
    "../../MediaCards/MediaInfoExpandedWithCover/index.tsx",
  );
  assert.match(mediaExpanded, /<ClampedDescription/);
  assert.doesNotMatch(mediaExpanded, /parse\(description\)/);

  const newest = read("../../HomePage/NewestMediaSection/index.tsx");
  // It renders the shared Description, which is now the clamped component.
  assert.match(newest, /MediaInfoExpanded\.Description/);
});
