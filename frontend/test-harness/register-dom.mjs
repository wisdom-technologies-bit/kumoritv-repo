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
  requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (handle) => clearTimeout(handle),
  localStorage: dom.window.localStorage,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
};

for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
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
  "next/image": join(here, "stubs/next-image.tsx"),
  "framer-motion": join(here, "stubs/framer-motion.tsx"),
  "@/app/lib/supabase/browser": join(here, "stubs/supabase-browser.ts"),
  "@/app/lib/supabase/AuthProvider": join(here, "stubs/auth-provider.tsx"),
  "@/app/layout/header/components/User/UserSettingsModal": join(here, "stubs/user-settings-modal.tsx"),
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalResolveFilename.call(this, request, ...rest);
};
