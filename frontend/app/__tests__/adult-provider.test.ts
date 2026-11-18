// Adult provider: the four gates that keep it away from non-adult playback, the
// mapping/mapping-miss answers, the proxy handoff and the player badge.
//
// The isolation assertions matter most: with the provider enabled, a title that
// is not marked adult must cost exactly one indexed `anime` read and never
// reach the watchhentai service.

import assert from "node:assert/strict";
import test from "node:test";
import { variantBadge } from "@/app/lib/watch/adult/badge";
import {
  normalizeVariant,
  orderedVariants,
  readAdultConfig,
} from "@/app/lib/watch/adult/config";
import { pickSource } from "@/app/lib/watch/adult/watchhentai";
import {
  listAdultVariants,
  resolveAdultWatch,
} from "@/app/lib/watch/adult/resolve";

const ENV: Record<string, string> = {
  ADULT_PROVIDER_ENABLED: "1",
  WATCHHENTAI_API_URL: "https://adult.kumoritv.top",
  WATCHHENTAI_API_KEY: "test-key",
  ADULT_PREFERRED_QUALITY: "1080p",
  ADULT_CACHE_TTL_SECONDS: "600",
};

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = ENV[key];
  }
  return fn().finally(() => {
    for (const key of Object.keys(ENV)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

/** Minimal Supabase stand-in: one canned answer per table, recording reads. */
function fakeDb(tables: Record<string, unknown>) {
  const calls: string[] = [];
  const db = {
    calls,
    from(table: string) {
      calls.push(table);
      const rows = tables[table];
      const result =
        typeof rows === "function"
          ? (rows as () => unknown)()
          : { data: rows ?? null, error: null };
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => result,
        upsert: async () => ({ error: null }),
        then: (resolve: any) => resolve(result),
      };
      return builder;
    },
  };
  return db;
}

function okFetch() {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          title: "Hitori Tsuma – Episode 1",
          player: {
            referer: "https://watchhentai.net/",
            sources: [
              { src: "https://hstorage.xyz/a_720p.mp4", type: "video/mp4", label: "720p" },
              {
                src: "https://hstorage.xyz/a_1080p.mp4",
                type: "video/mp4",
                label: "1080p",
              },
            ],
          },
        },
      }),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const proxyCalls: any[] = [];
const proxy = (async (kind: string, options: any) => {
  proxyCalls.push({ kind, ...options });
  return "https://kumoritv.top/api/proxy/segment?u=signed";
}) as any;

test("config stays off unless the deployment opts in", () => {
  assert.equal(readAdultConfig({}), null);
  assert.equal(readAdultConfig({ ADULT_PROVIDER_ENABLED: "1" }), null);
  assert.equal(readAdultConfig(ENV)?.preferredQuality, "1080p");
});

test("only the two real variants are accepted", () => {
  assert.equal(normalizeVariant("Uncensored"), "uncensored");
  assert.equal(normalizeVariant("both"), null);
  assert.deepEqual(orderedVariants(["censored", "uncensored"]), [
    "uncensored",
    "censored",
  ]);
});

test("the preferred quality wins and the source referer is kept", () => {
  const source = pickSource(
    [
      { src: "https://x/720.mp4", label: "720p" },
      {
        src: "https://x/1080.mp4",
        label: "1080p",
        referer: "https://watchhentai.net/",
      },
    ],
    "1080p",
    "https://fallback/",
  );
  assert.equal(source?.url, "https://x/1080.mp4");
  assert.equal(source?.referer, "https://watchhentai.net/");
});

test("disabled: no database read and no network call", async () => {
  const db = fakeDb({});
  let fetched = 0;
  const decision = await resolveAdultWatch({
    db,
    anilistId: 21,
    episode: 1,
    variant: "uncensored",
    proxy,
    fetchImpl: (async () => {
      fetched += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    }) as any,
  });
  assert.deepEqual(decision, { kind: "skip", reason: "disabled" });
  assert.deepEqual(db.calls, []);
  assert.equal(fetched, 0);
});

test("enabled, not adult: one anime read, no mapping read, no service call", async () => {
  await withEnv(async () => {
    const db = fakeDb({ anime: { is_adult: false } });
    let fetched = 0;
    const decision = await resolveAdultWatch({
      db,
      anilistId: 21,
      episode: 1,
      variant: "uncensored",
      proxy,
      fetchImpl: (async () => {
        fetched += 1;
        return { ok: false, status: 500, json: async () => ({}) };
      }) as any,
    });
    assert.deepEqual(decision, { kind: "skip", reason: "not_adult" });
    assert.deepEqual(db.calls, ["anime"]);
    assert.equal(fetched, 0);
  });
});

test("mapped episode without that variant asks again with the real list", async () => {
  await withEnv(async () => {
    const db = fakeDb({
      anime: { is_adult: true },
      adult_sources: [
        { variant: "censored", wh_video_slug: "x-1", matched_title: "X" },
      ],
    });
    const decision = await resolveAdultWatch({
      db,
      anilistId: 900,
      episode: 1,
      variant: "uncensored",
      proxy,
      fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as any,
    });
    assert.equal(decision.kind, "unavailable");
    if (decision.kind !== "unavailable") return;
    assert.equal(decision.code, "ADULT_VARIANT_UNAVAILABLE");
    assert.deepEqual(decision.variants, ["censored"]);
  });
});

test("a mapped episode resolves through the proxy with the source referer", async () => {
  await withEnv(async () => {
    const db = fakeDb({
      anime: { is_adult: true },
      adult_sources: [
        { variant: "uncensored", wh_video_slug: "x-1-uncensored", matched_title: "X" },
      ],
      adult_stream_cache: null,
    });
    const { impl } = okFetch();
    proxyCalls.length = 0;
    const decision = await resolveAdultWatch({
      db,
      anilistId: 900,
      episode: 1,
      variant: "uncensored",
      proxy,
      fetchImpl: impl,
    });
    assert.equal(decision.kind, "ok");
    if (decision.kind !== "ok") return;
    assert.equal(decision.body.provider, "wh");
    assert.equal(decision.body.type, "mp4");
    assert.equal(decision.body.variant, "uncensored");
    assert.equal(decision.body.quality, "1080p");
    assert.equal(decision.body.adult, true);
    assert.deepEqual(proxyCalls[0], {
      kind: "segment",
      u: "https://hstorage.xyz/a_1080p.mp4",
      h: { referer: "https://watchhentai.net/" },
      f: "mp4",
    });
  });
});

test("the chooser lists mapped variants uncensored first", async () => {
  await withEnv(async () => {
    const db = fakeDb({
      anime: { is_adult: true },
      adult_sources: [
        { variant: "censored", wh_video_slug: "x-1", matched_title: "X" },
        { variant: "uncensored", wh_video_slug: "x-1-u", matched_title: "X" },
      ],
    });
    assert.deepEqual(await listAdultVariants(db, 900, 1), {
      providerEnabled: true,
      adult: true,
      variants: ["uncensored", "censored"],
    });
  });
});

test("the chooser says nothing at all when the provider is off", async () => {
  const db = fakeDb({});
  assert.deepEqual(await listAdultVariants(db, 21, 1), {
    providerEnabled: false,
    adult: false,
    variants: [],
  });
  assert.deepEqual(db.calls, []);
});

test("the badge names the version and its tone", () => {
  assert.deepEqual(variantBadge("uncensored"), {
    label: "UNCENSORED",
    tone: "uncensored",
  });
  assert.deepEqual(variantBadge("censored"), {
    label: "CENSORED",
    tone: "censored",
  });
  assert.equal(variantBadge(undefined), null);
});
