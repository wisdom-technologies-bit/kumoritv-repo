// The production crash this guards against:
//   TypeError: Cannot read properties of undefined (reading 'value')
// A cycle (login options -> store -> UserInfo slice -> login options) made the
// UserInfo reducer `undefined` while the store was being created, so the store
// came up WITHOUT that key and every `state.UserInfo.value` selector threw.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

test("the UserInfo slice does not statically import the login module", () => {
  const source = readFileSync(join(ROOT, "app/lib/redux/features/manageUserData.ts"), "utf8");
  const staticImport = /^\s*import\s[^;]*from\s+["'][^"']*anilistUserLoginOptions["']/m;

  assert.equal(
    staticImport.test(source),
    false,
    "a static import here closes the cycle and breaks the store at runtime",
  );
});

test("the store is created lazily, not while modules are still evaluating", () => {
  const source = readFileSync(join(ROOT, "app/lib/user/anilistUserLoginOptions.ts"), "utf8");

  assert.equal(
    /export const userCustomStore = makeStore\(\)/.test(source),
    false,
    "makeStore() at module scope is what raced the cycle",
  );
  assert.match(source, /getAppStore\(\)/);
});

test("the store always has both slices, whatever module loads first", async () => {
  // Import the provider first, exactly like the client bundle does.
  await import("@/app/lib/redux/StoreProvider");

  const { getAppStore } = await import("@/app/lib/redux/appStore");
  const state = getAppStore().getState();

  assert.deepEqual(Object.keys(state).sort(), ["ShowLoginModal", "UserInfo"]);
  assert.equal(typeof state.UserInfo.value, "object");
});

test("a selector on a fresh store returns the initial value instead of throwing", async () => {
  const { getAppStore } = await import("@/app/lib/redux/appStore");
  const { useAppSelector } = await import("@/app/lib/redux/hooks");
  const React = (await import("react")).default;
  const { render } = await import("../../test-harness/render");
  const { Provider } = await import("react-redux");

  function Probe() {
    const value = useAppSelector((state) => state.UserInfo.value);

    return React.createElement("span", null, value ? "has-user" : "no-user");
  }

  const tree = await render(
    React.createElement(Provider as never, { store: getAppStore() }, React.createElement(Probe)),
  );

  assert.match(tree.container.textContent ?? "", /no-user/);
  await tree.unmount();
});
