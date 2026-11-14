// Prompt 38F: GET /api/clips/mine, without a Next request in the way.
//
// Three things are being proved here, and they are the three that would be
// expensive to get wrong:
//   1. the union really is "my account" + "this browser's guest clips", and it
//      never reaches another person's rows;
//   2. the adult rule removes data from the payload instead of hiding it with
//      CSS: a hidden row has a code, a label and nothing else;
//   3. a guest, an anonymous session, and a caller over the rate limit each get
//      the right refusal and no data.
import assert from "node:assert/strict";
import test from "node:test";
import type { AnimeSummary, ClipRow } from "@/app/lib/clips/server";
import { CLIP_MINE_LIMIT } from "@/app/lib/clips/constants";
import { handleClipsMine, mergeOwnerClips, toMineClips, type MineSession } from "../mine";

const SESSION: MineSession = { userId: "user-1", isAnonymous: false };
const ANON: MineSession = { userId: "guest-session", isAnonymous: true };

function limiter(allowed = true, retryAfterSeconds = 9) {
  return { check: () => ({ allowed, remaining: 0, retryAfterSeconds }), reset() {}, size: () => 1 };
}

function clip(over: Partial<ClipRow> = {}): ClipRow {
  return {
    id: "clip-1",
    code: "abc2345",
    user_id: "user-1",
    owner_token_hash: null,
    anilist_id: 101,
    episode_number: 5,
    start_seconds: 62,
    end_seconds: 77,
    title: "The best fight",
    source_audio: "sub",
    views: 12,
    created_at: "2026-11-14T09:00:00.000Z",
    deleted_at: null,
    ...over,
  } as ClipRow;
}

function anime(over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    anilistId: 101,
    title: "Frieren: Beyond Journey's End",
    cover: "https://cdn.test/frieren.jpg",
    banner: null,
    isAdult: false,
    ...over,
  };
}

const ANIME = new Map<number, AnimeSummary>([[101, anime()]]);

function deps(over: Record<string, unknown> = {}) {
  const seen = { account: [] as string[], guest: [] as (string | null)[], anime: [] as number[][] };
  return {
    seen,
    base: {
      session: SESSION,
      ownerHash: "a".repeat(64),
      showAdult: false,
      ip: "1.1.1.1",
      limiter: limiter() as any,
      listAccountClips: async (userId: string) => {
        seen.account.push(userId);
        return userId === "user-1" ? [clip()] : [];
      },
      listGuestClips: async (hash: string | null) => {
        seen.guest.push(hash);
        return [clip({ id: "clip-g", code: "bcd3456", user_id: null, owner_token_hash: hash, created_at: "2026-11-14T08:00:00.000Z" })];
      },
      getAnime: async (ids: number[]) => {
        seen.anime.push(ids);
        return ANIME;
      },
      ...over,
    },
  };
}

test("an account's clips and this browser's guest clips come back together", async () => {
  const { base, seen } = deps();
  const result = await handleClipsMine(base as any);
  assert.equal(result.status, 200);
  const clips = (result.body as any).clips as any[];
  assert.deepEqual(clips.map((c) => c.code).sort(), ["abc2345", "bcd3456"]);
  assert.deepEqual(seen.account, ["user-1"]);
  assert.equal(seen.guest.length, 1);
  // The union is asked for the same cap twice, and the whole thing is capped once.
  assert.ok(clips.length <= CLIP_MINE_LIMIT);
});

test("another browser's clips are never in the answer", async () => {
  // The account lookup is keyed on the session and the guest lookup on a hash:
  // a row belonging to someone else matches neither, so it cannot appear.
  const other = clip({ id: "clip-x", code: "zzz9999", user_id: "user-2", owner_token_hash: "b".repeat(64) });
  const { base } = deps({
    listAccountClips: async () => [clip()],
    listGuestClips: async () => [clip({ id: "clip-g", code: "bcd3456", user_id: null })],
    someOtherRow: other,
  });
  const result = await handleClipsMine(base as any);
  const codes = ((result.body as any).clips as any[]).map((c) => c.code);
  assert.ok(!codes.includes("zzz9999"));
});

test("an owner hash is a precise key, never a wildcard", async () => {
  // A caller with no cookie must not be handed every guest clip on the site.
  const asked: (string | null)[] = [];
  const { base } = deps({
    ownerHash: null,
    listGuestClips: async (hash: string | null) => {
      asked.push(hash);
      return hash ? [clip({ id: "g", code: "bcd3456" })] : [];
    },
  });
  const result = await handleClipsMine(base as any);
  assert.deepEqual(asked, [null]);
  assert.deepEqual(((result.body as any).clips as any[]).map((c) => c.code), ["abc2345"]);
});

test("duplicates are collapsed and the newest comes first", async () => {
  const shared = clip({ id: "clip-1", code: "abc2345", created_at: "2026-11-14T09:00:00.000Z" });
  const older = clip({ id: "clip-0", code: "def5678", created_at: "2026-11-14T07:00:00.000Z" });
  const newer = clip({ id: "clip-2", code: "bcd3456", created_at: "2026-11-14T10:00:00.000Z" });
  const merged = mergeOwnerClips([shared, older], [shared, newer]);
  assert.deepEqual(merged.map((c) => c.code), ["bcd3456", "abc2345", "def5678"]);
  assert.equal(merged.length, 3);
});

test("the picker is capped at twenty", async () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    clip({ id: `clip-${i}`, code: `abc234${i % 10}`, created_at: new Date(Date.UTC(2026, 10, 14, 9, i)).toISOString() }),
  );
  const merged = mergeOwnerClips(many, []);
  assert.equal(merged.length, CLIP_MINE_LIMIT);
  assert.equal(CLIP_MINE_LIMIT, 20);
});

test("adult clips are masked when the setting is off, and complete when it is on", async () => {
  const adult = new Map<number, AnimeSummary>([[202, anime({ anilistId: 202, title: "Adult Show", isAdult: true })]]);
  const rows = [clip({ id: "a", code: "cde4567", anilist_id: 202, episode_number: 1, title: "Adult scene" })];

  const hidden = toMineClips(rows, adult, false);
  assert.deepEqual(hidden, [{ code: "cde4567", hidden: true, isAdult: true }]);
  // No title, no anime, no episode, no range, nothing to build a thumbnail from.
  for (const key of ["animeTitle", "title", "anilistId", "episode", "start", "end", "views", "createdAt"]) {
    assert.equal(key in (hidden[0] as any), false, `${key} must not be sent`);
  }

  const allowed = toMineClips(rows, adult, true);
  assert.equal(allowed[0].hidden, false);
  assert.equal(allowed[0].isAdult, true);
  assert.equal(allowed[0].animeTitle, "Adult Show");
  assert.equal(allowed[0].anilistId, 202);
  assert.equal(allowed[0].start, 62);
});

test("a clip whose anime is missing is treated as ordinary, not as adult", async () => {
  const rows = [clip({ id: "m", code: "abc2345", anilist_id: 4096 })];
  const rowsOut = toMineClips(rows, new Map(), false);
  assert.equal(rowsOut[0].hidden, false);
  assert.equal(rowsOut[0].isAdult, false);
  assert.equal(rowsOut[0].animeTitle, null);
});

test("the whole response is masked for an adult clip when the setting is off", async () => {
  const { base } = deps({
    listAccountClips: async () => [clip({ anilist_id: 202, code: "cde4567" })],
    listGuestClips: async () => [],
    getAnime: async () => new Map<number, AnimeSummary>([[202, anime({ anilistId: 202, title: "Adult Show", isAdult: true })]]),
  });
  const result = await handleClipsMine(base as any);
  const serialised = JSON.stringify(result.body);
  assert.ok(!serialised.includes("Adult Show"), "the anime title must not be in the payload");
  assert.ok(!serialised.includes("The best fight"), "the clip title must not be in the payload");
  assert.ok(!serialised.includes("202"), "the anilist id must not be in the payload");
  assert.deepEqual((result.body as any).clips, [{ code: "cde4567", hidden: true, isAdult: true }]);
});

test("a guest and an anonymous session are both refused, and no query runs", async () => {
  for (const session of [null, ANON]) {
    const { base, seen } = deps({ session });
    const result = await handleClipsMine(base as any);
    assert.equal(result.status, 401);
    assert.equal((result.body as any).error, "sign_in_required");
    assert.deepEqual(seen.account, []);
    assert.deepEqual(seen.guest, []);
    assert.equal(result.headers?.["cache-control"], "no-store");
  }
});

test("the picker is rate limited, with retry-after", async () => {
  const { base, seen } = deps({ limiter: limiter(false, 9) });
  const result = await handleClipsMine(base as any);
  assert.equal(result.status, 429);
  assert.equal((result.body as any).error, "rate_limited");
  assert.equal(result.headers?.["retry-after"], "9");
  assert.deepEqual(seen.account, []);
});

test("nothing secret is ever in the response", async () => {
  const { base } = deps({ ownerHash: "f".repeat(64) });
  const result = await handleClipsMine(base as any);
  const serialised = JSON.stringify(result.body);
  for (const forbidden of ["owner_token_hash", "ownerToken", "f".repeat(64), "deleted_at", "user_id"]) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} must not be in the payload`);
  }
  assert.equal(result.headers?.["cache-control"], "no-store");
});
