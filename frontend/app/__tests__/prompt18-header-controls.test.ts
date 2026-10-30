// Prompt 18 / Part 1: the header controls.
//
// The bug: SearchFormContainer rendered `className={styles.heading_btn}` while
// styles came from SearchFormContainer/component.module.css, which never defined
// `.heading_btn`. CSS Modules hash names per file, so the `button.heading_btn`
// rule in headerComponent.module.css could never apply and the button fell back
// to the browser default: a plain white square with no visible icon.
//
// These tests fail if ANY header component uses a `styles.<name>` its own module
// does not define, if the three controls stop sharing one real class, or if the
// sizing tokens drift at either breakpoint.

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const headerDir = path.join(root, "app/layout/header");

const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Every name a CSS Module actually exports: the class selectors and the id
 * selectors it declares. Anything else is `undefined` at runtime.
 */
function exportedNames(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set<string>();
  const pattern = /[.#]([A-Za-z_-][A-Za-z0-9_-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutComments)) !== null) names.add(match[1]!);
  return names;
}

const componentFiles = walk(headerDir).filter((file) => file.endsWith(".tsx"));

test("every styles.<name> a header component uses exists in its own CSS module", () => {
  assert.ok(componentFiles.length >= 5, "the header components were found");

  const problems: string[] = [];

  for (const file of componentFiles) {
    const source = fs.readFileSync(file, "utf8");
    const modules = [...source.matchAll(/from\s+["'](\.[^"']*\.module\.css)["']/g)].map((match) => match[1]!);
    const used = [...new Set([...source.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]!))];

    if (!modules.length) {
      assert.equal(used.length, 0, `${path.relative(root, file)} uses styles.* without importing a module`);
      continue;
    }

    for (const modulePath of modules) {
      const cssPath = path.join(path.dirname(file), modulePath);
      assert.ok(fs.existsSync(cssPath), `${path.relative(root, cssPath)} exists`);

      const defined = exportedNames(fs.readFileSync(cssPath, "utf8"));

      for (const name of used) {
        if (!defined.has(name)) {
          problems.push(`${path.relative(root, file)} -> ${modulePath} has no "${name}"`);
        }
      }
    }
  }

  assert.deepEqual(problems, [], `undefined CSS Module names:\n${problems.join("\n")}`);
});

test("no header component reaches for the removed heading_btn class", () => {
  const offenders = componentFiles.filter((file) => fs.readFileSync(file, "utf8").includes("styles.heading_btn"));

  assert.deepEqual(offenders.map((file) => path.relative(root, file)), []);
});

test("the shared header-icon-btn class is a real global rule, never a white box", () => {
  const globals = read("app/globals.css");
  const rule = globals.slice(globals.indexOf(".header-icon-btn {"));

  assert.ok(globals.includes(".header-icon-btn {"), "the global class exists");
  assert.match(rule, /background:\s*transparent/, "no background colour (the white square bug)");
  assert.match(rule, /background-color:\s*transparent/, "no background colour through the longhand either");
  assert.match(rule, /border:\s*none/, "no browser-default border");
  assert.match(rule, /border-radius:\s*50%/, "round");
  assert.match(rule, /width:\s*var\(--header-control-size/, "sized by the token");
  assert.match(rule, /height:\s*var\(--header-control-size/, "sized by the token");
  assert.match(rule, /width:\s*var\(--header-glyph-size/, "glyphs are sized by the token");

  assert.match(
    globals,
    /\.header-icon-btn:hover,\s*\n?\.header-icon-btn\[data-active="true"\]/,
    "one hover/active surface for every control",
  );
  assert.match(globals, /\.header-icon-btn:focus-visible/, "one focus ring for every control");
});

test("search toggle, bell and user button all use the shared class", () => {
  const search = read("app/layout/header/components/SearchFormContainer/index.tsx");
  const bell = read("app/layout/header/components/Notifications/index.tsx");
  const user = read("app/layout/header/components/User/UserSideMenu/index.tsx");

  // The toggle on the search button, not just anywhere in the file.
  assert.match(search, /<button[\s\S]{0,400}?className="header-icon-btn"/, "search toggle uses the shared class");
  assert.match(bell, /id=\{styles\.notification_btn\}\s*\n\s*className="header-icon-btn"/, "bell uses the shared class");
  assert.match(user, /className="header-icon-btn"/, "the login button uses the shared class");
  assert.match(user, /className=\{`header-icon-btn \$\{isUserMenuOpen/, "the avatar menu button uses the shared class");

  // Nothing may hard-code a light background back onto a control.
  for (const [name, source] of [
    ["search", search],
    ["notifications", bell],
    ["user", user],
  ] as const) {
    assert.equal(/heading_btn/.test(source), false, `${name} no longer uses heading_btn`);
  }
});

test("header sizing tokens: phones 30/48/26/40/4, desktop 32/44/24/40/8", () => {
  const css = read("app/layout/header/headerComponent.module.css");

  const desktop = css.slice(0, css.indexOf("@media (max-width: 640px)"));
  assert.match(desktop, /--header-wordmark-height:\s*32px/, "desktop wordmark is 32px");
  assert.match(desktop, /--header-control-size:\s*44px/, "desktop controls are 44px");
  assert.match(desktop, /--header-glyph-size:\s*24px/, "desktop glyphs are 24px");
  assert.match(desktop, /--header-avatar-size:\s*40px/, "desktop avatar is 40px");
  assert.match(desktop, /--header-control-gap:\s*8px/, "desktop gap is 8px");

  const phoneStart = css.indexOf("@media (max-width: 640px)");
  const phone = css.slice(phoneStart, css.indexOf("}", css.indexOf("--header-control-gap", phoneStart)) + 1);
  assert.match(phone, /--header-wordmark-height:\s*30px/, "phone wordmark is 30px");
  assert.match(phone, /--header-control-size:\s*48px/, "phone controls are 48px");
  assert.match(phone, /--header-glyph-size:\s*26px/, "phone glyphs are 26px");
  assert.match(phone, /--header-avatar-size:\s*40px/, "phone avatar is 40px");
  assert.match(phone, /--header-control-gap:\s*4px/, "phone gap is 4px");
});

test("nothing shrinks the controls below their token on 320-380px screens", () => {
  const css = read("app/layout/header/headerComponent.module.css");
  const narrow = css.slice(css.indexOf("@media (max-width: 380px)"));
  const narrowBlock = narrow.slice(0, narrow.indexOf("\n}"));

  // The 380px block must not re-declare smaller control/wordmark sizes.
  for (const token of ["--header-wordmark-height", "--header-control-size", "--header-glyph-size", "--header-avatar-size"]) {
    const declaration = narrowBlock.match(new RegExp(`${token}:\\s*(\\d+)px`));
    if (!declaration) continue;
    const expected = token.includes("control") ? 48 : token.includes("wordmark") ? 30 : token.includes("glyph") ? 26 : 40;
    assert.equal(Number(declaration[1]), expected, `${token} keeps its phone value at 320px`);
  }

  assert.match(narrow, /flex-wrap:\s*nowrap/, "the header row never wraps");
});

test("the two control groups are centred on one line and the badge stays inside the bell", () => {
  const headerCss = read("app/layout/header/headerComponent.module.css");
  const container = headerCss.slice(headerCss.indexOf("> div#container"));

  assert.match(container, /align-items:\s*center/, "search, bell and avatar share the wordmark's centre line");
  assert.match(container, /min-height:\s*var\(--header-min-height\)/, "one row height");

  assert.match(
    headerCss.slice(headerCss.indexOf("#user_and_search_container {")),
    /gap:\s*var\(--header-control-gap\)/,
    "the right group uses the gap token",
  );

  const notifications = read("app/layout/header/components/Notifications/component.module.css");
  assert.match(notifications, /#notification_container \{[^}]*flex:\s*0 0 auto/, "the bell box is the control box");

  const badge = notifications.slice(notifications.indexOf("span#notifications_badge {"));
  assert.match(badge, /position:\s*absolute/, "the badge is positioned inside the bell");
  assert.match(badge, /right:\s*\d+px/, "the badge is anchored inside the bell box, not over the avatar");
});
