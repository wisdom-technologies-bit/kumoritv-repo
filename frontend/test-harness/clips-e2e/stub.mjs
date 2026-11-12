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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.STUB_PORT || 54321);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const USER_TOKEN = "standin-user-token";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const here = path.dirname(fileURLToPath(import.meta.url));

const VIDEO = readFileSync(path.join(here, "test.mp4"));
const VTT = "WEBVTT\n\n00:00.000 --> 00:40.000\nClip test subtitles\n";

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
    // Episode 2 starts on an embed server, so the toolbar can be checked.
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
];

const clips = [];
const reports = [];
let clipId = 0;

const substream = (suffix, server) => ({
  streams: [
    {
      url: `${ORIGIN}/test.mp4${suffix}`,
      type: "mp4",
      server,
      audio: "sub",
      priority: 1,
      isActive: true,
      subtitles: [{ url: `${ORIGIN}/subs.vtt`, lang: "en", label: "English" }],
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
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${start + chunk.length - 1}/${VIDEO.length}`,
        "content-length": chunk.length,
        "access-control-allow-origin": "*",
      });
      return res.end(chunk);
    }
    res.writeHead(200, {
      "content-type": "video/mp4",
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
    res.writeHead(404, { "access-control-allow-origin": "*" });
    return res.end();
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
    const suffix = pathname === "/ep/hd2" ? "?s=2" : pathname === "/ep/other" ? "?s=3" : "";
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
