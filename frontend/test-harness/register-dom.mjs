// Preloaded with `--import` by the component tests. Installs a jsdom document so
// React can render client components under node, then stubs the browser-only
// modules (assets, next/image, framer-motion, Supabase browser client + session).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Module = require("node:module");
const React = require("react");

// --- browser document -------------------------------------------------------
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000/",
  pretendToBeVisual: true,
});

// jsdom's requestAnimationFrame runs a 16ms setInterval that keeps the node event
// loop alive forever once a library schedules a frame (vidstack does this at
// import time). An unref'd timer still fires but never blocks process exit.
const rafTimer = (callback) => {
  const handle = setTimeout(() => callback(Date.now()), 16);
  handle.unref?.();
  return handle;
};
dom.window.requestAnimationFrame = rafTimer;
dom.window.cancelAnimationFrame = (handle) => clearTimeout(handle);

// jsdom cannot navigate and its `location` is unforgeable, so the global `window`
// is a thin proxy that hands out a plain location object instead. Everything else
// is the real jsdom window (methods keep their own `this`).
const locationStub = {
  href: "http://localhost:3000/",
  origin: "http://localhost:3000",
  protocol: "http:",
  host: "localhost:3000",
  hostname: "localhost",
  port: "3000",
  pathname: "/",
  search: "",
  hash: "",
  assign(url) {
    this.href = url;
  },
  replace(url) {
    this.href = url;
  },
  reload() {},
  toString() {
    return this.href;
  },
};

const windowProxy = new Proxy(dom.window, {
  get(target, property) {
    if (property === "location") return locationStub;
    const value = Reflect.get(target, property, target);
    if (typeof value === "function" && !Object.prototype.hasOwnProperty.call(value, "prototype")) {
      return value.bind(target);
    }
    return value;
  },
  set(target, property, value) {
    return Reflect.set(target, property, value, target);
  },
});

// jsdom ships no matchMedia, which a few client components call for breakpoints.
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});

const globals = {
  window: windowProxy,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  KeyboardEvent: dom.window.KeyboardEvent,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: rafTimer,
  cancelAnimationFrame: (handle) => clearTimeout(handle),
  localStorage: dom.window.localStorage,
  MutationObserver: dom.window.MutationObserver,
  matchMedia: dom.window.matchMedia.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
};

// Next's client helpers reference `self` (e.g. requestIdleCallback in
// use-intersection), which only exists in a worker/browser.
globals.self = globalThis;

for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}

// React 18.3 does not ship `cache()` outside Next's react-server build, so the
// server modules that call it at import time need a passthrough here.
if (typeof React.cache !== "function") {
  React.cache = (fn) => fn;
}

// --- asset modules ----------------------------------------------------------
require.extensions[".css"] = (module) => {
  const classNames = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== "string") return undefined;
        if (key === "__esModule" || key === "then" || key === "default") return undefined;
        return key;
      },
    },
  );
  module.exports = { __esModule: true, default: classNames };
};
require.extensions[".svg"] = (module) => {
  const Icon = (props) => React.createElement("svg", { "data-icon": "stub", ...props });
  module.exports = { __esModule: true, default: Icon };
};
for (const extension of [".jpg", ".jpeg", ".png", ".webp"]) {
  require.extensions[extension] = (module) => {
    module.exports = { __esModule: true, default: { src: "/stub-image.jpg", width: 100, height: 100 } };
  };
}

// --- module doubles ---------------------------------------------------------
const stubs = {
  "server-only": join(here, "stubs/server-only.ts"),
  "next/cache": join(here, "stubs/next-cache.ts"),
  "next/navigation": join(here, "stubs/next-navigation.ts"),
  "next/image": join(here, "stubs/next-image.tsx"),
  "framer-motion": join(here, "stubs/framer-motion.tsx"),
  "@/app/lib/supabase/browser": join(here, "stubs/supabase-browser.ts"),
  "@/app/lib/supabase/AuthProvider": join(here, "stubs/auth-provider.tsx"),
  "@/app/layout/header/components/User/UserSettingsModal": join(here, "stubs/user-settings-modal.tsx"),
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];

  // The footer's Airing This Week panel is an async server component that reads
  // `cookies()`; a client render cannot await it, so it gets a static double.
  const parent = rest[0];
  if (
    request === "./airingThisWeek" &&
    String(parent?.filename ?? "").includes("footer/components/navLinks")
  ) {
    return join(here, "stubs/airing-this-week.tsx");
  }

  return originalResolveFilename.call(this, request, rest[0]);
};
