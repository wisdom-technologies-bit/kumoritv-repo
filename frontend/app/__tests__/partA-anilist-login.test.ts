// Part A: the AniList login after Firebase was removed.
//
// Every case here is one of the failures the owner can now see by name in the
// toast: a rejected token, an unreachable AniList, a Supabase sync failure, a
// rate limit. Plus the two safety properties: the route returns the viewer fields
// and a token never reaches a log line.

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const NodeModule = require("node:module");

const STUBS = join(import.meta.dirname, "..", "..", "test-harness", "stubs");
const originalResolve = NodeModule._resolveFilename;
NodeModule._resolveFilename = function patched(request: string, ...rest: unknown[]) {
  if (request === "@/app/lib/supabase/admin") return join(STUBS, "supabase-admin.ts");
  if (request === "@/app/lib/supabase/auth-server") return join(STUBS, "supabase-auth-server.ts");

  return originalResolve.call(this, request, ...rest);
};

const CLIENT_ID = "client-123";
const TOKEN = "secret-token-value-abc";

function tokenFor(id = 7, clientId = CLIENT_ID) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "HS256" })}.${encode({ aud: clientId, sub: id })}.signature`;
}

const VIEWER = {
  id: 7,
  name: "meze",
  bannerImage: "https://example.test/banner.jpg",
  avatar: { large: "https://example.test/large.jpg", medium: "https://example.test/medium.jpg" },
  options: { titleLanguage: "ROMAJI_STYLISED", displayAdultContent: false },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ------------------------------------------------------------- viewer fetcher

test("the viewer fetch has a fallback URL and returns the fields the UI needs", async () => {
  const { fetchAnilistViewer } = await import("@/app/lib/anilist/viewer");
  const { ANILIST_GRAPHQL_URL } = await import("@/app/lib/anilist/endpoint");

  const seen: { url: string; auth?: string }[] = [];

  const result = await fetchAnilistViewer(TOKEN, {
    fetchImpl: (async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url: String(url), auth: init.headers.authorization });

      return jsonResponse({ data: { Viewer: VIEWER } });
    }) as unknown as typeof fetch,
  });

  assert.equal(ANILIST_GRAPHQL_URL, "https://graphql.anilist.co", "the shared constant has a fallback");
  assert.equal(seen[0].url, "https://graphql.anilist.co", "never the string 'undefined'");
  assert.equal(seen[0].auth, `Bearer ${TOKEN}`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.viewer, VIEWER);
});

test("a rejected token is ANILIST_VIEWER_401 and is not retried", async () => {
  const { fetchAnilistViewer } = await import("@/app/lib/anilist/viewer");
  let calls = 0;

  const result = await fetchAnilistViewer(TOKEN, {
    fetchImpl: (async () => {
      calls += 1;

      return jsonResponse({ errors: [{ message: "Invalid token" }] }, 401);
    }) as unknown as typeof fetch,
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "ANILIST_VIEWER_401");
  assert.equal(calls, 1, "an HTTP error is not retried");
});

test("a 200 with no Viewer is a rejected token too", async () => {
  const { fetchAnilistViewer } = await import("@/app/lib/anilist/viewer");

  const result = await fetchAnilistViewer(TOKEN, {
    fetchImpl: (async () => jsonResponse({ errors: [{ message: "Invalid token" }] })) as unknown as typeof fetch,
  });

  assert.equal(!result.ok && result.code, "ANILIST_VIEWER_401");
});

test("a network error is retried once, then reported as unreachable", async () => {
  const { fetchAnilistViewer } = await import("@/app/lib/anilist/viewer");
  let calls = 0;

  const result = await fetchAnilistViewer(TOKEN, {
    fetchImpl: (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch,
  });

  assert.equal(calls, 2, "one retry, network errors only");
  assert.equal(!result.ok && result.code, "ANILIST_VIEWER_UNREACHABLE");
});

test("a timeout is reported after 8 seconds and is not retried", async () => {
  const { fetchAnilistViewer, VIEWER_TIMEOUT_MS } = await import("@/app/lib/anilist/viewer");
  let calls = 0;

  const result = await fetchAnilistViewer(TOKEN, {
    timeoutMs: 10,
    fetchImpl: ((_url: string, init: { signal: AbortSignal }) => {
      calls += 1;

      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as unknown as typeof fetch,
  });

  assert.equal(VIEWER_TIMEOUT_MS, 8000);
  assert.equal(calls, 1, "a timeout already burned the budget");
  assert.equal(!result.ok && result.code, "ANILIST_VIEWER_TIMEOUT");
});

test("429 is rate limited, 400 is its own code", async () => {
  const { fetchAnilistViewer } = await import("@/app/lib/anilist/viewer");

  const limited = await fetchAnilistViewer(TOKEN, {
    fetchImpl: (async () => jsonResponse({}, 429)) as unknown as typeof fetch,
  });
  const bad = await fetchAnilistViewer(TOKEN, {
    fetchImpl: (async () => jsonResponse({}, 400)) as unknown as typeof fetch,
  });

  assert.equal(!limited.ok && limited.code, "ANILIST_RATE_LIMITED");
  assert.equal(!bad.ok && bad.code, "ANILIST_VIEWER_400");
});

// ------------------------------------------------------------- token cookie

test("the token cookie round-trips through AES-256-GCM and rejects tampering", async () => {
  const { encryptToken, decryptToken, parseEncryptionKey, readAnilistToken } =
    await import("@/app/lib/anilist/tokenCookie");

  const key = parseEncryptionKey("a".repeat(64));
  const token = { accessToken: TOKEN, tokenType: "Bearer", expiresIn: "31536000" };

  const sealed = encryptToken(token, key);

  assert.match(sealed, /^v1\./);
  assert.equal(sealed.includes(TOKEN), false, "the token is not in the cookie in clear text");
  assert.deepEqual(decryptToken(sealed, key), token);
  assert.deepEqual(readAnilistToken(sealed, key), token, "read accepts the encrypted format");
  assert.deepEqual(readAnilistToken(JSON.stringify(token)), token, "read accepts the implicit format");

  const [iv, tag, data] = sealed.slice(3).split(".");
  const flipped = `${data.slice(0, 4)}${data.slice(4, 5) === "A" ? "B" : "A"}${data.slice(5)}`;

  assert.equal(decryptToken(`v1.${iv}.${tag}.${flipped}`, key), null, "a modified ciphertext fails the tag");
  assert.equal(decryptToken(sealed, parseEncryptionKey("b".repeat(64))), null, "a wrong key fails");
});

test("a missing or malformed encryption key fails closed", async () => {
  const { parseEncryptionKey, MissingEncryptionKeyError, serializeToken } = await import(
    "@/app/lib/anilist/tokenCookie"
  );

  assert.throws(() => parseEncryptionKey(""), MissingEncryptionKeyError);
  assert.throws(() => parseEncryptionKey("not-hex"), MissingEncryptionKeyError);
  assert.throws(
    () => serializeToken({ accessToken: TOKEN, tokenType: "Bearer", expiresIn: null }, "code", undefined),
    MissingEncryptionKeyError
  );
});

// ------------------------------------------------------------- signed state

test("a mismatched or replayed state is rejected", async () => {
  const { createState, deriveStateKey, verifyState, STATE_TTL_MS } = await import("@/app/lib/anilist/state");
  const { parseEncryptionKey } = await import("@/app/lib/anilist/tokenCookie");

  const key = deriveStateKey(parseEncryptionKey("c".repeat(64)));
  const { state, nonce } = createState(key, 1_000_000);

  assert.equal(verifyState(state, key, { now: 1_000_500, cookieNonce: nonce }).ok, true);
  assert.deepEqual(verifyState(state, key, { now: 1_000_500, cookieNonce: "other" }), {
    ok: false,
    reason: "cookie",
  });

  const tampered = `${state.split(".")[0]}.${1_000_001}.${state.split(".")[2]}`;
  assert.deepEqual(verifyState(tampered, key, { now: 1_000_500 }), { ok: false, reason: "signature" });

  assert.deepEqual(verifyState(state, key, { now: 1_000_000 + STATE_TTL_MS + 1 }), {
    ok: false,
    reason: "expired",
  });

  assert.deepEqual(verifyState(null, key), { ok: false, reason: "malformed" });
});

// ------------------------------------------------------------- bridge route

function fakeSupabase(options: { profileSource?: string } = {}) {
  const record = { created: [] as unknown[], updatedProfiles: [] as unknown[], verified: [] as unknown[] };

  (globalThis as Record<string, unknown>).__fakeAdmin = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "profiles"
              ? { data: { title_language: "english", title_language_source: options.profileSource ?? "default" } }
              : { data: null },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          record.updatedProfiles.push(values);

          return { error: null };
        },
      }),
    }),
    auth: {
      admin: {
        createUser: async (payload: unknown) => {
          record.created.push(payload);

          return { data: { user: { id: "new-user" } }, error: null };
        },
        generateLink: async () => ({ data: { properties: { hashed_token: "hash-1" } }, error: null }),
        updateUserById: async () => ({ error: null }),
      },
    },
  };

  (globalThis as Record<string, unknown>).__fakeServer = {
    auth: {
      getUser: async () => ({ data: { user: { id: "new-user", is_anonymous: false, user_metadata: {} } } }),
      verifyOtp: async (payload: unknown) => {
        record.verified.push(payload);

        return { error: null };
      },
    },
  };

  return record;
}

test("the bridge returns the viewer fields and stores the token httpOnly", async () => {
  const { resetRateLimits } = await import("@/app/lib/anilist/rateLimit");
  const { POST } = await import("@/app/api/auth/anilist-session/route");

  resetRateLimits();
  process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID = CLIENT_ID;

  const record = fakeSupabase();

  (globalThis as Record<string, unknown>).fetch = async () => jsonResponse({ data: { Viewer: VIEWER } });

  const response = await POST({
    headers: new Headers({ "x-forwarded-for": "203.0.113.9" }),
    cookies: { get: () => undefined },
    json: async () => ({ accessToken: tokenFor(), tokenType: "Bearer", expiresIn: "31536000" }),
  } as never);

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.viewer, VIEWER, "id, name, avatar, banner and titleLanguage come back");
  assert.equal(body.seededTitleLanguage, "romaji", "ROMAJI_STYLISED normalises to romaji");
  assert.equal(record.updatedProfiles.length, 1, "the profile was seeded");

  const setCookie = response.headers.getSetCookie();
  const tokenHeader = setCookie.find((header) => header.startsWith("access_token=")) ?? "";
  const titleHeader = setCookie.find((header) => header.startsWith("media_title_language=")) ?? "";

  assert.match(tokenHeader, /HttpOnly/i, "the token cookie is httpOnly");
  assert.equal(tokenHeader.includes(TOKEN), false, "the cookie value is not the raw token");
  assert.match(titleHeader, /media_title_language=romaji/);
});

test("an existing choice is never overwritten by the AniList option", async () => {
  const { resetRateLimits } = await import("@/app/lib/anilist/rateLimit");
  const { POST } = await import("@/app/api/auth/anilist-session/route");

  resetRateLimits();
  const record = fakeSupabase({ profileSource: "user" });

  (globalThis as Record<string, unknown>).fetch = async () => jsonResponse({ data: { Viewer: VIEWER } });

  const response = await POST({
    headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
    cookies: { get: () => undefined },
    json: async () => ({ accessToken: tokenFor(), tokenType: "Bearer", expiresIn: "31536000" }),
  } as never);

  const body = await response.json();

  assert.equal(body.seededTitleLanguage, undefined);
  assert.equal(record.updatedProfiles.length, 0, "the user's own choice is left alone");
});

test("the bridge answers 401 for a rejected token, 429 when rate limited, and never logs the token", async () => {
  const { resetRateLimits } = await import("@/app/lib/anilist/rateLimit");
  const { POST } = await import("@/app/api/auth/anilist-session/route");

  resetRateLimits();
  fakeSupabase();

  const lines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));

  (globalThis as Record<string, unknown>).fetch = async () => jsonResponse({ errors: [{ message: "bad" }] }, 401);

  try {
    const rejected = await POST({
      headers: new Headers({ "x-forwarded-for": "203.0.113.11" }),
      cookies: { get: () => undefined },
      json: async () => ({ accessToken: tokenFor(), expiresIn: "31536000" }),
    } as never);

    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).code, "ANILIST_VIEWER_401");

    let last = rejected;

    for (let index = 0; index < 12; index += 1) {
      last = await POST({
        headers: new Headers({ "x-forwarded-for": "203.0.113.11" }),
        cookies: { get: () => undefined },
        json: async () => ({ accessToken: tokenFor(), expiresIn: "31536000" }),
      } as never);
    }

    assert.equal(last.status, 429);
    assert.equal((await last.json()).code, "ANILIST_RATE_LIMITED");
  } finally {
    console.error = originalError;
  }

  assert.ok(lines.some((line) => line.includes("code=ANILIST_VIEWER_401")), "the code is logged");
  assert.ok(lines.some((line) => line.includes("code=ANILIST_RATE_LIMITED")), "the rate limit is logged");
  assert.equal(lines.join("\n").includes(TOKEN), false, "the token is never logged");
  assert.equal(lines.join("\n").includes(tokenFor()), false, "not even the whole JWT");
});

test("no Firestore or Firebase is reachable from the login path", () => {
  const root = resolve(process.cwd());
  const loginFiles = [
    "app/lib/user/anilistUserLoginOptions.ts",
    "app/lib/user/anilistSession.ts",
    "app/api/anilist/anilistUsers.ts",
    "app/api/auth/anilist-session/route.ts",
    "app/auth/anilist/callback/route.ts",
    "app/auth/anilist/start/route.ts",
  ];

  for (const file of loginFiles) {
    const source = readFileSync(join(root, file), "utf8");

    // Imports only: a comment may say the word (this very flow explains why it is
    // gone), but no module may pull the SDK in.
    assert.equal(
      /(from|require\()\s*["'](firebase[^"']*|firestore[^"']*|react-firebase-hooks)/i.test(source),
      false,
      `${file} imports Firebase`
    );
  }

  assert.equal(existsSync(join(root, "app/firebaseApp.ts")), false, "firebaseApp.ts is deleted");
  assert.equal(existsSync(join(root, "app/lib/user/userLoginActions.ts")), false, "userLoginActions.ts is deleted");

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.equal(pkg.dependencies.firebase, undefined);
  assert.equal(pkg.dependencies["react-firebase-hooks"], undefined);
});
