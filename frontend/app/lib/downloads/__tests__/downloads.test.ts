import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetDownloadCacheForTests,
  buildDownloadGroups,
  downloadAd,
  downloadHosts,
  downloadsEnabled,
  getEpisodeDownloads,
  isAllowedDownloadUrl,
  mapDownloadResponse,
  qualityRank,
  type DownloadFetch,
} from "../index";
import { openSponsoredPage, shouldOpenAd } from "../ad";

// Real shape, 2026-11-15: 6 sources (dub 1080/720/360 + sub 1080/720/360).
const SIX_SOURCES = [
  { provider: "Kiwi", audio: "dub", quality: "1080p", url: "https://pahe.nekostream.site/d1" },
  { provider: "Kiwi", audio: "dub", quality: "720p", url: "https://pahe.nekostream.site/d2" },
  { provider: "Kiwi", audio: "dub", quality: "360p", url: "https://pahe.nekostream.site/d3" },
  { provider: "Kiwi", audio: "sub", quality: "1080p", url: "https://pahe.nekostream.site/s1" },
  { provider: "Kiwi", audio: "sub", quality: "720p", url: "https://pahe.nekostream.site/s2" },
  { provider: "Kiwi", audio: "sub", quality: "360p", url: "https://pahe.nekostream.site/s3" },
];

test("the flag is off unless DOWNLOADS_ENABLED=1", () => {
  delete process.env.DOWNLOADS_ENABLED;
  assert.equal(downloadsEnabled(), false);
  process.env.DOWNLOADS_ENABLED = "1";
  try {
    assert.equal(downloadsEnabled(), true);
  } finally {
    delete process.env.DOWNLOADS_ENABLED;
  }
});

test("hosts: only https on nekostream.site (or DOWNLOAD_HOSTS) survives", () => {
  assert.deepEqual(downloadHosts(), ["nekostream.site"]);
  assert.equal(isAllowedDownloadUrl("https://pahe.nekostream.site/x"), true);
  assert.equal(isAllowedDownloadUrl("https://nekostream.site.evil.com/x"), false);
  assert.equal(isAllowedDownloadUrl("http://pahe.nekostream.site/x"), false);
  assert.equal(isAllowedDownloadUrl("https://user:pass@pahe.nekostream.site/x"), false);
  assert.equal(isAllowedDownloadUrl("javascript:alert(1)"), false);
  process.env.DOWNLOAD_HOSTS = "example.org";
  try {
    assert.equal(isAllowedDownloadUrl("https://pahe.nekostream.site/x"), false);
    assert.equal(isAllowedDownloadUrl("https://cdn.example.org/x"), true);
  } finally {
    delete process.env.DOWNLOAD_HOSTS;
  }
});

test("groups: sub before dub, qualities high to low, odd qualities kept as-is", () => {
  const groups = buildDownloadGroups(SIX_SOURCES);
  assert.deepEqual(groups.map((group) => group.audio), ["sub", "dub"]);
  assert.deepEqual(groups[0].options.map((option) => option.quality), ["1080p", "720p", "360p"]);
  // Naruto: sub 360 + 800 -> 800p stays 800p and sorts above 360p.
  const odd = buildDownloadGroups([
    { provider: "Kiwi", audio: "sub", quality: "360p", url: "https://pahe.nekostream.site/a" },
    { provider: "Kiwi", audio: "sub", quality: "800p", url: "https://pahe.nekostream.site/b" },
  ]);
  assert.deepEqual(odd[0].options.map((option) => option.quality), ["800p", "360p"]);
  assert.equal(qualityRank("1080p"), 1080);
  assert.equal(qualityRank("800p"), 800);
  // One Piece: sub-only 1080/720 -> no dub tab at all.
  const subOnly = buildDownloadGroups(SIX_SOURCES.slice(3));
  assert.deepEqual(subOnly.map((group) => group.audio), ["sub"]);
});

test("the browser payload says Kiwi, sorted, and never leaks a host it dropped", () => {
  const payload = mapDownloadResponse({
    available: true,
    provider: "nekostream",
    sources: [
      ...SIX_SOURCES,
      { provider: "Kiwi", audio: "sub", quality: "1080p", url: "https://evil.example/x" },
    ],
    note: "ok",
  });
  assert.equal(payload.available, true);
  assert.equal(payload.provider, "Kiwi");
  assert.equal(payload.groups[0].audio, "sub");
  assert.equal(
    payload.groups.flatMap((group) => group.options).some((option) => option.url.includes("evil")),
    false,
  );
});

test("available:false -> no button; unmapped MAL is a negative cache", async () => {
  __resetDownloadCacheForTests();
  const noLinks = mapDownloadResponse({ available: false, reason: "UPSTREAM_HAS_NO_LINKS", sources: [] });
  assert.equal(noLinks.available, false);
  assert.deepEqual(noLinks.groups, []);

  process.env.ANI_API_BASE_URL = "https://ani.test";
  process.env.ANI_API_KEY = "unit-key-never-printed";
  try {
    let calls = 0;
    const fetchImpl: DownloadFetch = async () => {
      calls += 1;
      return {
        ok: false,
        status: 404,
        json: async () => ({ code: "ANIKOTO_NOT_MAPPED" }),
      };
    };
    const first = await getEpisodeDownloads({ malId: 99999, episode: 1, fetchImpl });
    const second = await getEpisodeDownloads({ malId: 99999, episode: 1, fetchImpl });
    assert.equal(first.payload.available, false);
    assert.equal(second.cached, true);
    assert.equal(calls, 1, "the 404 is cached for 30 minutes");
    assert.equal(JSON.stringify(first.payload).includes("unit-key-never-printed"), false);
  } finally {
    delete process.env.ANI_API_BASE_URL;
    delete process.env.ANI_API_KEY;
    __resetDownloadCacheForTests();
  }
});

test("single flight: concurrent readers cost one upstream call", async () => {
  __resetDownloadCacheForTests();
  process.env.ANI_API_BASE_URL = "https://ani.test";
  process.env.ANI_API_KEY = "unit-key";
  try {
    let calls = 0;
    const fetchImpl: DownloadFetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mal_id: 21,
          episode_number: 1,
          available: true,
          provider: "nekostream",
          sources: SIX_SOURCES,
        }),
      };
    };
    const [a, b] = await Promise.all([
      getEpisodeDownloads({ malId: 21, episode: 1, fetchImpl }),
      getEpisodeDownloads({ malId: 21, episode: 1, fetchImpl }),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.payload.available, true);
    assert.equal(b.payload.groups.length, 2);
  } finally {
    delete process.env.ANI_API_BASE_URL;
    delete process.env.ANI_API_KEY;
    __resetDownloadCacheForTests();
  }
});

test("ad: empty DOWNLOAD_AD_URL means no ad at all", () => {
  delete process.env.DOWNLOAD_AD_URL;
  assert.equal(downloadAd(), null);
  assert.equal(shouldOpenAd(null, Date.now(), 0), false);
  process.env.DOWNLOAD_AD_URL = "https://uplcm.com/4/12159130";
  try {
    const ad = downloadAd();
    assert.deepEqual(ad, { url: "https://uplcm.com/4/12159130", intervalMin: 30 });
  } finally {
    delete process.env.DOWNLOAD_AD_URL;
  }
});

test("ad frequency cap uses localStorage, is per click and never throws", () => {
  const ad = { url: "https://uplcm.com/4/12159130", intervalMin: 30 };
  let now = 1_700_000_000_000;
  let stored: string | null = null;
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  let opens = 0;
  const open = () => {
    opens += 1;
    return {};
  };

  assert.equal(openSponsoredPage(ad, { now, storage, open }), true);
  assert.equal(opens, 1);
  assert.equal(openSponsoredPage(ad, { now: now + 60_000, storage, open }), false);
  now += 30 * 60_000;
  assert.equal(openSponsoredPage(ad, { now, storage, open }), true);
  assert.equal(opens, 2);

  // interval 0 = every click
  assert.equal(shouldOpenAd({ url: ad.url, intervalMin: 0 }, now, now), true);

  // A blocked popup reports nothing and records nothing.
  const blocked = () => null;
  const fresh = { ...ad };
  let wrote = false;
  const freshStorage = {
    getItem: () => null,
    setItem: () => {
      wrote = true;
    },
  };
  assert.equal(openSponsoredPage(fresh, { now, storage: freshStorage, open: blocked }), false);
  assert.equal(wrote, false);

  // A throwing storage must not break the download.
  const angry = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(openSponsoredPage(ad, { now, storage: angry, open }), true);
  assert.equal(openSponsoredPage(ad, { now, storage: null, open: null }), false);
});
