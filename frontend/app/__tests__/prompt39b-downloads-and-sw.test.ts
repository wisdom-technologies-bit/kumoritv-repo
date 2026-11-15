// Prompt 39B Parts 2.2 and 3: the ad provider's service worker removes itself,
// nothing registers it any more, OneSignal is unaffected, and the download
// sponsor link stays empty and provider-agnostic.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { shouldOpenAd } from "@/app/lib/downloads/ad";
import { downloadAd } from "@/app/lib/downloads";

const root = process.cwd();

/** The slice of a service-worker event the stub touches. */
type WorkerEvent = { waitUntil?: (promise: Promise<unknown>) => void };
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules" || entry === ".next") continue;
      sourceFiles(path, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

// ------------------------------------------------------- the self-removing stub

test("public/sw.js is a stub that unregisters itself, and it has no fetch handler", async () => {
  const source = read("public/sw.js");
  const listeners: Record<string, (event: WorkerEvent) => unknown> = {};
  const calls = { skipWaiting: 0, unregistered: 0, cleared: [] as string[], navigated: [] as string[] };

  const context = {
    Promise,
    caches: {
      keys: async () => ["workbox-precache", "ad-cache"],
      delete: async (key: string) => {
        calls.cleared.push(key);
        return true;
      },
    },
    self: {
      addEventListener: (type: string, handler: (event: WorkerEvent) => unknown) => {
        listeners[type] = handler;
      },
      skipWaiting: () => {
        calls.skipWaiting += 1;
      },
      registration: {
        unregister: async () => {
          calls.unregistered += 1;
          return true;
        },
      },
      clients: {
        matchAll: async () => [
          { url: "https://kumoritv.top/watch/21", navigate: (url: string) => calls.navigated.push(url) },
          { url: "https://kumoritv.top/", navigate: (url: string) => calls.navigated.push(url) },
        ],
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  assert.deepEqual(Object.keys(listeners).sort(), ["activate", "install"], "no fetch handler");
  assert.equal(typeof listeners.install, "function");
  assert.equal(typeof listeners.activate, "function");

  listeners.install({});
  assert.equal(calls.skipWaiting, 1, "install takes over immediately");

  let waited: Promise<unknown> | undefined;
  listeners.activate({ waitUntil: (promise: Promise<unknown>) => (waited = promise) });
  await waited;

  assert.deepEqual(calls.cleared, ["workbox-precache", "ad-cache"], "its caches are deleted");
  assert.equal(calls.unregistered, 1, "the registration removes itself");
  assert.deepEqual(
    calls.navigated,
    ["https://kumoritv.top/watch/21", "https://kumoritv.top/"],
    "open windows are reloaded without a worker",
  );

  // and nothing of the old provider is left in it
  assert.ok(!/importScripts/.test(source));
  assert.ok(!/3nbf4|zoneId|domain\s*:/.test(source));
});

test("the stub survives a hostile environment: no caches, no clients, nothing throws", async () => {
  const source = read("public/sw.js");
  const listeners: Record<string, (event: WorkerEvent) => unknown> = {};
  const context = {
    Promise,
    caches: {
      keys: async () => {
        throw new Error("cache storage is blocked");
      },
      delete: async () => true,
    },
    self: {
      addEventListener: (type: string, handler: (event: WorkerEvent) => unknown) => {
        listeners[type] = handler;
      },
      skipWaiting: () => {},
      registration: {
        unregister: async () => {
          throw new Error("already unregistered");
        },
      },
      clients: {
        matchAll: async () => {
          throw new Error("no clients api");
        },
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  let waited: Promise<unknown> | undefined;
  listeners.activate({ waitUntil: (promise: Promise<unknown>) => (waited = promise) });
  await waited;
});

test("/sw.js is served with no-cache so browsers actually pick the stub up", () => {
  const config = read("next.config.mjs");
  const start = config.indexOf("source: '/sw.js'");

  assert.ok(start > -1, "next.config.mjs has a /sw.js header rule");
  const rule = config.slice(start, start + 500);
  assert.match(rule, /Cache-Control/);
  assert.match(rule, /no-cache/);
  assert.match(rule, /Service-Worker-Allowed', value: '\/'/);
  assert.ok(rule.indexOf("},") > rule.indexOf("no-cache"), "the header belongs to that rule");
});

test("nothing registers /sw.js any more, and the OneSignal worker is untouched", () => {
  for (const file of [...sourceFiles(join(root, "app")), join(root, "middleware.ts")]) {
    const contents = readFileSync(file, "utf8");
    assert.ok(
      !/serviceWorker\.register\(\s*["'`]\/?sw\.js/.test(contents),
      `${file.replace(root + "/", "")} must not register /sw.js`,
    );
    assert.ok(
      !/serviceWorker\.register\(\s*["'`]\/(?!push\/onesignal)/.test(contents),
      `${file.replace(root + "/", "")} must not register a root-scope worker`,
    );
  }

  // the push worker path and its two files are exactly as they were
  const config = read("app/lib/push/config.ts");
  assert.match(config, /PUSH_WORKER_PATH = "push\/onesignal\/OneSignalSDKWorker\.js"/);

  const worker = read("public/push/onesignal/OneSignalSDKWorker.js").trim();
  // pinned exactly as the file is: the OneSignal worker is not ours to restyle
  assert.equal(worker, 'importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js")');
  const updater = read("public/push/onesignal/OneSignalSDKUpdaterWorker.js").trim();
  assert.equal(updater, worker);

  // next to it, the stub is a different file with nothing OneSignal in it
  assert.ok(!read("public/sw.js").includes("onesignal.com"));
});

// ------------------------------------------------- the download sponsor link

test("the download sponsor link is empty by default and never hard-coded", () => {
  delete process.env.DOWNLOAD_AD_URL;

  assert.equal(downloadAd(), null, "no ad without DOWNLOAD_AD_URL");
  assert.equal(shouldOpenAd(null, Date.now(), 0), false);

  // a configured link is used exactly as given
  process.env.DOWNLOAD_AD_URL = "https://ads.example.com/click";
  try {
    assert.deepEqual(downloadAd(), { url: "https://ads.example.com/click", intervalMin: 30 });
  } finally {
    delete process.env.DOWNLOAD_AD_URL;
  }

  // no ad URL lives in the code, in either the download lib or the docs
  const adSource = read("app/lib/downloads/ad.ts");
  assert.ok(!/https?:\/\//.test(adSource), "ad.ts holds no URL of its own");
  assert.match(adSource, /Adcash direct-link or popunder URL/);
  assert.match(read(".env.example"), /DOWNLOAD_AD_URL=\n/);
  const envExample = read(".env.example");
  assert.match(envExample, /LEAVE THIS EMPTY until you have\s*\n?# ?an Adcash direct-link or popunder URL/);
  assert.ok(!/uplcm|12159\d{2}/.test(envExample), "the retired provider's link is not documented as usable");
});
