#!/usr/bin/env node
/**
 * Live smoke check against the real ani-api.
 *
 *   ANI_API_BASE_URL=https://ani-api.kumoritv.top ANI_API_KEY=... \
 *     node scripts/ani-live-check.mjs
 *
 * For MAL 21 ep 1, MAL 52299 ep 1 and MAL 16498 ep 1 it prints what the API
 * says (stream_verified, variants, subtitle labels and languages) and then
 * fetches the master playlist and the first segment the way this app does:
 * master and playlist with `Referer`, segments with none.
 *
 * The key is read from the environment and never printed, never written and
 * never put in the output - including on error.
 */
const BASE = (process.env.ANI_API_BASE_URL || "").replace(/\/+$/, "");
const KEY = (process.env.ANI_API_KEY || "").trim();
const CASES = [
  { malId: 21, episode: 1, label: "MAL 21 (One Piece) ep 1" },
  { malId: 52299, episode: 1, label: "MAL 52299 ep 1" },
  { malId: 16498, episode: 1, label: "MAL 16498 ep 1" },
];

if (!BASE || !KEY) {
  console.error(
    "ANI_API_BASE_URL and ANI_API_KEY must be set in the environment. Nothing was called.",
  );
  process.exit(2);
}

const allowed = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      ["dramahot.top", "drama1.cfd"].some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
      ) || /\.drama1\.cfd$/.test(host)
    );
  } catch {
    return false;
  }
};

async function call(malId, episode) {
  const url = `${BASE}/v1/streams/mal/${malId}/episode/${episode}?audio=sub&quality=best`;
  const started = Date.now();
  const response = await fetch(url, {
    headers: { "x-api-key": KEY, "user-agent": "KumoriTV", accept: "application/json" },
  });
  const body = await response.json().catch(() => null);
  return { response, body, ms: Date.now() - started };
}

async function fetchFirst(url, headers) {
  try {
    const response = await fetch(url, {
      headers: { ...headers, range: "bytes=0-255" },
      signal: AbortSignal.timeout(10_000),
    });
    const buffer = new Uint8Array(await response.arrayBuffer()).slice(0, 16);
    const head = Array.from(buffer.slice(0, 4))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    return `${response.status} ${response.headers.get("content-type") || "?"} [${head}]`;
  } catch (error) {
    return `FAILED ${error?.name || "error"}`;
  }
}

let failures = 0;

for (const testCase of CASES) {
  console.log(`\n=== ${testCase.label} ===`);
  try {
    const { response, body, ms } = await call(testCase.malId, testCase.episode);
    console.log(`http ${response.status} in ${ms} ms`);

    if (!response.ok || !body) {
      console.log(`code: ${body?.code || "?"} title: ${body?.title || "?"}`);
      failures++;
      continue;
    }

    console.log(`provider: ${body.provider} stream_type: ${body.stream_type}`);
    console.log(
      `mal: id=${body.mal?.mal_id} episode=${body.mal?.mal_episode} ` +
        `stream_verified=${body.mal?.stream_verified} verification=${body.mal?.verification}`,
    );
    console.log(
      `audio: declared=${body.audio?.declared} verified=${body.audio?.verified} ` +
        `detected_language=${body.audio?.detected_language ?? "null"}`,
    );
    const variants = (body.variants || []).map(
      (variant) => `${variant.quality}:${variant.playable ? "playable" : "blocked"}`,
    );
    console.log(`variants: ${variants.join(", ") || "none"}`);
    console.log(
      `url_lifetime: observed_valid_for_minutes=${body.url_lifetime?.observed_valid_for_minutes} ` +
        `expiry_known=${body.url_lifetime?.expiry_known}`,
    );

    const tracks = body.subtitles || [];
    console.log(`subtitles: ${tracks.length}`);
    for (const track of tracks) {
      console.log(
        `  - label=${JSON.stringify(track.label)} language=${track.language} ` +
          `kind=${track.kind} format=${track.format} converted=${track.converted} ` +
          `playable=${track.playable} default=${track.default} ` +
          `language_verified=${track.language_verified}`,
      );
    }

    if (!body.mal?.stream_verified) {
      console.log("REFUSED by KumoriTV: stream_verified is not true");
      failures++;
    } else if (!allowed(body.master_url || "")) {
      console.log(`REFUSED by KumoriTV: master host not allowed (${body.master_url || "none"})`);
      failures++;
    } else {
      const referer = body.headers_required?.master_playlist?.Referer || "";
      console.log(`master: ${await fetchFirst(body.master_url, { referer })}`);
      const first = body.variants?.find((variant) => variant.playable)?.first_segment_url;
      if (first) console.log(`first segment: ${await fetchFirst(first, {})}`);
    }

    if (body.warnings?.length) console.log(`warnings: ${body.warnings.join(" | ")}`);
  } catch (error) {
    console.log(`FAILED: ${error?.name || "error"}: ${error?.message || ""}`);
    failures++;
  }
}

console.log(`\n${failures === 0 ? "all cases usable" : `${failures} case(s) not usable`}`);
process.exit(failures === 0 ? 0 : 1);
