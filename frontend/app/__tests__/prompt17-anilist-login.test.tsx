// Prompt 17, part 1: the AniList login flow.
//
// The flow is compared against the original ErickLimaS/anime-website: the token
// arrives in the hash, is stored in an httpOnly cookie, the viewer goes to redux +
// localStorage, and (here) the session is bridged to Supabase.

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import axios from "axios";
import { click, flush, render } from "../../test-harness/render";

const require = createRequire(import.meta.url);
const NodeModule = require("node:module");

// Route handlers import `next/headers`; point it at the in-memory cookie jar.
const HEADERS_STUB = join(import.meta.dirname, "..", "..", "test-harness", "stubs", "next-headers.ts");
const ANILIST_USERS_STUB = join(import.meta.dirname, "..", "..", "test-harness", "stubs", "anilist-users.ts");
const originalResolve = NodeModule._resolveFilename;
NodeModule._resolveFilename = function patched(request: string, ...rest: unknown[]) {
  if (request === "next/headers") return HEADERS_STUB;
  // The real module writes a Firebase document; the flow only needs the viewer.
  if (request === "@/app/api/anilist/anilistUsers") return ANILIST_USERS_STUB;

  return originalResolve.call(this, request, ...rest);
};

type AxiosCall = { url: string; method: string; data?: unknown };

/** Installs an axios adapter that answers locally and records every request. */
function mockAxios(handler: (call: AxiosCall) => { status?: number; data?: unknown }) {
  const calls: AxiosCall[] = [];

  axios.defaults.adapter = (async (config: { url?: string; method?: string; data?: unknown }) => {
    const call: AxiosCall = {
      url: String(config.url ?? ""),
      method: String(config.method ?? "get").toUpperCase(),
      data: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
    };

    calls.push(call);

    const result = handler(call);

    return {
      data: result.data ?? {},
      status: result.status ?? 200,
      statusText: "OK",
      headers: {},
      config,
    };
  }) as never;

  return calls;
}

function setHash(hash: string) {
  const location = window.location as unknown as { href: string; hash: string; pathname: string; search: string };
  location.hash = hash;
  location.href = `http://localhost:3000/${hash}`;
}

function clearHash() {
  const location = window.location as unknown as { href: string; hash: string };
  location.hash = "";
  location.href = "http://localhost:3000/";
}

test.beforeEach(() => {
  clearHash();
  process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID = "client-123";
  process.env.NEXT_PUBLIC_ANILIST_API_URL = "https://graphql.anilist.co";
  (globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  window.localStorage.clear();
});

// ------------------------------------------------------------------ parsing

test("the redirect is parsed with URLSearchParams", async () => {
  const { parseAnilistRedirect } = await import("@/app/lib/user/anilistLogin");

  const full = parseAnilistRedirect("#access_token=abc123&token_type=Bearer&expires_in=31536000");

  assert.deepEqual(full, {
    token: { accessToken: "abc123", tokenType: "Bearer", expiresIn: "31536000" },
    error: null,
  });

  const noHash = parseAnilistRedirect("access_token=abc123&token_type=Bearer&expires_in=31536000");
  assert.equal(noHash.token?.accessToken, "abc123", "the leading # is optional");
});

test("a redirect without token_type or expires_in still yields a token", async () => {
  const { parseAnilistRedirect, DEFAULT_TOKEN_TYPE } = await import("@/app/lib/user/anilistLogin");

  const parsed = parseAnilistRedirect("#access_token=abc123");

  assert.equal(parsed.token?.accessToken, "abc123");
  assert.equal(parsed.token?.tokenType, DEFAULT_TOKEN_TYPE);
  assert.equal(parsed.token?.expiresIn, null);
});

test("AniList errors are recognised in the hash and in the query", async () => {
  const { parseAnilistRedirect, describeAnilistError } = await import("@/app/lib/user/anilistLogin");

  const denied = parseAnilistRedirect("#error=access_denied");
  assert.equal(denied.token, null);
  assert.equal(denied.error, "access_denied");
  assert.match(describeAnilistError(denied.error), /cancelled/i);

  const query = parseAnilistRedirect("?error=access_denied");
  assert.equal(query.error, "access_denied");

  const nothing = parseAnilistRedirect("");
  assert.deepEqual(nothing, { token: null, error: null });
});

// ------------------------------------------------------------------ login URL

test("the authorize URL has no redirect_uri and no undefined client id", async () => {
  const { anilistAuthorizeUrl } = await import("@/app/lib/user/anilistLogin");

  const url = anilistAuthorizeUrl("client-123");

  assert.ok(url);
  assert.match(url!, /^https:\/\/anilist\.co\/api\/v2\/oauth\/authorize\?/);
  assert.match(url!, /client_id=client-123/);
  assert.match(url!, /response_type=token/);
  assert.equal(url!.includes("redirect_uri"), false, "AniList uses the registered URL");
  assert.equal(url!.includes("undefined"), false);

  assert.equal(anilistAuthorizeUrl(undefined), null);
  assert.equal(anilistAuthorizeUrl(""), null);
  assert.equal(anilistAuthorizeUrl("   "), null);
});

// ------------------------------------------------------------------ cookie lifetime

test("the token cookie lives for the token's lifetime, capped at a year", async () => {
  const { anilistCookieMaxAge, ANILIST_COOKIE_MAX_AGE_CAP, ANILIST_COOKIE_MAX_AGE_DEFAULT } =
    await import("@/app/lib/user/anilistLogin");

  assert.equal(anilistCookieMaxAge("31536000"), 31536000, "seconds in, seconds out");
  assert.equal(anilistCookieMaxAge(899), 899);
  assert.equal(anilistCookieMaxAge("999999999"), ANILIST_COOKIE_MAX_AGE_CAP, "capped at one year");
  assert.equal(anilistCookieMaxAge(undefined), ANILIST_COOKIE_MAX_AGE_DEFAULT);
  assert.equal(anilistCookieMaxAge("not-a-number"), ANILIST_COOKIE_MAX_AGE_DEFAULT);
  assert.equal(anilistCookieMaxAge("0"), ANILIST_COOKIE_MAX_AGE_DEFAULT);
});

test("POST /api/anilist stores the cookie with maxAge and no millisecond expiry", async () => {
  const { POST } = await import("@/app/api/anilist/route");
  const { __cookies, __resetCookies } = (await import("../../test-harness/stubs/next-headers")) as unknown as {
    __cookies: () => { name: string; value: string; options?: Record<string, unknown> }[];
    __resetCookies: () => void;
  };

  __resetCookies();

  const response = await POST({
    json: async () => ({ accessToken: "abc", tokenType: "Bearer", expiresIn: "31536000" }),
  } as never);

  assert.equal(response.status, 201);

  const cookie = __cookies().find((entry) => entry.name === "access_token");

  assert.ok(cookie, "the cookie was written");
  assert.equal(cookie!.options?.maxAge, 31536000);
  assert.equal(cookie!.options?.expires, undefined, "expires (ms) is gone");
  assert.equal(cookie!.options?.httpOnly, true);
  assert.equal(cookie!.options?.sameSite, "lax");
});

// ------------------------------------------------------------------ the flow

test("the token is processed even when an anonymous Supabase session exists", async () => {
  const { default: UserSideMenu } = await import("@/app/layout/header/components/User/UserSideMenu");

  (globalThis as Record<string, unknown>).__commentsTestAuth = {
    user: { id: "anon-1", is_anonymous: true, user_metadata: {} },
    profile: null,
    isAnonymous: true,
    loading: false,
    signOut: async () => {},
  };

  const calls = mockAxios(() => ({ status: 201, data: {} }));

  setHash("#access_token=abc123&token_type=Bearer&expires_in=31536000");

  const tree = await render(
    <Provider store={configureStore({ reducer: { UserInfo: (state: unknown = { value: null }) => state } })}>
      <UserSideMenu />
    </Provider>
  );

  try {
    const tokenPost = calls.find((call) => call.url === "/api/anilist" && call.method === "POST");

    assert.ok(tokenPost, "the token was posted to /api/anilist despite the anonymous session");
    assert.equal((tokenPost!.data as { accessToken: string }).accessToken, "abc123");

    const stored = window.localStorage.getItem("anilist-user");
    assert.ok(stored, "the viewer was stored");
    assert.match(stored!, /meze/);
  } finally {
    await tree.unmount();
    delete (globalThis as Record<string, unknown>).__commentsTestAuth;
  }
});

test("the hash is removed from the URL once the token is consumed", async () => {
  const { handleAnilistUserLoginWithRedux } = await import("@/app/lib/user/anilistUserLoginOptions");

  mockAxios(() => ({ status: 201, data: {} }));

  setHash("#access_token=abc123&token_type=Bearer&expires_in=31536000");

  const outcome = await handleAnilistUserLoginWithRedux({ skipReload: true });

  assert.equal(outcome.status, "ok");
  assert.equal(window.location.hash, "", "the fragment is gone");
  assert.equal(window.location.href.includes("access_token"), false, "the token left the address bar");
});

test("a failed bridge keeps the AniList session and shows a notice", async () => {
  const { handleAnilistUserLoginWithRedux } = await import("@/app/lib/user/anilistUserLoginOptions");

  mockAxios(() => ({ status: 201, data: {} }));

  (globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ ok: false }), { status: 503 });

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  const notices: string[] = [];
  setHash("#access_token=abc123&token_type=Bearer&expires_in=31536000");

  try {
    const outcome = await handleAnilistUserLoginWithRedux({ skipReload: true, onNotice: (message) => notices.push(message) });

    assert.equal(outcome.status, "ok");
    assert.equal(outcome.status === "ok" ? outcome.bridge : "", "failed");
    assert.ok(window.localStorage.getItem("anilist-user"), "the AniList session still works");
    assert.equal(warnings.length, 1, "the failure is logged");
    assert.equal(String(warnings[0][0]), "[anilist] session bridge failed");
    assert.equal(warnings[0][1], 503);
    assert.match(notices.join(" "), /syncing your account failed/i);
  } finally {
    console.warn = originalWarn;
  }
});

test("an AniList error is surfaced instead of ignored", async () => {
  const { handleAnilistUserLoginWithRedux } = await import("@/app/lib/user/anilistUserLoginOptions");

  const notices: string[] = [];
  setHash("#error=access_denied");

  const outcome = await handleAnilistUserLoginWithRedux({ skipReload: true, onNotice: (message) => notices.push(message) });

  assert.equal(outcome.status, "error");
  assert.match(notices.join(" "), /cancelled/i);
  assert.equal(window.location.hash, "", "the error is cleared from the URL");
});

// ------------------------------------------------------------------ bridge server side

function fakeAdmin(
  overrides: {
    createUserError?: { code?: string; message?: string };
    profileTaken?: boolean;
    currentUser?: { id: string; is_anonymous?: boolean; user_metadata?: Record<string, unknown> } | null;
  } = {}
) {
  const record = {
    created: [] as Record<string, unknown>[],
    links: [] as Record<string, unknown>[],
    updated: [] as { id: string; payload: Record<string, unknown> }[],
    verified: [] as unknown[],
  };

  const admin = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "public_profiles" && overrides.profileTaken ? { id: "x" } : null }),
        }),
      }),
    }),
    auth: {
      admin: {
        createUser: async (payload: Record<string, unknown>) => {
          record.created.push(payload);

          if (overrides.createUserError) return { error: overrides.createUserError };

          return { data: { user: { id: "new-user" } }, error: null };
        },
        generateLink: async (payload: Record<string, unknown>) => {
          record.links.push(payload);

          return { data: { properties: { hashed_token: "hash-1" } }, error: null };
        },
        updateUserById: async (id: string, payload: Record<string, unknown>) => {
          record.updated.push({ id, payload });

          return { error: null };
        },
      },
    },
  };

  const server = {
    auth: {
      getUser: async () => ({ data: { user: overrides.currentUser ?? null } }),
      verifyOtp: async (payload: unknown) => {
        record.verified.push(payload);

        return { error: null };
      },
    },
  };

  return { admin, server, record };
}

function tokenFor(id = 7, clientId = "client-123") {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "HS256" })}.${encode({ aud: clientId, sub: id })}.signature`;
}

test("a returning AniList user is signed in even though createUser says already registered", async () => {
  const { syncAnilistSession } = await import("@/app/lib/user/anilistSession");

  const { admin, server, record } = fakeAdmin({
    createUserError: { code: "email_exists", message: "A user with this email address has already been registered" },
  });

  const result = await syncAnilistSession({
    accessToken: tokenFor(),
    clientId: "client-123",
    deps: {
      createAdmin: () => admin as never,
      createServerClient: async () => server as never,
      fetchViewer: async () => ({ id: 7, name: "meze" }),
      randomPassword: () => "pw",
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, linked: false });
  assert.equal(record.created.length, 1, "createUser was attempted");
  assert.deepEqual(record.links[0], { type: "magiclink", email: "anilist-7@anilist.invalid" });
  assert.equal(record.verified.length, 1, "the session was created through the magic link");
});

test("an email session is linked, not replaced", async () => {
  const { syncAnilistSession } = await import("@/app/lib/user/anilistSession");

  const { admin, server, record } = fakeAdmin({
    currentUser: { id: "email-user", is_anonymous: false, user_metadata: { username: "meze" } },
  });

  const result = await syncAnilistSession({
    accessToken: tokenFor(),
    clientId: "client-123",
    deps: {
      createAdmin: () => admin as never,
      createServerClient: async () => server as never,
      fetchViewer: async () => ({ id: 7, name: "meze" }),
      randomPassword: () => "pw",
    },
  });

  assert.deepEqual(result.body, { ok: true, linked: true });
  assert.equal(record.created.length, 0, "no second account was created");
  assert.equal(record.updated[0].id, "email-user");
  assert.equal((record.updated[0].payload.user_metadata as { anilist_id: number }).anilist_id, 7);
});

test("an invalid viewer or an invalid token fails with a distinct code", async () => {
  const { syncAnilistSession } = await import("@/app/lib/user/anilistSession");

  const { admin, server } = fakeAdmin();
  const deps = {
    createAdmin: () => admin as never,
    createServerClient: async () => server as never,
    fetchViewer: async () => ({ id: 999, name: "someone-else" }),
    randomPassword: () => "pw",
  };

  const mismatch = await syncAnilistSession({ accessToken: tokenFor(7), clientId: "client-123", deps });
  assert.equal(mismatch.status, 401);
  assert.equal(mismatch.body.code, "viewer_mismatch");

  const wrongAudience = await syncAnilistSession({
    accessToken: tokenFor(7),
    clientId: "another-client",
    deps,
  });
  assert.equal(wrongAudience.body.code, "invalid_token");

  const noToken = await syncAnilistSession({ accessToken: "", clientId: "client-123", deps });
  assert.equal(noToken.body.code, "invalid_request");
});

// ------------------------------------------------------------------ login modal

test("a missing client id shows a message instead of opening AniList", async () => {
  const { default: UserLoginModal } = await import("@/app/components/UserLoginModal");

  delete process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID;
  (globalThis as Record<string, unknown>).__commentsTestClient = null;
  (globalThis as Record<string, unknown>).__commentsTestAuth = {
    user: null,
    profile: null,
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };

  const originalError = console.error;
  console.error = () => {};

  const tree = await render(<UserLoginModal />);

  try {
    const anilistButton = tree.container.querySelector("#anilist_button");
    assert.ok(anilistButton, "the AniList button is there");

    await click(anilistButton);
    await flush();

    assert.match(tree.container.textContent ?? "", /AniList login is not configured\./);
    assert.equal(window.location.href.includes("anilist.co"), false, "no redirect happened");
  } finally {
    console.error = originalError;
    await tree.unmount();
    delete (globalThis as Record<string, unknown>).__commentsTestAuth;
    process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID = "client-123";
  }
});

// ------------------------------------------------------------------ cookie helpers

test("cookie helpers build relative URLs", async () => {
  const calls = mockAxios(() => ({ status: 200, data: {} }));
  const { default: userSettingsActions } = await import("@/app/api/cookie/userCookieSettingsActions");

  await userSettingsActions.setMediaTitleLanguageCookie({ lang: "english" });
  await userSettingsActions.setSubtitleLanguageCookie({ lang: "English" });
  await userSettingsActions.setAdultContentCookie({ isEnabled: "true" });

  const urls = calls.map((call) => call.url);

  assert.deepEqual(urls, ["/api/media-title-language", "/api/subtitle", "/api/adult-content"]);

  for (const url of urls) {
    assert.equal(url.startsWith("/api/"), true, "relative, never undefined/api/...");
    assert.equal(url.includes("undefined"), false);
  }
});
