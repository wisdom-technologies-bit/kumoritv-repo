import { createMemoryStorage } from "@/app/lib/user-data/storage";
import type { StorageLike } from "@/app/lib/user-data/context";

/** Minimal window/localStorage shim so the device-side code can run under node. */
export function installBrowserShim(storage: StorageLike = createMemoryStorage()) {
  const target = new (globalThis as any).EventTarget();

  (globalThis as any).localStorage = storage;
  (globalThis as any).window = {
    localStorage: storage,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };

  return storage;
}

export function tick(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
