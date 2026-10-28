import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const PLAY_BTN_CSS = join(ROOT, "app/media/[id]/components/WatchPlayBtn/component.module.css");

function read(path: string) {
  return readFileSync(path, "utf8");
}

// ------------------------------------------------------------------ part B.1

test("the play button stylesheet has balanced braces", () => {
  const css = read(PLAY_BTN_CSS);
  let depth = 0;
  let lowest = 0;

  for (const character of css) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    lowest = Math.min(lowest, depth);
  }

  assert.equal(depth, 0, "every opening brace must be closed");
  assert.equal(lowest, 0, "no closing brace may appear before its opening brace");
});

test("the invented #container block is gone", () => {
  const css = read(PLAY_BTN_CSS);

  assert.equal(/#container\s*\{/.test(css), false, "the pasted #container block must not come back");
  assert.equal(css.includes("min-height: 56px"), false, "no layout of the replaced link button");
  assert.equal(css.includes("gap: 10px"), false);
});

test("the original play button rules are back", () => {
  const css = read(PLAY_BTN_CSS);

  assert.match(css, /#continue_span\s*\{/, "the episode label keeps its own rule");
  assert.match(
    css,
    /@media\(max-width: 680px\)\s*\{\s*#continue_span\s*\{\s*position: absolute;\s*top: 16px;\s*\}\s*\}/,
    "the label moves to the top of the tile on mobile",
  );
  assert.match(css, /\.progress_bar\s*\{/);
  assert.match(css, /\.progress_bar>div\s*\{/);
  assert.match(css, /transform-origin: 0 0;/, "the bar fills from the left");
  assert.match(css, /#movie_options_settings_container\s*\{/);
});

test("the removed source label rules are not kept", () => {
  const css = read(PLAY_BTN_CSS);

  assert.equal(css.includes("#source_span"), false);
});

// ------------------------------------------------------------------ part A.6

const DISPLAY_PROP = /\b(title|alt|aria-label|buttonTitle|mediaTitle|label)\s*=\s*[\{"'`]/;
const ALLOWED_PATH = [/(^|\/)__tests__\//, /\.test\.tsx?$/, /app\/lib\/seo\//, /app\/lib\/search\/discovery/];
const ALLOWED_FILE = ["anilistUsers", "database.types", "mangadex.ts", "normalise.ts", "titles.ts"];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

test("no app source renders .romaji directly in JSX or a display prop", () => {
  const violations: string[] = [];

  for (const file of sourceFiles(join(ROOT, "app"))) {
    const relativePath = relative(ROOT, file).split("\\").join("/");

    if (ALLOWED_PATH.some((pattern) => pattern.test(relativePath))) continue;
    if (ALLOWED_FILE.some((name) => relativePath.endsWith(name))) continue;

    read(file)
      .split("\n")
      .forEach((line, index) => {
        if (!line.includes(".romaji")) return;
        if (line.includes("displayTitle")) return;

        // `title={...romaji}`, `alt={...romaji}`, and JSX children like `{media.title.romaji}`
        const isDisplayProp = DISPLAY_PROP.test(line);
        const isJsxChild = /^\s*\{.*\.romaji.*\}\s*$/.test(line);
        const isHeading = /upperCase\(\)/.test(line) && line.includes(".romaji");

        if (isDisplayProp || isJsxChild || isHeading) {
          violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
  }

  assert.deepEqual(violations, [], `romaji is rendered in these places:\n${violations.join("\n")}`);
});

test("the debug logging from part A is gone", () => {
  const cleaned = [
    "app/media/[id]/components/PageHeading/GridInfo/index.tsx",
    "app/layout/header/components/SearchFormContainer/components/SearchResultItemCard/index.tsx",
  ];

  for (const path of cleaned) {
    const source = read(join(ROOT, path));
    assert.equal(source.includes("console.log"), false, `${path} must not log startDate/endDate/title values`);
  }
});

test("the components that display titles all go through displayTitle", () => {
  const mustUseDisplayTitle = [
    "app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo/index.tsx",
    "app/my-lists/components/MediasContainer/index.tsx",
    "app/favourites/components/PlaylistItemsResults/index.tsx",
    "app/media/[id]/components/MediaRelatedContainer/index.tsx",
    "app/media/[id]/page.tsx",
    "app/media/[id]/components/PageHeading/GridInfo/index.tsx",
    "app/media/[id]/components/PageHeading/HeadingInfo/MediaTitleOrLogo.tsx",
    "app/layout/header/components/Notifications/index.tsx",
    "app/layout/header/components/SearchFormContainer/components/SearchResultItemCard/index.tsx",
    "app/components/HomePage/HeroCarouselHomePage/index.tsx",
    "app/components/MediaCards/MediaCard/index.tsx",
  ];

  for (const path of mustUseDisplayTitle) {
    const source = read(join(ROOT, path));
    assert.match(source, /displayTitle/, `${path} must use displayTitle`);
  }
});
