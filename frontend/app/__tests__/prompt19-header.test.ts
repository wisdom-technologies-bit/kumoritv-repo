import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

const GLOBALS = read("app/globals.css");
const HEADER_CSS = read("app/layout/header/headerComponent.module.css");
const HEADER_TSX = read("app/layout/header/index.tsx");
const USER_CSS = read("app/layout/header/components/User/UserSideMenu/component.module.css");
const USER_TSX = read("app/layout/header/components/User/UserSideMenu/index.tsx");
const NOTIF_CSS = read("app/layout/header/components/Notifications/component.module.css");
const SEARCH_CSS = read("app/layout/header/components/SearchFormContainer/component.module.css");
const SEARCH_TSX = read("app/layout/header/components/SearchFormContainer/index.tsx");
const CARD_CSS = read(
  "app/layout/header/components/SearchFormContainer/components/SearchResultItemCard/component.module.css",
);
const CARD_TSX = read(
  "app/layout/header/components/SearchFormContainer/components/SearchResultItemCard/index.tsx",
);

/** The body of the first rule whose selector list contains `selector`. */
function ruleBody(css: string, selector: string): string {
  const index = css.indexOf(selector);
  assert.notEqual(index, -1, `${selector} should exist`);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/** Every selector block in the file, as { selector, body }. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css))) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

/** CSS specificity as [ids, classes/attrs/pseudo-classes, elements]. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) || []).length +
    (selector.match(/\[[^\]]+\]/g) || []).length +
    (selector.match(/:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  const elements =
    (selector.match(/(^|[\s>+~(])([a-z][\w-]*)/gi) || []).length +
    (selector.match(/::[\w-]+/g) || []).length;
  return [ids, classes, elements];
}

const beats = (a: [number, number, number], b: [number, number, number]) =>
  a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));

/** The strongest selector in a comma-separated list. */
function strongest(selectorList: string): [number, number, number] {
  const all = selectorList
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(specificity);
  return all.sort((a, b) => (beats(a, b) ? -1 : beats(b, a) ? 1 : 0))[0] ?? [0, 0, 0];
}

/** CSS with /* … *\/ comments removed, so prose cannot satisfy a rule check. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * True when the file still carries a blanket `header#background a` display rule:
 * the rule that outranked the notification pill and the search panel links.
 */
function hasBlanketHeaderAnchorRule(css: string): boolean {
  return rules(withoutComments(css)).some(
    (rule) =>
      rule.selector
        .split(",")
        .map((part) => part.trim().replace(/\s+/g, " "))
        .some((part) => part === "header#background a") && /display:\s*block/.test(rule.body),
  );
}

// ------------------------------------------------------------------ part 1a

test("touch devices get no painted disc, only the accent glyph", () => {
  const touchStart = GLOBALS.indexOf("@media (hover: none)");
  assert.notEqual(touchStart, -1, "there is a (hover: none) block");
  const touch = GLOBALS.slice(touchStart, GLOBALS.indexOf("\n}", touchStart) + 2);

  assert.match(touch, /background-color:\s*transparent/, "no background on touch");
  assert.match(touch, /fill:\s*var\(--brand-color\)/, "the glyph takes the accent colour");
  assert.match(touch, /\[data-active="true"\]/, "the active state is covered too");
});

test("hover-capable pointers get a 40px rounded-square surface, not a disc", () => {
  const hoverStart = GLOBALS.indexOf("@media (hover: hover)");
  assert.notEqual(hoverStart, -1, "there is a (hover: hover) block");
  const hover = GLOBALS.slice(hoverStart, GLOBALS.indexOf("@media (hover: none)", hoverStart));

  assert.match(hover, /\.header-icon-btn:hover::before/, "the surface only appears on hover");
  assert.match(hover, /background-color:\s*var\(--header-hover-surface/, "the ::before box is painted");
  assert.match(
    hover,
    /\.header-icon-btn:hover,\s*\n\s*\.header-icon-btn\[data-active="true"\] \{[\s\S]*?background-color:\s*transparent/,
    "the button itself stays transparent",
  );

  const before = ruleBody(GLOBALS, ".header-icon-btn::before {");
  assert.match(before, /width:\s*40px/, "the surface is a 40px pseudo element");
  assert.match(before, /height:\s*40px/);
  assert.match(before, /border-radius:\s*10px/, "a rounded square, not a circle");
  assert.match(before, /pointer-events:\s*none/);
});

test("the control box is a 44px tap target with a 24px glyph", () => {
  const button = ruleBody(GLOBALS, ".header-icon-btn {");
  assert.match(button, /width:\s*var\(--header-control-size,\s*44px\)/);
  assert.match(button, /height:\s*var\(--header-control-size,\s*44px\)/);

  const glyph = ruleBody(GLOBALS, ".header-icon-btn > svg,");
  assert.match(glyph, /width:\s*var\(--header-glyph-size,\s*24px\)/);
  assert.match(glyph, /height:\s*var\(--header-glyph-size,\s*24px\)/);
});

test("the header module no longer paints an active background disc", () => {
  const disc = /header#background\s+\.header-icon-btn\[data-active="true"\]\s*\{[^}]*background-color:\s*var\(--header-hover-surface\)/;
  assert.equal(disc.test(HEADER_CSS), false, "the disc rule is gone");
  const notif = /#notification_btn\[data-active="true"\]\s*\{[^}]*background-color:\s*var\(--header-hover-surface\)/;
  assert.equal(notif.test(NOTIF_CSS), false, "the bell does not repaint the disc");
});

// ------------------------------------------------------------------ part 1b

test("the right group is one flex row with a 4px/8px gap and never wraps", () => {
  const row = ruleBody(HEADER_CSS, "#user_and_search_container {");
  assert.match(row, /display:\s*flex/);
  assert.match(row, /align-items:\s*center/);
  assert.match(row, /gap:\s*var\(--header-control-gap\)/);
  assert.match(row, /flex-wrap:\s*nowrap|flex-direction:\s*row/);

  assert.match(HEADER_CSS, /--header-control-gap:\s*8px/, "8px on desktop");
  const phone = HEADER_CSS.slice(HEADER_CSS.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /--header-control-gap:\s*4px/, "4px on phones");
});

test("avatar and chevron are ONE button, 36px + 16px, 4px apart, 44px tall", () => {
  const button = ruleBody(USER_CSS, "#user_container #user_btn {");
  assert.match(button, /display:\s*inline-flex/);
  assert.match(button, /gap:\s*0 var\(--header-avatar-gap,\s*4px\)/);
  assert.match(button, /height:\s*var\(--header-control-size,\s*44px\)/);

  assert.match(HEADER_CSS, /--header-avatar-size:\s*36px/);
  assert.match(HEADER_CSS, /--header-chevron-size:\s*16px/);
  assert.match(HEADER_CSS, /--header-avatar-gap:\s*4px/);

  // Both live inside the single button element.
  const buttonMarkup = USER_TSX.slice(USER_TSX.indexOf("user_btn"));
  assert.match(USER_TSX, /id=\{styles\.user_btn\}/, "there is one user button");
  assert.match(USER_TSX, /styles\.chevron_icon|ChevronBetter|scale/, "the chevron sits in that button");
  assert.ok(buttonMarkup.length > 0);
});

// ------------------------------------------------------------------ part 1c

test("logged out the Login control is a 36px pill with a centred icon and label", () => {
  const pill = ruleBody(USER_CSS, "#user_container #user_btn[data-useractive=false] {");

  assert.match(pill, /display:\s*inline-flex/);
  assert.match(pill, /align-items:\s*center/);
  assert.match(pill, /gap:\s*6px/);
  assert.match(pill, /height:\s*36px/);
  assert.match(pill, /padding:\s*0 14px/);
  assert.match(pill, /border:\s*1px solid var\(--white-25\)/);
  assert.match(pill, /border-radius:\s*999px/);

  const icon = ruleBody(USER_CSS, "#user_container #user_btn > svg.scale {");
  assert.match(icon, /width:\s*20px/);
  assert.match(icon, /height:\s*20px/);

  const label = ruleBody(USER_CSS, "#user_container #user_btn[data-useractive=false] span {");
  assert.match(label, /font-size:\s*14px/);
  assert.match(label, /line-height:\s*1/);
  assert.match(label, /font-weight:\s*500/);
  assert.match(label, /align-items:\s*center/);
});

// ------------------------------------------------------------------ part 1d/1e

test("the wordmark stays 28px on phones and the row is centred on it", () => {
  const phone = HEADER_CSS.slice(HEADER_CSS.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /--header-wordmark-height:\s*28px/);

  const narrow = HEADER_CSS.slice(HEADER_CSS.indexOf("@media (max-width: 380px)"));
  assert.match(narrow.slice(0, 400), /--header-wordmark-height:\s*28px/, "320px keeps 28px");

  assert.match(ruleBody(HEADER_CSS, "header#background > div#container {"), /align-items:\s*center/);
});

test("the open-search close button replaces the search glyph in place", () => {
  // Same element, same slot: only the glyph swaps, so the X never jumps.
  assert.match(SEARCH_TSX, /isMobileInputOpen \? \(\s*<CloseSvg/, "the glyph swaps with the state");
  assert.match(SEARCH_TSX, /<SearchIcon/, "the closed state keeps the search glyph");

  const toggle = ruleBody(GLOBALS, ".header-icon-btn {");
  assert.match(
    toggle,
    /width:\s*var\(--header-control-size,\s*44px\)/,
    "the X keeps the search button's size",
  );

  assert.match(SEARCH_CSS, /left:\s*12px/, "the pill keeps 12px side margins");
  assert.match(SEARCH_CSS, /right:\s*12px/);
});

// ------------------------------------------------------------------ part 1f

test("the bell badge hugs the top-right corner of the bell", () => {
  const badge = ruleBody(NOTIF_CSS, "span#notifications_badge {");
  assert.match(badge, /top:\s*0/);
  assert.match(badge, /right:\s*0/);
  assert.match(badge, /min-width:\s*18px/);
  assert.match(badge, /height:\s*18px/);
  assert.match(badge, /position:\s*absolute/);
});

// ------------------------------------------------------------------ part 1g

test("the blanket `header#background a { display: block }` is gone", () => {
  assert.equal(hasBlanketHeaderAnchorRule(HEADER_CSS), false, "no blanket anchor rule is left");

  // What replaced it is scoped to the header's own chrome.
  assert.match(
    HEADER_CSS,
    /header#background #menu_and_logo_container > a#img_container/,
    "the logo keeps an explicit display",
  );
  assert.match(HEADER_CSS, /header#background #navbar_container > ul > li > a/);
});

test("no header link relies on a removed blanket display rule", () => {
  for (const [name, file] of [
    ["logo container", HEADER_CSS],
    ["user menu", USER_CSS],
    ["notifications", NOTIF_CSS],
    ["search panel", SEARCH_CSS],
    ["result card", CARD_CSS],
  ] as const) {
    assert.equal(hasBlanketHeaderAnchorRule(file), false, `${name} does not restate the blanket rule`);
  }

  assert.match(USER_CSS, /#user_container > #user_menu_list ul li > a \{[^}]*display:\s*flex/);
  assert.match(
    read("app/layout/header/components/AnimeNavListHover/component.module.css"),
    /#anime_header_nav_container > li > div li > a \{[^}]*display:\s*flex/,
  );
  const mangaCss = read("app/layout/header/components/MangaNavListHover/component.module.css");
  assert.match(mangaCss, /#manga_header_nav_container > li > div li > a,/, "the link selector is scoped");
  assert.match(
    mangaCss.slice(mangaCss.indexOf("#manga_header_nav_container > li > div li > a,")),
    /^[^{]*\{[^}]*display:\s*flex/,
    "the scoped block gives the links their flex layout",
  );
});

// ------------------------------------------------------------------ part 2

test("the notification Watch now pill is a 36px centred inline-flex pill", () => {
  const pill = ruleBody(
    NOTIF_CSS,
    "#notification_container .notification_item_container .watch_link,",
  );

  assert.match(pill, /display:\s*inline-flex/);
  assert.match(pill, /align-items:\s*center/);
  assert.match(pill, /justify-content:\s*center/);
  assert.match(pill, /height:\s*36px/);
  assert.match(pill, /padding:\s*0 16px/);
  assert.match(pill, /line-height:\s*1/);
  assert.match(pill, /font-size:\s*14px/);
  assert.match(pill, /border-radius:\s*999px/);
  assert.match(pill, /width:\s*auto/);
  assert.match(pill, /margin-top:\s*8px/);
  assert.match(pill, /align-self:\s*flex-start/);
});

test("every rule that styles the pill outranks a plain header anchor rule", () => {
  // The blanket `header#background a { display: block }` is gone, so nothing in
  // the header can outrank the pill's own display/centring any more.
  assert.equal(hasBlanketHeaderAnchorRule(HEADER_CSS), false);

  const pillRules = rules(withoutComments(NOTIF_CSS)).filter((rule) => /watch_link/.test(rule.selector));
  assert.ok(pillRules.length > 0);

  for (const rule of pillRules) {
    // Stronger than `header a` (0,0,2) and stronger than any single-class rule.
    assert.ok(beats(strongest(rule.selector), [0, 0, 2]), `${rule.selector} beats an element rule`);
    assert.ok(beats(strongest(rule.selector), [0, 1, 0]), `${rule.selector} beats one class`);
  }

  const layout = pillRules.find((rule) => /display:\s*inline-flex/.test(rule.body))!;
  assert.ok(strongest(layout.selector)[0] >= 1, "the layout rule is id-scoped so it cannot be undercut");
});

// ------------------------------------------------------------------ part 2B

test("a search row is a horizontal flex row with a 56x80 cover on the left", () => {
  const row = ruleBody(CARD_CSS, ".result_link.result_link {");

  assert.match(row, /display:\s*flex/);
  assert.match(row, /flex-direction:\s*row/);
  assert.match(row, /align-items:\s*center/);
  assert.match(row, /gap:\s*12px/);
  assert.match(row, /padding:\s*10px 12px/);

  const cover = ruleBody(CARD_CSS, ".cover_container {");
  assert.match(cover, /flex:\s*0 0 56px/);
  assert.match(cover, /width:\s*56px/);
  assert.match(cover, /height:\s*80px/);
  assert.match(cover, /border-radius:\s*8px/);
  assert.match(ruleBody(CARD_CSS, ".cover_container img {"), /object-fit:\s*cover/);
});

test("the result text block clamps the title and ellipsises the meta line", () => {
  const info = ruleBody(CARD_CSS, ".result_info_container {");
  assert.match(info, /min-width:\s*0/);

  const title = ruleBody(CARD_CSS, ".result_title {");
  assert.match(title, /-webkit-line-clamp:\s*2/);
  assert.match(title, /font-size:\s*16px/);
  assert.match(title, /font-weight:\s*600/);
  assert.match(title, /line-height:\s*1\.25/);
  assert.match(title, /text-transform:\s*none/);

  const meta = ruleBody(CARD_CSS, ".result_meta {");
  assert.match(meta, /font-size:\s*13px/);
  assert.match(meta, /white-space:\s*nowrap/);
  assert.match(meta, /text-overflow:\s*ellipsis/);
});

test("the ANIME tag is a small inline pill that never stretches", () => {
  const tag = ruleBody(CARD_CSS, ".type_tag {");
  assert.match(tag, /height:\s*22px/);
  assert.match(tag, /padding:\s*0 8px/);
  assert.match(tag, /font-size:\s*11px/);
  assert.match(tag, /text-transform:\s*uppercase/);
  assert.match(tag, /letter-spacing:\s*0\.04em/);
  assert.match(tag, /flex:\s*0 0 auto/);

  const metaRow = ruleBody(CARD_CSS, ".result_meta_row {");
  assert.match(metaRow, /display:\s*flex/);
  assert.match(metaRow, /justify-content:\s*flex-start/);
});

test("the row hover, active and focus states use the header surfaces", () => {
  assert.match(CARD_CSS, /\.result_link:hover,[\s\S]{0,200}background:\s*var\(--white-05\)/);
  assert.match(CARD_CSS, /border-color:\s*var\(--white-25\)/);
  assert.match(CARD_CSS, /\.result_link:focus-visible\s*\{[\s\S]{0,80}box-shadow/);
});

test("the See all results link is a centred 44px pill in a sticky footer", () => {
  const link = ruleBody(SEARCH_CSS, ".see_all_link.see_all_link {");

  assert.match(link, /display:\s*inline-flex/);
  assert.match(link, /align-items:\s*center/);
  assert.match(link, /justify-content:\s*center/);
  assert.match(link, /width:\s*100%/);
  assert.match(link, /height:\s*44px/);
  assert.match(link, /padding:\s*0 16px/);
  assert.match(link, /border-radius:\s*999px/);
  assert.match(link, /border:\s*1px solid var\(--white-25\)/);
  assert.match(link, /font-size:\s*14px/);
  assert.match(link, /line-height:\s*1/);
  assert.match(link, /font-weight:\s*500/);
  assert.match(link, /text-overflow:\s*ellipsis/);

  const footer = ruleBody(SEARCH_CSS, ".results_footer {");
  assert.match(footer, /position:\s*sticky/);
  assert.match(footer, /bottom:\s*0/);
  assert.match(footer, /background:\s*var\(--background\)/);
  assert.match(footer, /padding:\s*8px/);

  assert.match(ruleBody(SEARCH_CSS, ".see_all_label {"), /text-overflow:\s*ellipsis/);
  assert.match(SEARCH_TSX, /styles\.results_footer/, "the link sits in that footer");
});

test("the results panel is opaque, scrollable, capped and above page content", () => {
  const panel = ruleBody(SEARCH_CSS, "#search_results_container {");

  assert.match(
    panel,
    /max-height:\s*calc\(100dvh - var\(--header-min-height,\s*64px\) - 96px\)/,
  );
  assert.match(panel, /overflow-y:\s*auto/);
  assert.match(panel, /overscroll-behavior:\s*contain/);
  assert.match(panel, /background:\s*var\(--background\)/);
  assert.match(panel, /border:\s*1px solid var\(--white-25\)/);
  assert.match(panel, /border-radius:\s*16px/);
  // Prompt 31: stacking is a documented token scale, not a bare number.
  assert.match(
    panel,
    /z-index:\s*var\(--z-header-popover\)/,
    "the panel sits above the hero and trailer blocks",
  );
  assert.match(panel, /left:\s*12px/);
  assert.match(panel, /right:\s*12px/);
});

test("the scroll position resets when the query changes", () => {
  assert.match(SEARCH_TSX, /panelRef\.current/, "the panel ref is used");
  assert.match(SEARCH_TSX, /scrollTop = 0/);
  assert.match(SEARCH_TSX, /\}, \[trimmedQuery\]\)/, "it resets on query change");
});

test("result card and see-all rules outrank any header anchor rule", () => {
  assert.equal(hasBlanketHeaderAnchorRule(HEADER_CSS), false, "the blanket rule no longer exists");

  for (const [file, name, selectorPattern, expectedSelector] of [
    [CARD_CSS, "result row", /result_link/, /^\.result_link\.result_link$/],
    [SEARCH_CSS, "see all link", /see_all_link/, /^\.see_all_link\.see_all_link$/],
  ] as const) {
    const targets = rules(withoutComments(file)).filter((rule) => selectorPattern.test(rule.selector));
    assert.ok(targets.length > 0, `${name} has rules`);

    // The layout rule with the display/centring is doubled up so no descendant
    // element selector in the header can beat it, even if one is reintroduced.
    const layout = targets.find(
      (rule) => selectorPattern.test(rule.selector) && /display:\s*(inline-)?flex/.test(rule.body),
    );
    assert.ok(layout, `${name} has a flex layout rule`);

    const parts = layout!.selector.split(",").map((part) => part.trim());
    assert.ok(
      parts.some((part) => expectedSelector.test(part)),
      `${name} layout rule is doubled: ${layout!.selector}`,
    );

    for (const part of parts) {
      assert.ok(beats(specificity(part), [0, 0, 2]), `${part} beats an element-descendant rule`);
      assert.ok(beats(specificity(part), [0, 1, 0]), `${part} beats one class`);
    }
  }
});

test("the result card markup puts the tag next to the meta", () => {
  assert.match(CARD_TSX, /styles\.result_meta_row/, "one row holds tag and meta");
  assert.match(CARD_TSX, /styles\.type_tag/);
  assert.match(CARD_TSX, /styles\.cover_container/);
  assert.doesNotMatch(CARD_TSX, /styles\.result_container[\s\S]{0,80}<\/span>\s*\{mediaType/);
});
