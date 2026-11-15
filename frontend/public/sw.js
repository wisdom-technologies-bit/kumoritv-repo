// KumoriTV - self-removing stub that replaces a retired ad provider's worker.
//
// KEEP THIS FILE FOR AT LEAST 60 DAYS after the switch: until 2027-01-14.
//
// The previous worker (an ad-network service worker registered at the site
// root, scope "/") is ALREADY installed in visitors' browsers. Deleting the
// file would not remove it: browsers keep a service worker until its own code
// unregisters it, so the old one would keep running - and keep serving ads or
// push - forever. Serving this file at the same URL is what lets the browser
// replace it, and then this code removes itself:
//
//   install   -> skipWaiting(), so it takes over immediately instead of waiting
//                for every tab to close;
//   activate  -> delete the caches, unregister the registration, then reload
//                open windows so each one is served without a worker again.
//
// There is deliberately no `fetch` handler: with no listener, nothing is
// intercepted while the stub is in place.
//
// Cache-Control on this file is forced to no-cache by next.config.mjs, so a
// browser's update check always re-reads it instead of trusting a cached copy.
// After the 60 days have passed this file may be deleted, because by then the
// update check will have fetched it for every returning visitor.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((key) => caches.delete(key).catch(() => false)),
        );
      } catch (error) {
        /* cache storage unavailable: nothing stored to clear */
      }

      try {
        await self.registration.unregister();
      } catch (error) {
        /* already gone */
      }

      try {
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((client) => {
          try {
            client.navigate(client.url);
          } catch (error) {
            /* a tab we may not navigate: it reloads on its next visit */
          }
        });
      } catch (error) {
        /* no clients API: nothing open to reload */
      }
    })(),
  );
});
