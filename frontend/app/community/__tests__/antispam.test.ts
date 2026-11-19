// Phase 6, part D: the anti-spam rules and the stable rate-limit codes.
//
// The durable limits themselves are proved against real Postgres in
// test-harness/phase6-sql-check.mjs (5 comments/minute, 3 posts/10 minutes,
// 60 reactions/minute, 10 reports/hour, staff exempt). These are the pure rules
// and the mapping the UI depends on.
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPostSpam,
  countLinks,
  normaliseBody,
  readAntispamConfig,
  shouldFlagCrossUserDuplicate,
} from "@/app/lib/community/antispam";
import { readRuleHits, resetRuleHits } from "@/app/lib/community/rate-limit";
import { classifyPostWriteError, handleCreatePost } from "@/app/lib/community/posts-server";

const config = {
  newAccountHours: 24,
  newAccountPostsPerHour: 3,
  maxLinks: 2,
  newAccountMaxLinks: 1,
  duplicateWindowMin: 10,
};

test("defaults are the documented ones, and env vars override them", () => {
  assert.deepEqual(readAntispamConfig({}), config);
  const custom = readAntispamConfig({
    COMMUNITY_NEW_ACCOUNT_HOURS: "48",
    COMMUNITY_NEW_ACCOUNT_POSTS_PER_HOUR: "5",
    COMMUNITY_MAX_LINKS: "4",
    COMMUNITY_NEW_ACCOUNT_MAX_LINKS: "2",
    COMMUNITY_DUPLICATE_WINDOW_MIN: "30",
  });
  assert.equal(custom.newAccountHours, 48);
  assert.equal(custom.newAccountPostsPerHour, 5);
  assert.equal(custom.maxLinks, 4);
  assert.equal(custom.newAccountMaxLinks, 2);
  assert.equal(custom.duplicateWindowMin, 30);
});

test("nonsense env values fall back instead of disabling a rule", () => {
  const config = readAntispamConfig({
    COMMUNITY_NEW_ACCOUNT_HOURS: "lots",
    COMMUNITY_MAX_LINKS: "-3",
    COMMUNITY_DUPLICATE_WINDOW_MIN: "0",
  });
  assert.equal(config.newAccountHours, 24);
  assert.equal(config.maxLinks, 2);
  assert.equal(config.duplicateWindowMin, 10);
});

test("links are counted in the body, and a link card counts as one", () => {
  assert.equal(countLinks("no links here"), 0);
  assert.equal(countLinks("see https://a.test and http://b.test"), 2);
  assert.equal(countLinks("www.c.test"), 1);
  assert.equal(countLinks("one https://a.test", true), 2);
});

test("normalisation matches the database's own rule", () => {
  assert.equal(normaliseBody("  Hello   WORLD "), "hello world");
});

test("a duplicate body is a 409 before it reaches the database", () => {
  resetRuleHits();
  const verdict = checkPostSpam({
    body: "same",
    hasLinkCard: false,
    accountAgeHours: 500,
    postsLastHour: 0,
    duplicate: true,
    config,
  });
  assert.equal(verdict?.status, 409);
  assert.equal(verdict?.code, "duplicate_post");
  assert.equal(readRuleHits()[0].rule, "duplicate_body");
});

test("a new account gets one link and three posts an hour", () => {
  const twoLinks = checkPostSpam({
    body: "https://a.test https://b.test",
    hasLinkCard: false,
    accountAgeHours: 2,
    postsLastHour: 0,
    duplicate: false,
    config,
  });
  assert.equal(twoLinks?.status, 400);
  assert.equal(twoLinks?.code, "too_many_links");
  assert.match(twoLinks!.message, /Keep it to 1/);

  const rate = checkPostSpam({
    body: "hello",
    hasLinkCard: false,
    accountAgeHours: 2,
    postsLastHour: 3,
    duplicate: false,
    config,
  });
  assert.equal(rate?.status, 429);
  assert.match(rate!.message, /3 times an hour/);
});

test("an established account may use two links", () => {
  assert.equal(
    checkPostSpam({
      body: "https://a.test https://b.test",
      hasLinkCard: false,
      accountAgeHours: 100,
      postsLastHour: 0,
      duplicate: false,
      config,
    }),
    null,
  );
  const three = checkPostSpam({
    body: "https://a.test https://b.test https://c.test",
    hasLinkCard: false,
    accountAgeHours: 100,
    postsLastHour: 0,
    duplicate: false,
    config,
  });
  assert.equal(three?.code, "too_many_links");
});

test("an unknown account age is treated as new, not as trusted", () => {
  const verdict = checkPostSpam({
    body: "https://a.test https://b.test",
    hasLinkCard: false,
    accountAgeHours: null,
    postsLastHour: 0,
    duplicate: false,
    config,
  });
  assert.equal(verdict?.code, "too_many_links");
});

test("cross-user duplication is flagged, never blocked", () => {
  resetRuleHits();
  assert.equal(shouldFlagCrossUserDuplicate({ sameBodyByOthers: 0 }), false);
  assert.equal(shouldFlagCrossUserDuplicate({ sameBodyByOthers: 2 }), true);
  assert.deepEqual(readRuleHits(), [{ rule: "cross_user_duplicate", count: 1 }]);
});

test("the durable codes map to something a person can read", () => {
  const tenMin = classifyPostWriteError("rate_limit:posts_10min");
  assert.equal(tenMin.status, 429);
  assert.match(String(tenMin.body.message), /Try again in a few minutes/);

  const day = classifyPostWriteError("rate_limit:posts_day");
  assert.equal(day.status, 429);
  assert.match(String(day.body.message), /tomorrow/);

  // The Phase 5 messages still map, so nothing regresses.
  assert.equal(classifyPostWriteError("You are posting too fast.").status, 429);
  assert.equal(classifyPostWriteError("You just posted that.").status, 409);
});

test("the spam verdict stops the insert, and a clean post still writes", async () => {
  let inserted = 0;
  const base = {
    session: { userId: "11111111-1111-4111-8111-111111111111", isAnonymous: false },
    raw: { body: "https://a.test https://b.test" },
    ip: "1.2.3.4",
    limiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) } as never,
    insert: async () => {
      inserted += 1;
      return { data: { id: "x" } as never, error: null };
    },
    spam: { accountAgeHours: 1, postsLastHour: 0, duplicate: false, config },
  };

  const refused = await handleCreatePost(base as never);
  assert.equal(refused.status, 400);
  assert.equal(inserted, 0, "nothing was written");

  const allowed = await handleCreatePost({
    ...base,
    spam: { accountAgeHours: 100, postsLastHour: 0, duplicate: false, config },
  } as never);
  assert.equal(allowed.status, 201);
  assert.equal(inserted, 1);
});
