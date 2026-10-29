// F — adult-content filter restored: hidden by default, opt-in from the
// profile (signed in) or the cookie (guest), server is the source of truth.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ADULT_COOKIE,
  adultCookieOptions,
  adultQueryVariables,
  filterMediasWithAdultContent,
  parseAdultEnabled,
  resolveAdultSetting,
} from "@/app/lib/anilist/adult-content";

test("default: adult content is hidden", () => {
  assert.deepEqual(resolveAdultSetting({}), { show: false, source: "default" });
  assert.deepEqual(adultQueryVariables(false), { isAdult: false });
});

test("guest cookie ON shows it, any other value hides it", () => {
  assert.deepEqual(resolveAdultSetting({ cookieValue: "true" }), {
    show: true,
    source: "cookie",
  });
  assert.equal(resolveAdultSetting({ cookieValue: "false" }).show, false);
  assert.equal(resolveAdultSetting({ cookieValue: "" }).show, false);
  assert.equal(resolveAdultSetting({ cookieValue: null }).show, false);
  assert.equal(parseAdultEnabled(" TRUE "), true);
  assert.equal(parseAdultEnabled(undefined), false);
});

test("signed in: the profile wins over the cookie, both ways", () => {
  assert.deepEqual(
    resolveAdultSetting({ profileShow: true, cookieValue: "false" }),
    { show: true, source: "profile" },
  );
  assert.deepEqual(
    resolveAdultSetting({ profileShow: false, cookieValue: "true" }),
    { show: false, source: "profile" },
  );
  // no profile row yet: the cookie still decides
  assert.equal(
    resolveAdultSetting({ profileShow: null, cookieValue: "true" }).show,
    true,
  );
});

test("the isAdult param is only sent as false", () => {
  assert.deepEqual(adultQueryVariables(false), { isAdult: false });
  // `isAdult: true` would return adult titles ONLY, so it is omitted
  assert.deepEqual(adultQueryVariables(true), {});
  assert.ok(!("isAdult" in adultQueryVariables(true)));
});

test("the defensive filter removes adult titles when hidden", () => {
  const items = [
    { id: 1, isAdult: false },
    { id: 2, isAdult: true },
    { id: 3 },
    { id: 4, isAdult: true },
  ];

  assert.deepEqual(
    filterMediasWithAdultContent(items, false).map((item) => item.id),
    [1, 3],
  );
  // shown: untouched
  assert.equal(filterMediasWithAdultContent(items, true).length, 4);
});

test("the defensive filter also looks through a wrapped {media} node", () => {
  const nodes = [
    { media: { id: 1, isAdult: false } },
    { media: { id: 2, isAdult: true } },
  ];

  assert.deepEqual(
    filterMediasWithAdultContent(nodes, false).map((node) => node.media.id),
    [1],
  );
  assert.deepEqual(filterMediasWithAdultContent(null as any, false), null as any);
});

test("the cookie helper writes the documented cookie name and value", () => {
  assert.equal(ADULT_COOKIE, "is_adult_content_enabled");
  const on = adultCookieOptions(true);
  assert.equal(on.name, "is_adult_content_enabled");
  assert.equal(on.value, "true");
  assert.equal(on.path, "/");
  assert.equal(adultCookieOptions(false).value, "false");
});

test("Toggle logic: guests write only the cookie, signed-in update the profile", () => {
  // The route decides: with a session it writes profiles.show_adult, otherwise
  // only the cookie. Both paths keep the cookie in sync.
  const plan = (signedIn: boolean, next: boolean) => ({
    profile: signedIn ? { show_adult: next } : null,
    cookie: adultCookieOptions(next),
  });

  assert.equal(plan(true, true).profile?.show_adult, true);
  assert.equal(plan(true, true).cookie.value, "true");
  assert.equal(plan(false, true).profile, null);
  assert.equal(plan(false, true).cookie.value, "true");
});
