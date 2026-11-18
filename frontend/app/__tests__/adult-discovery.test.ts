// Appended coverage: the provider has to work on a catalogue where nobody has
// made a mapping row yet, and it must never invent one.
import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverAdultSources,
  titlesForDiscovery,
  variantFromSeries,
} from "@/app/lib/watch/adult/auto";
import { readAdultConfig } from "@/app/lib/watch/adult/config";
import { resolveAdultWatch } from "@/app/lib/watch/adult/resolve";

const ENV: Record<string, string> = {
  ADULT_PROVIDER_ENABLED: "1",
  WATCHHENTAI_API_URL: "https://adult.kumoritv.top",
  WATCHHENTAI_API_KEY: "test-key",
  ADULT_PREFERRED_QUALITY: "1080p",
  ADULT_CACHE_TTL_SECONDS: "600",
};

async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = ENV[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(ENV)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

type Route = { match: unknown; series: Record<string, unknown>; watch?: unknown };

function serviceFetch(routes: Route) {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/match")) {
      return { ok: true, status: 200, json: async () => routes.match };
    }
    if (url.includes("/api/series/")) {
      const slug = url.split("/api/series/")[1].split("?")[0];
      const payload = routes.series[decodeURIComponent(slug)];
      if (!payload) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => payload };
    }
    if (url.includes("/api/watch/") && routes.watch) {
      return { ok: true, status: 200, json: async () => routes.watch };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const series = (
  title: string,
  censored: string,
  episodeUrl: string,
  number = 1,
): unknown => ({
  success: true,
  data: {
    title,
    censored,
    episodes: [{ number, title: `Episode ${number}`, url: episodeUrl }],
  },
});

test("a series is named by its own wording before its slug", () => {
  assert.equal(variantFromSeries({ censored: "uncensored" }), "uncensored");
  assert.equal(variantFromSeries({ slug: "x-uncensored-id-01" }), "uncensored");
  assert.equal(variantFromSeries({ title: "Some Show Censored" }), "censored");
  assert.equal(variantFromSeries({ title: "Hitori Tsuma" }), null);
});

test("discovery keeps every real variant and drops the rest", async () => {
  const { impl, calls } = serviceFetch({
    match: {
      success: true,
      data: {
        candidates: [
          { title: "Arisugawa", slug: "ari-uncensored", url: "", score: 1, variant: "unknown" },
          { title: "Hitori Tsuma", slug: "hitori", url: "", score: 0.95, variant: "unknown" },
          { title: "Almost", slug: "almost", url: "", score: 0.4, variant: "unknown" },
          { title: "Episodeless", slug: "episodeless", url: "", score: 0.9, variant: "unknown" },
        ],
      },
    },
    series: {
      "ari-uncensored": series("Arisugawa", "uncensored", "https://w/videos/ari-ep1-uncensored-id-01/"),
      hitori: series("Hitori Tsuma", "censored", "https://w/videos/hitori-tsuma-episode-1-id-01/"),
      episodeless: series("Empty", "censored", "https://w/videos/nope-episode-9-id-01/", 9),
    },
  }) as any;

  const found = await discoverAdultSources({
    config: readAdultConfig(ENV)!,
    titles: ["Hitori Tsuma"],
    episode: 1,
    fetchImpl: impl,
  });

  assert.deepEqual(
    found.map((item) => [item.variant, item.videoSlug]).sort(),
    [
      ["censored", "hitori-tsuma-episode-1-id-01"],
      ["uncensored", "ari-ep1-uncensored-id-01"],
    ],
  );
  // Below the score floor the page is never even opened...
  assert.equal(calls.filter((url) => url.includes("/api/series/almost")).length, 0);
  // ...while a good match that simply has no episode 1 is opened once and dropped.
  assert.equal(calls.filter((url) => url.includes("/api/series/episodeless")).length, 1);
});

test("titles for discovery are trimmed, deduped and capped", () => {
  assert.deepEqual(
    titlesForDiscovery({ title: " A ", title_english: "a", title_romaji: "B" }),
    ["A", "B"],
  );
  assert.deepEqual(titlesForDiscovery(null), []);
});

test("an unmapped adult episode resolves by discovery alone", async () => {
  await withEnv(async () => {
    const { impl, calls } = serviceFetch({
      match: {
        success: true,
        data: { candidates: [{ title: "Hitori Tsuma", slug: "hitori", score: 1 }] },
      },
      series: {
        hitori: series("Hitori Tsuma", "censored", "https://w/videos/hitori-tsuma-episode-1-id-01/"),
      },
      watch: {
        success: true,
        data: {
          title: "Hitori Tsuma – Episode 1",
          player: {
            referer: "https://watchhentai.net/",
            sources: [
              { src: "https://hstorage.xyz/hitori_720p.mp4", type: "video/mp4", label: "720p" },
              { src: "https://hstorage.xyz/hitori_1080p.mp4", type: "video/mp4", label: "1080p" },
            ],
          },
        },
      },
    }) as any;

    const writes: any[] = [];
    const db: any = {
      from(table: string) {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () =>
            table === "anime"
              ? {
                  data: {
                    is_adult: true,
                    title: "Hitori Tsuma",
                    title_english: null,
                    title_romaji: null,
                  },
                  error: null,
                }
              : { data: null, error: null },
          upsert: async (rows: any) => {
            writes.push({ table, rows });
            return { error: null };
          },
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
        return builder;
      },
    };

    const proxied: any[] = [];
    const proxy = (async (_kind: string, options: any) => {
      proxied.push(options);
      return "https://kumoritv.top/api/proxy/segment?u=signed";
    }) as any;

    const decision = await resolveAdultWatch({
      db,
      anilistId: 900,
      episode: 1,
      variant: "censored",
      proxy,
      fetchImpl: impl,
    });

    assert.equal(decision.kind, "ok", JSON.stringify(decision));
    const body = (decision as any).body;
    assert.equal(body.provider, "wh");
    assert.equal(body.variant, "censored");
    assert.equal(body.url, "https://kumoritv.top/api/proxy/segment?u=signed");
    assert.deepEqual(proxied[0], {
      u: "https://hstorage.xyz/hitori_1080p.mp4",
      h: { referer: "https://watchhentai.net/" },
      f: "mp4",
    });
    // The discovered source was written back so the next request is one read.
    const mappingWrite = writes.find((write) => write.table === "adult_sources");
    assert.ok(mappingWrite, "discovery wrote a mapping row");
    assert.equal(mappingWrite.rows[0].auto, true);
    assert.equal(mappingWrite.rows[0].wh_video_slug, "hitori-tsuma-episode-1-id-01");
    assert.equal(writes.filter((write) => write.table === "adult_stream_cache").length, 1);
    assert.ok(calls.some((url) => url.includes("/api/match?title=Hitori")));
  });
});

test("an episode the service does not have stays unavailable, not wrong", async () => {
  await withEnv(async () => {
    const { impl } = serviceFetch({
      match: { success: true, data: { candidates: [{ title: "Hitori", slug: "hitori", score: 1 }] } },
      series: {
        hitori: series("Hitori Tsuma", "censored", "https://w/videos/hitori-tsuma-episode-1-id-01/"),
      },
    }) as any;

    const db: any = {
      from() {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({
            data: { is_adult: true, title: "Hitori Tsuma" },
            error: null,
          }),
          upsert: async () => ({ error: null }),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
        return builder;
      },
    };

    const decision = await resolveAdultWatch({
      db,
      anilistId: 900,
      episode: 7,
      variant: "censored",
      proxy: (async () => "signed") as any,
      fetchImpl: impl,
    });

    assert.equal(decision.kind, "unavailable");
    assert.equal((decision as any).variants.length, 0);
  });
});
