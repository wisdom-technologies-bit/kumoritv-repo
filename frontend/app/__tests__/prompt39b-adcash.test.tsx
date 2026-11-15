// Prompt 39B Part 2: the Adcash Autotag is the only ad tag on the site.
//
// These tests pin the behaviour that matters operationally: with the flag off
// nothing exists, on an excluded path nothing exists, with it on there is exactly
// one library script and exactly one Autotag call, a broken library throws
// nothing, and the retired provider is gone from the code surfaces entirely.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../test-harness/render";
import AdcashTag from "@/app/components/Ads/AdcashTag";
import {
  ADCASH_DEFAULT_EXCLUDE_PATHS,
  ADCASH_DEFAULT_ZONE_ID,
  ADCASH_SCRIPT_ID,
  ADCASH_SCRIPT_SRC,
  adcashExcludePathsFrom,
  adcashZoneIdFrom,
  adcashAutoTagStarted,
  isAdcashExcludedPath,
  readAdcashConfig,
  resetAdcashForTests,
  runAdcashAutoTag,
} from "@/app/lib/ads/adcash";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

type Nav = { __searchTestNavigation?: { pathname?: string } };
const nav = globalThis as unknown as Nav;

/** Every `<script id="aclib">` currently in the document. */
const aclibScripts = () =>
  Array.from(document.querySelectorAll(`script#${ADCASH_SCRIPT_ID}`));

const tag = (props: Partial<React.ComponentProps<typeof AdcashTag>> = {}) => (
  <AdcashTag
    enabled
    zoneId={ADCASH_DEFAULT_ZONE_ID}
    excludePaths={ADCASH_DEFAULT_EXCLUDE_PATHS}
    {...props}
  />
);

// ------------------------------------------------------------- the constants

test("the snippet's two steps are the official ones", () => {
  assert.equal(ADCASH_SCRIPT_ID, "aclib");
  // https, never the protocol-relative `//acscdn.com/...` form from the snippet
  assert.equal(ADCASH_SCRIPT_SRC, "https://acscdn.com/script/aclib.js");
  assert.equal(ADCASH_DEFAULT_ZONE_ID, "wdslld7xas");
  assert.deepEqual(ADCASH_DEFAULT_EXCLUDE_PATHS, [
    "/admin",
    "/api",
    "/community-off",
    "/notifications/welcome",
  ]);
});

test("the env defaults keep advertising off and the zone id out of components", () => {
  const empty = readAdcashConfig(() => undefined);
  assert.equal(empty.enabled, false, "ADCASH_ENABLED unset means off");
  assert.equal(empty.zoneId, "wdslld7xas", "empty zone falls back to the owner's");
  assert.deepEqual(empty.excludePaths, ADCASH_DEFAULT_EXCLUDE_PATHS);

  for (const raw of ["0", "", "no", "off", " "]) {
    assert.equal(
      readAdcashConfig((name: string) => (name === "ADCASH_ENABLED" ? raw : undefined)).enabled,
      false,
      `${JSON.stringify(raw)} keeps ads off`,
    );
  }
  for (const raw of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(
      readAdcashConfig((name: string) => (name === "ADCASH_ENABLED" ? raw : undefined)).enabled,
      true,
      `${raw} turns ads on`,
    );
  }

  assert.equal(adcashZoneIdFrom("  z0ne9 "), "z0ne9");
  assert.equal(adcashZoneIdFrom(""), "wdslld7xas");
  assert.deepEqual(adcashExcludePathsFrom("/a, /b ,"), ["/a", "/b"]);
  assert.deepEqual(adcashExcludePathsFrom(""), ADCASH_DEFAULT_EXCLUDE_PATHS);

  // the zone id lives in the lib, never in the component or the layout
  assert.ok(!read("app/components/Ads/AdcashTag.tsx").includes("wdslld7xas"));
  assert.ok(!read("app/layout.tsx").includes("wdslld7xas"));
});

test("excluded paths match by prefix and never by accident", () => {
  const list = ADCASH_DEFAULT_EXCLUDE_PATHS;
  assert.equal(isAdcashExcludedPath("/admin", list), true);
  assert.equal(isAdcashExcludedPath("/admin/users", list), true);
  assert.equal(isAdcashExcludedPath("/admin/users/", list), true, "trailing slash");
  assert.equal(isAdcashExcludedPath("/ADMIN", list), true, "case does not matter");
  assert.equal(isAdcashExcludedPath("/admin-tools", list), false, "not a sibling");
  assert.equal(isAdcashExcludedPath("/api/cron/status", list), true);
  assert.equal(isAdcashExcludedPath("/community-off", list), true);
  assert.equal(isAdcashExcludedPath("/notifications/welcome", list), true);
  assert.equal(isAdcashExcludedPath("/", list), false);
  assert.equal(isAdcashExcludedPath("/watch/1", list), false);
  assert.equal(isAdcashExcludedPath("", list), false);
  assert.equal(isAdcashExcludedPath(null, list), false);
});

// ------------------------------------------------------------- the component

test("nothing renders while ADCASH_ENABLED is 0", async () => {
  const before = aclibScripts().length;
  const tree = await render(tag({ enabled: false }));

  try {
    assert.equal(aclibScripts().length, before, "no aclib element at all");
    assert.ok(!tree.container.innerHTML.includes("acscdn"), "no ad markup in the page");
  } finally {
    await tree.unmount();
  }
});

test("nothing renders on an excluded path", async () => {
  const previous = nav.__searchTestNavigation;
  nav.__searchTestNavigation = { pathname: "/admin" };
  const before = aclibScripts().length;
  const tree = await render(tag());

  try {
    assert.equal(aclibScripts().length, before, "the tag is not rendered on /admin");
  } finally {
    await tree.unmount();
    nav.__searchTestNavigation = previous;
  }
});

test("one page load gets exactly one aclib script, and the page still renders", async () => {
  const previous = nav.__searchTestNavigation;
  nav.__searchTestNavigation = { pathname: "/watch/21" };
  const before = aclibScripts().length;
  const tree = await render(
    <div>
      <p id="page-content">Watch page</p>
      {tag()}
    </div>,
  );

  try {
    const scripts = aclibScripts();
    assert.equal(scripts.length, before + 1, "exactly one aclib element");
    const script = scripts[scripts.length - 1];
    assert.equal(script.getAttribute("src"), ADCASH_SCRIPT_SRC);
    assert.equal(script.getAttribute("type"), "text/javascript");
    // the page's own content is untouched by the tag
    assert.equal(tree.container.querySelector("#page-content")?.textContent, "Watch page");
  } finally {
    await tree.unmount();
    nav.__searchTestNavigation = previous;
  }
});

// ------------------------------------------------------------- the one call

test("runAutoTag is called once with the zone id, whoever fires it", () => {
  resetAdcashForTests();
  const calls: Array<{ zoneId?: string }> = [];
  const fake = {
    aclib: {
      runAutoTag(options: { zoneId: string }) {
        calls.push(options);
      },
    },
  };

  assert.equal(runAdcashAutoTag("wdslld7xas", fake), true);
  // onLoad and onReady both fire on a real page; strict mode fires effects twice
  assert.equal(runAdcashAutoTag("wdslld7xas", fake), false);
  assert.equal(runAdcashAutoTag("wdslld7xas", fake), false);

  assert.deepEqual(calls, [{ zoneId: "wdslld7xas" }], "one Autotag, with the zone");
  assert.equal(adcashAutoTagStarted(), true);
  resetAdcashForTests();
});

test("a missing or broken library never throws into the page", () => {
  resetAdcashForTests();
  assert.equal(runAdcashAutoTag("wdslld7xas", {}), false, "no aclib");
  assert.equal(runAdcashAutoTag("wdslld7xas", { aclib: {} }), false, "no runAutoTag");
  assert.equal(
    runAdcashAutoTag("wdslld7xas", { aclib: { runAutoTag: "not a function" as never } }),
    false,
  );
  const throwing = {
    aclib: {
      runAutoTag() {
        throw new Error("adblock or network failure");
      },
    },
  };
  assert.equal(runAdcashAutoTag("wdslld7xas", throwing), false, "a throw is swallowed");

  // and the real window is empty here, so nothing happens either
  resetAdcashForTests();
  assert.equal(runAdcashAutoTag("wdslld7xas"), false);
});

test("the tag asks for the library only after hydration, never before", () => {
  const component = read("app/components/Ads/AdcashTag.tsx");
  assert.match(component, /strategy="afterInteractive"/);
  assert.ok(
    !component.includes('strategy="beforeInteractive"'),
    "beforeInteractive is not workable in a nested client component",
  );
  assert.match(component, /onReady=\{run\}/);
  assert.match(component, /onLoad=\{run\}/);
  assert.match(component, /"use client"/);
});

test("the root layout renders the tag and no other third-party ad script", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /<AdcashTag/);
  assert.match(layout, /readAdcashConfig\(\(name\) => process\.env\[name\]\)/);
  assert.ok(!/al5sm|acscdn\/(?!script)/.test(layout), "no ad URL is hard-coded in the layout");
  // the only dangerouslySetInnerHTML left in the app is our JSON-LD
  assert.ok(!layout.includes("dangerouslySetInnerHTML"));
});

// ------------------------------------------------- the retired provider is gone

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules" || entry === ".next") continue;
      filesUnder(path, out);
    } else if (/\.(ts|tsx|js|mjs|css|md|json|txt|example|xml)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

test("no trace of the retired ad provider is left in the shipped code", () => {
  const forbidden = [
    /monetag/i,
    /propeller(ads)?/i,
    /pushsdk/i,
    /onclckmn/i,
    /alwingulla/i,
    /nap5k/i,
    /inklinkor/i,
    /5gvci/i,
    /gizokraijaw/i,
    /data-zone/i,
    /data-cfasync/i,
    /al5sm\.com/i,
    /3nbf4\.com/i,
    /uplcm\.com/i,
    /12159\d{2}/,
  ];

  const files = [
    ...filesUnder(join(root, "app")),
    ...filesUnder(join(root, "public")),
    join(root, "middleware.ts"),
    join(root, "next.config.mjs"),
    join(root, ".env.example"),
  ];

  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(contents),
        `${file.replace(root + "/", "")} still matches ${pattern} (see docs/ads-adcash.md)`,
      );
    }
  }
});

test("the docs record still names what was removed, so it stays recognisable", () => {
  const docs = read("docs/ads-adcash.md");
  for (const needle of ["al5sm.com", "3nbf4.com", "12159142", "uplcm.com/4/12159130", "b1ac348"]) {
    assert.ok(docs.includes(needle), `docs/ads-adcash.md must record ${needle}`);
  }
  assert.match(docs, /2027-01-14/, "the date the sw.js stub may be deleted");
});
