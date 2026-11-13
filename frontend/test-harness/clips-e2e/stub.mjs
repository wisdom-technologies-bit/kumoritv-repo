// Prompt 35 Playwright stand-in.
//
// ONE local server that pretends to be, in order:
//   * Supabase Auth   (/auth/v1/*)    - a stand-in session, no real JWT check
//   * PostgREST       (/rest/v1/*)    - an in-memory anime/episodes/clips table
//   * AniList         (POST /graphql) - one anime, media 21
//   * AniVexa         (/ep/*)         - provider streams pointing at /test.mp4
//   * the video file  (/test.mp4, /subs.vtt, /embed)
//
// It is a STAND-IN: no Supabase, no PostgREST, no AniList and no provider is
// contacted by these tests. Everything is in process, and it lives only here.

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.STUB_PORT || 54321);
const ORIGIN = `http://127.0.0.1:${PORT}`;
// The app refuses to proxy private targets (SSRF guard), so the video and its
// subtitles are reached through a hostname that resolves to this stub
// (127.0.0.1 clip-test.example in /etc/hosts). Nothing leaves the machine.
const MEDIA_HOST = `http://clip-test.example:${PORT}`;
const USER_TOKEN = "standin-user-token";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const here = path.dirname(fileURLToPath(import.meta.url));

// Prompt 36: the video may be the committed VP9 `test.webm` or an H.264
// `test.mp4` generated with the README's ffmpeg command. Chromium's bundled
// build does not decode H.264, so the webm is preferred when both exist.
const VIDEO_FILE = ["test.webm", "test.mp4"]
  .map((name) => path.join(here, name))
  .find((file) => existsSync(file));
if (!VIDEO_FILE) {
  throw new Error(
    "no test video: commit test-harness/clips-e2e/test.webm or generate test.mp4 (see README)",
  );
}
const VIDEO = readFileSync(VIDEO_FILE);
const VIDEO_TYPE = VIDEO_FILE.endsWith(".webm") ? "video/webm" : "video/mp4";
const VTT = "WEBVTT\n\n00:00.000 --> 00:40.000\nClip test subtitles\n";

/** 240x360 placeholder poster (base64 JPEG, decoded once at boot). */
const COVER = Buffer.from(
  "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",
  "base64",
);

const ANIME = {
  anilist_id: 21,
  mal_id: 21,
  title: "Clip Test Anime",
  title_romaji: "Clip Test Anime",
  title_english: "Clip Test Anime",
  title_native: "クリップ",
  description: "A stand-in anime used by the clips end-to-end test.",
  cover_url: `${ORIGIN}/cover.jpg`,
  banner_url: `${ORIGIN}/banner.jpg`,
  format: "TV",
  status: "RELEASING",
  season: "WINTER",
  season_year: 2024,
  total_episodes: 12,
  duration: 1440,
  genres: ["Action"],
  score: 80,
  is_adult: false,
  has_streams: true,
};

const episodes = [
  {
    play_id: "21-1",
    anilist_id: 21,
    episode_number: 1,
    title: "The Test Episode",
    image_url: `${ORIGIN}/cover.jpg`,
    duration: 1440,
    filler: false,
    recap: false,
    sub_providers: [
      { provider: "mkissa", episodeId: "/ep/hd" },
      { provider: "mkissa", episodeId: "/ep/other" },
    ],
    dub_providers: [],
    resolved_provider: "mkissa",
    resolved_audio: "sub",
    needs_resync: false,
  },
  {
    // Episode 2 keeps an embed and an HD server: the route prefers the working
    // non-embed, so the notice does not appear here.
    // Episode 3 is embed-only, which is the state the notice exists for.
    play_id: "21-2",
    anilist_id: 21,
    episode_number: 2,
    title: "Embed Episode",
    image_url: `${ORIGIN}/cover.jpg`,
    duration: 1440,
    filler: false,
    recap: false,
    sub_providers: [
      { provider: "mkissa", episodeId: "/ep/embed" },
      { provider: "mkissa", episodeId: "/ep/hd2" },
    ],
    dub_providers: [],
    resolved_provider: "mkissa",
    resolved_audio: "sub",
    needs_resync: false,
  },
  {
    play_id: "21-3",
    anilist_id: 21,
    episode_number: 3,
    title: "Embed Only Episode",
    image_url: `${ORIGIN}/cover.jpg`,
    duration: 1440,
    filler: false,
    recap: false,
    sub_providers: [{ provider: "mkissa", episodeId: "/ep/embed" }],
    dub_providers: [],
    resolved_provider: "mkissa",
    resolved_audio: "sub",
    needs_resync: false,
  },
];

const clips = [];
const reports = [];
let clipId = 0;

// Prompt 36: SEED_CLIP=1 puts one known clip in the table so a layout run can
// go straight to /clip/<code> instead of creating a clip through the player.
// Line: "code,start,end,episode,title". Off by default.
if (process.env.SEED_CLIP === "1") {
  const [code, start, end, episode, title] = (process.env.SEED_CLIP_SPEC ||
    "93xjyak,2,5,1,A stand-in clip")
    .split(",");
  clips.push({
    id: `clip-${++clipId}`,
    code,
    anilist_id: 21,
    episode_number: Number(episode || 1),
    start_seconds: Number(start || 0),
    end_seconds: Number(end || 5),
    title: (title || "").trim() || null,
    user_id: null,
    owner_token_hash: null,
    source_audio: "sub",
    views: Number(process.env.SEED_CLIP_VIEWS || 2),
    created_at: envCreatedAt(),
    deleted_at: null,
  });
}

function envCreatedAt() {
  const value = process.env.SEED_CLIP_CREATED || "2026-11-13T00:30:00.000Z";
  return value;
}

const substream = (suffix, server) => ({
  streams: [
    {
      url: `${MEDIA_HOST}/test.mp4${suffix}`,
      type: "mp4",
      server,
      audio: "sub",
      priority: 1,
      isActive: true,
      subtitles: [{ url: `${MEDIA_HOST}/subs.vtt`, lang: "en", label: "English" }],
    },
  ],
});

function media() {
  return {
    id: 21,
    idMal: 21,
    type: "ANIME",
    format: "TV",
    status: "RELEASING",
    description: "<p>A stand-in anime used by the clips end-to-end test.</p>",
    season: "WINTER",
    seasonYear: 2024,
    episodes: 12,
    duration: 24,
    genres: ["Action"],
    averageScore: 80,
    popularity: 1000,
    isAdult: false,
    title: { romaji: "Clip Test Anime", english: "Clip Test Anime", native: "クリップ" },
    coverImage: { extraLarge: `${ORIGIN}/cover.jpg`, large: `${ORIGIN}/cover.jpg`, color: "#101018" },
    bannerImage: `${ORIGIN}/banner.jpg`,
    trailer: null,
    nextAiringEpisode: null,
    startDate: { year: 2024, month: 1, day: 1 },
    endDate: null,
    studios: { nodes: [] },
    staff: { nodes: [] },
    characters: { nodes: [] },
    relations: { nodes: [] },
    recommendations: { nodes: [] },
    externalLinks: [],
    streamingEpisodes: [],
    tags: [],
    rankings: [],
    synonyms: [],
    isFavourite: false,
    mediaListEntry: null,
    reviews: { nodes: [] },
    airingSchedule: { nodes: [] },
    countryOfOrigin: "JP",
    source: "ORIGINAL",
  };
}

const json = (res, body, status = 200, extra = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "content-length": Buffer.byteLength(payload),
    ...extra,
  });
  res.end(payload);
};

const wantsObject = (req) =>
  String(req.headers.accept || "").includes("application/vnd.pgrst.object+json");

/** PostgREST-ish filter reader: eq./is./in. on the query string. */
function filters(url) {
  const out = {};
  for (const [key, value] of url.searchParams) {
    if (key === "select" || key === "order" || key === "limit" || key === "offset") continue;
    out[key] = value;
  }
  return out;
}

function match(row, query) {
  for (const [key, value] of Object.entries(query)) {
    const rowValue = row[key];
    if (value.startsWith("eq.")) {
      const wanted = value.slice(3);
      if (String(rowValue) !== wanted) return false;
    } else if (value === "is.null") {
      if (rowValue !== null && rowValue !== undefined) return false;
    } else if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",").map((item) => item.replace(/^"|"$/g, ""));
      if (!list.includes(String(rowValue))) return false;
    }
  }
  return true;
}

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch {
        resolve(null);
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", ORIGIN);
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    });
    return res.end();
  }

  // ---- video, subtitles, images, embed page ------------------------------
  if (pathname === "/test.mp4") {
    const range = req.headers.range;
    if (range) {
      const matchRange = /bytes=(\d*)-(\d*)/.exec(range);
      const start = matchRange && matchRange[1] ? Number(matchRange[1]) : 0;
      const end = matchRange && matchRange[2] ? Number(matchRange[2]) : VIDEO.length - 1;
      const chunk = VIDEO.subarray(start, Math.min(end, VIDEO.length - 1) + 1);
      res.writeHead(206, {
        "content-type": VIDEO_TYPE,
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${start + chunk.length - 1}/${VIDEO.length}`,
        "content-length": chunk.length,
        "access-control-allow-origin": "*",
      });
      return res.end(chunk);
    }
    res.writeHead(200, {
      "content-type": VIDEO_TYPE,
      "accept-ranges": "bytes",
      "content-length": VIDEO.length,
      "access-control-allow-origin": "*",
    });
    return res.end(VIDEO);
  }

  if (pathname === "/subs.vtt") {
    res.writeHead(200, { "content-type": "text/vtt", "access-control-allow-origin": "*" });
    return res.end(VTT);
  }

  if (pathname === "/embed") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html><title>Stand-in embed</title><p>Embed player</p>");
  }

  if (pathname === "/cover.jpg" || pathname === "/banner.jpg") {
    // A real placeholder JPEG: the clip page renders the poster through
    // next/image, and a 404 would show a broken box in screenshots.
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": COVER.length,
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    });
    return res.end(COVER);
  }

  // ---- Supabase Auth ------------------------------------------------------
  if (pathname.startsWith("/auth/v1/")) {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (pathname === "/auth/v1/user") {
      if (bearer !== USER_TOKEN) {
        return json(res, { code: 401, msg: "invalid claim: missing sub claim" }, 401);
      }
      return json(res, {
        id: USER_ID,
        aud: "authenticated",
        email: "standin@example.com",
        role: "authenticated",
        app_metadata: { provider: "email" },
        user_metadata: { full_name: "Stand-in Viewer", avatar_url: null },
      });
    }
    return json(res, { code: 400, error_code: "invalid_grant" }, 400);
  }

  // ---- AniList GraphQL ---------------------------------------------------
  if (method === "POST" && (pathname === "/" || pathname === "/graphql")) {
    await readBody(req);
    return json(res, {
      data: {
        Media: media(),
        Page: { pageInfo: { total: 1, currentPage: 1, lastPage: 1 }, media: [media()], airingSchedules: [], mediaTrends: [] },
      },
    });
  }

  // ---- AniVexa provider streams -----------------------------------------
  if (pathname.startsWith("/ep/")) {
    if (pathname === "/ep/embed") {
      return json(res, { embeds: [`${ORIGIN}/embed`] });
    }
    if (pathname === "/ep/hd2") {
      // Offered by the provider but not playable: keeps the embed active while
      // "switch server" still has somewhere to switch to.
      return json(res, { ...substream("", "HD-2"), streams: substream("", "HD-2").streams.map((one) => ({ ...one, url: `${MEDIA_HOST}/missing.mp4` })) });
    }
    const suffix = pathname === "/ep/other" ? "?s=3" : "";
    return json(res, substream(suffix, pathname === "/ep/hd2" ? "HD-2" : "HD-1"));
  }

  // ---- PostgREST ---------------------------------------------------------
  if (pathname.startsWith("/rest/v1/")) {
    const table = pathname.slice("/rest/v1/".length);
    const query = filters(url);
    const body = method === "POST" || method === "PATCH" ? await readBody(req) : null;

    if (table === "rpc/increment_clip_views") {
      const row = clips.find((clip) => clip.code === body?.p_code && !clip.deleted_at);
      if (row) row.views += 1;
      return json(res, row ? row.views : 0);
    }

    if (table === "clips") {
      if (method === "GET") {
        const found = clips.filter((clip) => match(clip, query));
        if (wantsObject(req)) return found[0] ? json(res, found[0]) : json(res, {}, 406);
        return json(res, found);
      }
      if (method === "POST") {
        const row = {
          id: `clip-${++clipId}`,
          views: 0,
          created_at: new Date().toISOString(),
          deleted_at: null,
          ...body,
        };
        clips.push(row);
        if (wantsObject(req)) return json(res, row, 201);
        return json(res, [row], 201);
      }
      if (method === "PATCH") {
        const found = clips.filter((clip) => match(clip, query));
        for (const row of found) Object.assign(row, body);
        if (wantsObject(req)) return found[0] ? json(res, found[0]) : json(res, {}, 406);
        return json(res, found);
      }
      if (method === "DELETE") {
        const found = clips.filter((clip) => match(clip, query));
        for (const row of found) row.deleted_at = new Date().toISOString();
        return json(res, found);
      }
    }

    if (table === "clip_reports" && method === "POST") {
      reports.push({ id: `report-${reports.length + 1}`, ...body });
      return json(res, [body], 201);
    }

    if (table === "anime" && method === "GET") {
      const found = [ANIME].filter((row) => match(row, query));
      if (wantsObject(req)) return found[0] ? json(res, found[0]) : json(res, {}, 406);
      return json(res, found);
    }

    if (table === "episodes" && method === "GET") {
      const found = episodes.filter((row) => match(row, query));
      if (wantsObject(req)) return found[0] ? json(res, found[0]) : json(res, {}, 406);
      return json(res, found);
    }

    // Anything else (provider_health, episode_check_state, comments, ...) is
    // empty: the pages under test tolerate it.
    if (method === "GET") {
      if (wantsObject(req)) return json(res, {}, 406);
      return json(res, []);
    }
    return json(res, [], 201);
  }

  json(res, { error: "not_found", path: pathname }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[clips-e2e] stand-in on ${ORIGIN}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
