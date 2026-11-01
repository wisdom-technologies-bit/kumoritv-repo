// Prompt 21, part 2: the server sender (request shape, chunking, the key) and
// the cron's rules (dedupe window, like-per-hour, digest throttle, adult filter,
// announcements sent once).

import assert from "node:assert/strict";
import test from "node:test";
import {
  PUSH_CHUNK_SIZE,
  buildNotificationPayload,
  chunkIds,
  sendPush,
  siteUrl,
} from "@/app/lib/push/onesignal";
import {
  DIGEST_WINDOW_MS,
  digestAllowed,
  digestBody,
  digestDedupeKey,
  digestTitle,
  episodeAnilistIdFromUrl,
  isAdultPushAllowed,
  likePushDedupeKey,
  preferenceAllows,
  shouldPushAnnouncement,
} from "@/app/lib/push/rules";
import { mentionTokens, splitMentions } from "@/app/lib/comments/mentions";

const REST_KEY = "test-rest-key-do-not-log";

type Captured = { url: string; init: RequestInit; body: any };

function mockFetch(
  handler: (body: any, index: number) => { status: number; body?: unknown } | Error,
) {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  let index = 0;

  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), init, body });

    const outcome = handler(body, index);
    index += 1;

    if (outcome instanceof Error) throw outcome;

    return new Response(JSON.stringify(outcome.body ?? { id: `notif-${index}` }), {
      status: outcome.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const CONFIGURED = {
  NEXT_PUBLIC_ONESIGNAL_APP_ID: "11111111-2222-3333-4444-555555555555",
  ONESIGNAL_REST_API_KEY: REST_KEY,
  NEXT_PUBLIC_SITE_URL: "https://kumoritv.top",
};

test("sendPush posts the documented OneSignal body with an absolute url", async () => {
  const fetchMock = mockFetch(() => ({ status: 200, body: { id: "abc" } }));

  const result = await withEnv(CONFIGURED, () =>
    sendPush({
      externalIds: ["user-1"],
      title: "Episode 5 is now available",
      body: "Frieren",
      url: "/watch/1234?ep=5",
      image: "https://cdn.test/cover.jpg",
      topic: "kumori-episode",
      idempotencyKey: "episode:1234:5:user-1",
    }),
  );

  fetchMock.restore();

  assert.equal(result.ok, true);
  assert.equal(result.sent, 1);
  assert.equal(fetchMock.calls.length, 1);

  const [call] = fetchMock.calls;
  assert.equal(call.url, "https://api.onesignal.com/notifications");
  assert.equal((call.init.headers as Record<string, string>).Authorization, `Key ${REST_KEY}`);

  assert.equal(call.body.app_id, CONFIGURED.NEXT_PUBLIC_ONESIGNAL_APP_ID);
  assert.equal(call.body.target_channel, "push");
  assert.deepEqual(call.body.include_aliases, { external_id: ["user-1"] });
  assert.deepEqual(call.body.headings, { en: "Episode 5 is now available" });
  assert.deepEqual(call.body.contents, { en: "Frieren" });
  assert.equal(call.body.url, "https://kumoritv.top/watch/1234?ep=5");
  assert.equal(call.body.chrome_web_icon, "https://cdn.test/cover.jpg");
  assert.equal(call.body.big_picture, "https://cdn.test/cover.jpg");
  assert.equal(call.body.web_push_topic, "kumori-episode");
  assert.equal(call.body.idempotency_key, "episode:1234:5:user-1:0");
});

test("sendPush chunks at 2000 external ids and de-duplicates them", async () => {
  const fetchMock = mockFetch(() => ({ status: 200, body: { id: "ok" } }));

  const ids = Array.from({ length: 4100 }, (_, index) => `user-${index}`);
  ids.push("user-0");

  assert.equal(chunkIds(ids).length, 3);
  assert.equal(chunkIds(ids)[0].length, PUSH_CHUNK_SIZE);

  const result = await withEnv(CONFIGURED, () =>
    sendPush({ externalIds: ids, title: "Announcement", body: "Hello" }),
  );

  fetchMock.restore();

  assert.equal(fetchMock.calls.length, 3);
  assert.equal(fetchMock.calls[0].body.include_aliases.external_id.length, 2000);
  assert.equal(fetchMock.calls[1].body.include_aliases.external_id.length, 2000);
  assert.equal(fetchMock.calls[2].body.include_aliases.external_id.length, 100);
  assert.equal(result.requested, 4100);
  assert.equal(result.sent, 4100);
  assert.equal(result.ok, true);
});

test("the REST key never appears in the result, an error, or a log line", async () => {
  const fetchMock = mockFetch(() => ({ status: 401, body: { errors: ["no matching app"] } }));
  const logged: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));

  const result = await withEnv(CONFIGURED, () =>
    sendPush({ externalIds: ["user-1"], title: "Hi", body: "There" }),
  );

  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  fetchMock.restore();

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false, "401 is permanent");
  assert.equal(JSON.stringify(result).includes(REST_KEY), false);
  assert.equal(logged.join("\n").includes(REST_KEY), false);
  assert.equal(
    String(fetchMock.calls[0].body).includes(REST_KEY),
    false,
    "the key belongs in the header only",
  );
});

test("429 and 5xx are retryable, and the batch is retried once in-call", async () => {
  const rateLimited = mockFetch(() => ({ status: 429, body: { errors: ["rate limited"] } }));

  const result = await withEnv(CONFIGURED, () =>
    sendPush({ externalIds: ["user-1"], title: "Hi", body: "There" }),
  );

  rateLimited.restore();
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(rateLimited.calls.length, 2, "one immediate retry");

  const serverError = mockFetch(() => ({ status: 503, body: { errors: ["down"] } }));
  const second = await withEnv(CONFIGURED, () =>
    sendPush({ externalIds: ["user-1"], title: "Hi", body: "There" }),
  );
  serverError.restore();

  assert.equal(second.retryable, true);
});

test("a network failure is retryable, not fatal", async () => {
  const fetchMock = mockFetch(() => new Error("socket hang up"));

  const result = await withEnv(CONFIGURED, () =>
    sendPush({ externalIds: ["user-1"], title: "Hi", body: "There" }),
  );

  fetchMock.restore();
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.error, "onesignal_network_error");
});

test("without a key nothing is sent and the caller is told it was skipped", async () => {
  const fetchMock = mockFetch(() => ({ status: 200 }));

  const result = await withEnv(
    { ...CONFIGURED, ONESIGNAL_REST_API_KEY: undefined },
    () => sendPush({ externalIds: ["user-1"], title: "Hi" }),
  );

  fetchMock.restore();
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.error, "onesignal_not_configured");
});

test("no recipients means no request at all", async () => {
  const fetchMock = mockFetch(() => ({ status: 200 }));

  const result = await withEnv(CONFIGURED, () => sendPush({ externalIds: [], title: "Hi" }));

  fetchMock.restore();
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.ok, true);
});

test("the payload falls back to the title for an empty body and builds absolute urls", () => {
  const payload = buildNotificationPayload({
    appId: "app",
    externalIds: ["user-1"],
    title: "Only a title",
    body: "",
    url: "https://elsewhere.test/x",
  });

  assert.deepEqual(payload.contents, { en: "Only a title" });
  assert.equal(payload.url, "https://elsewhere.test/x");
  assert.equal(siteUrl(), "https://kumoritv.top");
});

test("the outbox preference check mirrors push_allowed at send time", () => {
  const preferences = {
    enabled: true,
    replies: true,
    likes: false,
    mentions: true,
    announcements: true,
    newEpisodesAll: false,
    newEpisodesSubscribed: true,
  };

  assert.equal(preferenceAllows("reply", preferences), true);
  assert.equal(preferenceAllows("mention", preferences), true);
  assert.equal(preferenceAllows("like", preferences), false, "likes are off");
  assert.equal(preferenceAllows("announcement", preferences), true);
  assert.equal(preferenceAllows("episode", preferences), true);
  assert.equal(preferenceAllows("digest", preferences), false, "digest needs all-anime");

  // Push off means nothing is sent, whatever the categories say.
  assert.equal(preferenceAllows("reply", { ...preferences, enabled: false }), false);
  assert.equal(preferenceAllows("reply", null), false);
});

test("likes collapse into one push per comment per hour", () => {
  const at = Date.parse("2026-11-01T10:05:00.000Z");

  assert.equal(likePushDedupeKey("c1", at), likePushDedupeKey("c1", at + 40 * 60 * 1000));
  assert.notEqual(likePushDedupeKey("c1", at), likePushDedupeKey("c1", at + 61 * 60 * 1000));
  assert.notEqual(likePushDedupeKey("c1", at), likePushDedupeKey("c2", at));
});

test("the digest is throttled to one per three hours", () => {
  const now = Date.parse("2026-11-01T12:00:00.000Z");

  assert.equal(digestAllowed(null, now), true);
  assert.equal(digestAllowed(new Date(now - DIGEST_WINDOW_MS - 60_000).toISOString(), now), true);
  assert.equal(digestAllowed(new Date(now - 60 * 60 * 1000).toISOString(), now), false);
  assert.equal(digestAllowed(new Date(now - DIGEST_WINDOW_MS + 1000).toISOString(), now), false);

  // A broken timestamp must not silence the digest forever.
  assert.equal(digestAllowed("not a date", now), true);
});

test("the digest keys are stable inside one window", () => {
  const at = Date.parse("2026-11-01T12:00:00.000Z");

  assert.equal(digestDedupeKey("u1", at), digestDedupeKey("u1", at + 5 * 60 * 1000));
  assert.notEqual(digestDedupeKey("u1", at), digestDedupeKey("u2", at));
});

test("the digest names at most three titles and counts the rest", () => {
  assert.equal(digestTitle(1), "1 new episode on KumoriTV");
  assert.equal(digestTitle(7), "7 new episodes on KumoriTV");

  const titles = ["Frieren", "One Piece", "Dandadan", "Blue Box", "Sakamoto Days"];
  assert.equal(digestBody(titles, 5), "Frieren, One Piece, Dandadan and 2 more");
  assert.equal(digestBody(titles.slice(0, 2), 2), "Frieren, One Piece");
  assert.equal(digestBody([], 3), "3 new episodes on KumoriTV");
});

test("adult-flagged anime never reach a user who hides adult content", () => {
  assert.equal(isAdultPushAllowed({ isAdult: false, showAdult: false }), true);
  assert.equal(isAdultPushAllowed({ isAdult: true, showAdult: true }), true);
  assert.equal(isAdultPushAllowed({ isAdult: true, showAdult: false }), false);
  assert.equal(isAdultPushAllowed({ isAdult: true, showAdult: null }), false);
});

test("an announcement is pushed exactly once and only while visible", () => {
  const now = Date.parse("2026-11-01T12:00:00.000Z");

  assert.equal(shouldPushAnnouncement({ push_sent_at: null, expires_at: null }, now), true);
  assert.equal(
    shouldPushAnnouncement({ push_sent_at: "2026-11-01T11:00:00.000Z", expires_at: null }, now),
    false,
    "already sent",
  );
  assert.equal(
    shouldPushAnnouncement({ push_sent_at: null, expires_at: "2026-11-01T11:00:00.000Z" }, now),
    false,
    "expired",
  );
});

test("episode urls are parsed for the send-time adult re-check", () => {
  assert.equal(episodeAnilistIdFromUrl("/watch/21?ep=3"), 21);
  assert.equal(episodeAnilistIdFromUrl("https://kumoritv.top/watch/999"), 999);
  assert.equal(episodeAnilistIdFromUrl("/media/21"), null);
  assert.equal(episodeAnilistIdFromUrl(null), null);
});

test("mention tokens follow the trigger's character class", () => {
  assert.deepEqual(mentionTokens("hi @frieren and @solo_leveling"), [
    "frieren",
    "solo_leveling",
  ]);

  // Trailing punctuation is trimmed, like the SQL does.
  assert.ok(mentionTokens("thanks @frieren.").includes("frieren"));

  // An email address is not a mention.
  assert.deepEqual(mentionTokens("write to me@example.com"), []);
  assert.deepEqual(mentionTokens("no mentions here"), []);
});

test("mention rendering keeps the text and highlights only the handles", () => {
  const segments = splitMentions("Hey @frieren, watch this");

  assert.deepEqual(segments, [
    { text: "Hey ", mention: false },
    { text: "@frieren", mention: true },
    { text: ", watch this", mention: false },
  ]);

  const withEmail = splitMentions("mail me@example.com");
  assert.equal(
    withEmail.some((segment) => segment.mention),
    false,
  );
});
