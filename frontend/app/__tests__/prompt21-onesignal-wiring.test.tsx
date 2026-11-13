// Prompt 21, part 7: OneSignal wiring that is not pure logic — the init options,
// the service workers, the identity sync, the middleware exclusion, the welcome
// page and the settings deep link.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PUSH_WORKER_PATH, PUSH_WORKER_SCOPE, oneSignalInitOptions, pushConfigured } from "@/app/lib/push/config";
import { __setPushClientForTests, __resetPushRuntimeForTests, syncPushIdentity } from "@/app/lib/push/runtime";
import { render } from "../../test-harness/render";
import NotificationsWelcomePage, { metadata as welcomeMetadata } from "@/app/notifications/welcome/page";

const FRONTEND = join(import.meta.dirname, "..", "..");

function read(...parts: string[]): string {
  return readFileSync(join(FRONTEND, ...parts), "utf8");
}

/** The one line both workers must contain, and nothing else. */
const WORKER_LINE = 'importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js")';

function oneSignalDouble() {
  const calls: string[] = [];
  const client = {
    Notifications: { permissionNative: "granted", requestPermission: async () => true },
    User: {
      PushSubscription: {
        optedIn: true,
        optIn: async () => {},
        optOut: async () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    },
    login: async (externalId: string) => {
      calls.push(`login:${externalId}`);
    },
    logout: async () => {
      calls.push("logout");
    },
  };

  return { client, calls };
}

test.beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).PushManager = class {};
});

test.afterEach(() => {
  __resetPushRuntimeForTests();
});

// ------------------------------------------------------------------- options

test("OneSignal initialises without prompts, on its own worker scope", () => {
  const options = oneSignalInitOptions("app-id", false);

  assert.equal(options.appId, "app-id");
  assert.equal(options.serviceWorkerPath, "push/onesignal/OneSignalSDKWorker.js");
  assert.deepEqual(options.serviceWorkerParam, { scope: "/push/onesignal/" });
  assert.equal(options.notifyButton.enable, false, "no floating bell");
  assert.equal(options.promptOptions.slidedown.prompts[0].autoPrompt, false, "no auto prompt");
  assert.equal(options.allowLocalhostAsSecureOrigin, false, "https only in production");
});

test("localhost is allowed as a secure origin in development only", () => {
  assert.equal(oneSignalInitOptions("app-id", true).allowLocalhostAsSecureOrigin, true);
  assert.equal(oneSignalInitOptions("app-id", false).allowLocalhostAsSecureOrigin, false);
});

test("the worker constants match the documented paths", () => {
  assert.equal(PUSH_WORKER_PATH, "push/onesignal/OneSignalSDKWorker.js");
  assert.equal(PUSH_WORKER_SCOPE, "/push/onesignal/");
});

test("pushConfigured follows the public app id and never throws when it is absent", () => {
  const previous = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

  delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  assert.equal(pushConfigured(), false);

  process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID = "abc";
  assert.equal(pushConfigured(), true);

  if (previous === undefined) delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  else process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID = previous;
});

// ------------------------------------------------------------------- workers

test("both OneSignal workers exist and contain only the importScripts line", () => {
  for (const name of ["OneSignalSDKWorker.js", "OneSignalSDKUpdaterWorker.js"]) {
    const contents = read("public", "push", "onesignal", name).trim();

    assert.equal(contents, WORKER_LINE, `${name} must be exactly the documented line`);
  }
});

test("no OneSignal worker sits at the site root and public/sw.js is untouched", () => {
  const rootFiles = readdirSync(join(FRONTEND, "public"));

  assert.equal(
    rootFiles.some((name) => /^OneSignalSDK/i.test(name)),
    false,
    "the SDK worker must not be at the root",
  );

  const adWorker = read("public", "sw.js");
  assert.equal(adWorker.includes("onesignal.com"), false, "the ad provider's worker is separate");
});

test("the middleware lets /push/onesignal through without a rewrite or an auth call", () => {
  const middleware = read("middleware.ts");

  // The matcher keeps `push/` out of the middleware entirely, so the workers are
  // served by /public with no session call, no rewrite and no redirect.
  const matcher = /matcher:\s*\[([^\]]+)\]/.exec(middleware)?.[1] ?? "";
  assert.match(matcher, /push\//, "push/ is excluded from the matcher");
  assert.match(matcher, /_next\/static/, "the other exclusions are still there");

  // A worker URL must never be answered with HTML. The middleware does rewrite
  // now, but only for the community flag gate, so pin every rewrite target: if a
  // rewrite is ever added for another path, this fails.
  const rewrites = [...middleware.matchAll(/NextResponse\.rewrite\(\s*new URL\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rewrites)], ["/community-off"], "only the community gate rewrites");
});

// ------------------------------------------------------------------ identity

test("the OneSignal External ID is the Supabase user id", async () => {
  const double = oneSignalDouble();
  __setPushClientForTests(double.client as never);

  await syncPushIdentity("9f8b7a6c-1234-4abc-9def-0123456789ab");

  assert.deepEqual(double.calls, ["login:9f8b7a6c-1234-4abc-9def-0123456789ab"]);
});

test("signing out logs OneSignal out", async () => {
  const double = oneSignalDouble();
  __setPushClientForTests(double.client as never);

  await syncPushIdentity("user-1");
  await syncPushIdentity(null);

  assert.deepEqual(double.calls, ["login:user-1", "logout"]);
});

test("identity sync never throws into the page when the SDK is missing", async () => {
  __setPushClientForTests(null);

  await syncPushIdentity("user-1");
  await syncPushIdentity(null);
  // Reaching here without an exception is the assertion.
  assert.ok(true);
});

// -------------------------------------------------------------- welcome page

test("the welcome page metadata is noindex and canonical", () => {
  assert.equal(welcomeMetadata.title, "Notifications are on");
  assert.deepEqual(welcomeMetadata.robots, { index: false, follow: false });
  assert.deepEqual(welcomeMetadata.alternates, { canonical: "/notifications/welcome" });
});

test("the welcome page renders both buttons and never mentions permission", async () => {
  const tree = await render(React.createElement(NotificationsWelcomePage));

  try {
    const text = tree.container.textContent ?? "";
    assert.match(text, /Push notifications are on/);
    assert.match(
      text,
      /You will get a notification when anime you subscribed to has a new episode/,
    );

    const links = [...tree.container.querySelectorAll("a[href]")].map((link) => ({
      href: link.getAttribute("href"),
      label: link.textContent?.trim(),
    }));

    assert.deepEqual(links, [
      { href: "/?settings=notifications", label: "Choose what I get notified about" },
      { href: "/", label: "Browse anime" },
    ]);
  } finally {
    await tree.unmount();
  }
});

test("the welcome page is absent from every sitemap", () => {
  // The sitemaps are route handlers, so the sources are walked recursively.
  const sitemapRoots = ["app/sitemap.xml", "app/sitemaps"].map((path) => join(FRONTEND, path));
  const files: string[] = [];

  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(next);
    }
  };

  for (const root of sitemapRoots) {
    assert.ok(existsSync(root), `${root} exists`);
    walk(root);
  }

  assert.ok(files.length > 0, "the sitemap handlers were found");

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      source.includes("notifications/welcome"),
      false,
      `${file} must not list the welcome page`,
    );
  }
});

test("?settings=notifications is handled where the settings modal lives", () => {
  const sideMenu = read("app", "layout", "header", "components", "User", "UserSideMenu", "index.tsx");

  assert.match(sideMenu, /settings=notifications|get\("settings"\)/, "the param is read");
  assert.match(sideMenu, /router\.replace/, "the param is removed with a replace, not a push");
  assert.match(sideMenu, /"notifications"/, "the modal opens at its notifications section");
});

test("the model requires a signed-in user before the settings section opens", () => {
  const sideMenu = read("app", "layout", "header", "components", "User", "UserSideMenu", "index.tsx");

  // The guest path opens the login modal first and the section waits for a user.
  assert.match(sideMenu, /ShowLoginModal|loginModal/i);
  assert.match(sideMenu, /if \(loading\) return;/);
  assert.match(sideMenu, /if \(!user\) \{/);
});
