// Prompt 38B Playwright stand-in.
//
// ONE local server standing in for Supabase Auth + PostgREST so the real
// production build can be screenshotted without any real project. Nothing
// leaves the machine: every row below is invented here.
//
// It answers exactly what the community pages ask for:
//   POST /rest/v1/rpc/community_feed_page   the merged feed (posts + announcements)
//   POST /rest/v1/rpc/community_react        like/dislike counts
//   GET  /rest/v1/announcements              right rail + announcement page
//   GET  /rest/v1/episodes, /rest/v1/anime    "Airing this week"
//   GET  /rest/v1/community_posts            post page
//   GET  /rest/v1/public_profiles            author of a post
//   GET  /rest/v1/comment_feed               a thread
//   GET  /auth/v1/user                       401 - the visitor is a guest
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT || 54329);
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** Deterministic, real-shaped UUIDs (8-4-4-4-12) so the page's UUID guard passes. */
const uid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

const POSTS = [
  {
    id: `${uid(1)}`,
    author_id: `${uid(101)}`,
    body:
      "Started Frieren again with my sister and she cried at episode 12. Reliable, honestly. The way the show lets a scene breathe for six whole seconds before anyone speaks is still the best thing airing.",
    is_spoiler: false,
    created_at: iso(24),
    status: "published",
    deleted_at: null,
    pinned: false,
    author_display_name: "Adaeze",
    author_username: "adaeze",
    author_avatar: null,
  },
  {
    id: `${uid(2)}`,
    author_id: `${uid(102)}`,
    body:
      "That final fight. I was not ready. Watched it twice and the second time I noticed the background art in the ruins is a callback to the first episode.",
    is_spoiler: true,
    created_at: iso(95),
    status: "published",
    deleted_at: null,
    pinned: false,
    author_display_name: "Tunde",
    author_username: "tunde",
    author_avatar: null,
  },
  {
    id: `${uid(3)}`,
    author_id: `${uid(103)}`,
    body:
      "Quick question for the dub watchers: is the new Dandadan dub keeping the same energy as the sub? Thinking of rewatching with my cousins who only do dubs.",
    is_spoiler: false,
    created_at: iso(190),
    status: "published",
    deleted_at: null,
    pinned: false,
    author_display_name: "Chidi",
    author_username: "chidi",
    author_avatar: null,
  },
];

const ANNOUNCEMENTS = [
  {
    id: `${uid(11)}`,
    title: "Season 2 of the weekly digest starts Sunday",
    body:
      "Every Sunday at 09:00 the bell will carry one digest instead of a dozen episode pings. You can turn it off in settings and still get replies and likes.",
    image: null,
    url: "https://example.com/digest",
    created_at: iso(12),
    expires_at: null,
  },
  {
    id: `${uid(12)}`,
    title: "The clip editor is out of beta",
    body: "Trim, caption and share a forty-second moment without leaving KumoriTV.",
    image: null,
    url: null,
    created_at: iso(600),
    expires_at: null,
  },
];

const PROFILES = {
  [`${uid(101)}`]: { id: `${uid(101)}`, display_name: "Adaeze", username: "adaeze", avatar_url: null },
  [`${uid(102)}`]: { id: `${uid(102)}`, display_name: "Tunde", username: "tunde", avatar_url: null },
  [`${uid(103)}`]: { id: `${uid(103)}`, display_name: "Chidi", username: "chidi", avatar_url: null },
};

/** The feed the SQL function would return: announcements pinned first, then newest. */
/** The comment arm of community_feed_page: top-level anime comments only,
 *  with the anime they belong to and the same link public.comment_link() makes.
 *  Adult rows are only returned when the caller asked for them, exactly like
 *  the real RPC (a display preference, not a gate). */
function commentFeedRows(showAdult) {
  const ANIME_OF = {
    21: { title: "Frieren: Beyond Journey's End", cover: "https://cdn.test/frieren.jpg", adult: false },
    22: { title: "Dandadan", cover: "https://cdn.test/dandadan.jpg", adult: false },
    999: { title: "Adult stand-in", cover: "https://cdn.test/adult.jpg", adult: true },
  };
  const rows = [
    { id: uid(41), anilist_id: 21, episode_number: 12, body: COMMENT_BY_ID[`${uid(41)}`].body, spoiler: false, likes: 14, dislikes: 0, replies: 1, minutes: 55 },
    { id: uid(31), anilist_id: 21, episode_number: null, body: COMMENT_BY_ID[`${uid(31)}`].body, spoiler: false, likes: 9, dislikes: 1, replies: 0, minutes: 30 },
    { id: uid(51), anilist_id: 999, episode_number: 3, body: "Adult stand-in comment body.", spoiler: false, likes: 4, dislikes: 0, replies: 0, minutes: 70 },
    { id: uid(52), anilist_id: 22, episode_number: 5, body: "The curry scene is doing more character work than it looks.", spoiler: true, likes: 6, dislikes: 2, replies: 3, minutes: 90 },
    { id: uid(53), anilist_id: null, episode_number: null, body: "", spoiler: false, likes: 0, dislikes: 0, replies: 0, minutes: 120, missingAnime: true },
  ];

  return rows
    .filter((row) => !row.missingAnime)
    .filter((row) => showAdult || !ANIME_OF[row.anilist_id]?.adult)
    .map((row) => {
      const anime = ANIME_OF[row.anilist_id];
      return {
        feed_key: `comment:${row.id}`,
        kind: "comment",
        created_at: iso(row.minutes),
        author_id: `${uid(101)}`,
        author_username: "adaeze",
        author_display_name: "Adaeze",
        author_avatar: null,
        body: row.spoiler ? null : row.body,
        is_spoiler: row.spoiler,
        title: null,
        image_url: null,
        link_url: null,
        clip_code: null,
        clip_start: null,
        clip_end: null,
        anime_id: row.anilist_id,
        anime_title: anime.title,
        anime_cover: anime.cover,
        episode_number: row.episode_number,
        target_url:
          row.episode_number === null || row.episode_number === undefined
            ? `/media/${row.anilist_id}#comment-${row.id}`
            : `/watch/${row.anilist_id}?ep=${row.episode_number}#comment-${row.id}`,
        reply_count: row.replies,
        likes: row.likes,
        dislikes: row.dislikes,
        is_adult: anime.adult,
      };
    });
}

function feedRows(kind = "all", showAdult = false) {
  const postRows = POSTS.map((post) => ({
    feed_key: `post:${post.id}`,
    kind: "post",
    created_at: post.created_at,
    author_id: post.author_id,
    author_username: post.author_username,
    author_display_name: post.author_display_name,
    author_avatar: null,
    body: post.body,
    is_spoiler: post.is_spoiler,
    title: null,
    image_url: null,
    link_url: null,
    clip_code: null,
    clip_start: null,
    clip_end: null,
    anime_id: null,
    anime_title: null,
    anime_cover: null,
    episode_number: null,
    target_url: `/community/post/${post.id}`,
    reply_count: post.id === `${uid(1)}` ? 4 : post.id === `${uid(2)}` ? 2 : 0,
    likes: post.id === `${uid(1)}` ? 12 : post.id === `${uid(2)}` ? 7 : 1,
    dislikes: post.id === `${uid(2)}` ? 2 : 0,
  }));

  const announcementRows = ANNOUNCEMENTS.map((row) => ({
    feed_key: `announcement:${row.id}`,
    kind: "announcement",
    created_at: row.created_at,
    author_id: null,
    author_username: null,
    author_display_name: "KumoriTV",
    author_avatar: null,
    body: row.body,
    is_spoiler: false,
    title: row.title,
    image_url: row.image,
    link_url: row.url,
    clip_code: null,
    clip_start: null,
    clip_end: null,
    anime_id: null,
    anime_title: null,
    anime_cover: null,
    episode_number: null,
    target_url: `/community/announcements/${row.id}`,
    reply_count: 0,
    likes: 0,
    dislikes: 0,
  }));

  const commentRows = kind === "all" || kind === "comment" ? commentFeedRows(showAdult) : [];

  const rows =
    kind === "post"
      ? postRows
      : kind === "announcement"
        ? announcementRows
        : kind === "comment"
          ? commentRows
          : [...announcementRows, ...postRows, ...commentRows];

  return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "announcement" ? -1 : 1));
}

const COMMENT_BY_ID = {};

const COMMENTS = [
  {
    id: `${uid(21)}`,
    anilist_id: null,
    episode_number: null,
    parent_id: null,
    user_id: `${uid(101)}`,
    body: "The pacing in the second half is what sold me.",
    is_spoiler: false,
    created_at: iso(20),
    target_type: "post",
    post_id: `${uid(1)}`,
    announcement_id: null,
    username: "adaeze",
    display_name: "Adaeze",
    avatar_url: null,
    likes: 3,
    dislikes: 0,
  },
  {
    id: `${uid(22)}`,
    anilist_id: null,
    episode_number: null,
    parent_id: null,
    user_id: `${uid(102)}`,
    body: "Same, and the soundtrack does most of the work.",
    is_spoiler: false,
    created_at: iso(15),
    target_type: "post",
    post_id: `${uid(1)}`,
    announcement_id: null,
    username: "tunde",
    display_name: "Tunde",
    avatar_url: null,
    likes: 1,
    dislikes: 0,
  },
  // A reply, so a deep link to a reply has to expand its parent thread.
  {
    id: `${uid(23)}`,
    anilist_id: null,
    episode_number: null,
    parent_id: `${uid(21)}`,
    user_id: `${uid(103)}`,
    body: "The dinner scene in episode 4 is the one I keep coming back to.",
    is_spoiler: false,
    created_at: iso(10),
    target_type: "post",
    post_id: `${uid(1)}`,
    announcement_id: null,
    username: "chidi",
    display_name: "Chidi",
    avatar_url: null,
    likes: 0,
    dislikes: 0,
  },
  // The anime page thread: /media/21#comment-<id>
  {
    id: `${uid(31)}`,
    anilist_id: 21,
    episode_number: null,
    parent_id: null,
    user_id: `${uid(101)}`,
    body: "Frieren is the rare show where the quiet episodes are the ones I rewatch.",
    is_spoiler: false,
    created_at: iso(30),
    target_type: "anime",
    post_id: null,
    announcement_id: null,
    username: "adaeze",
    display_name: "Adaeze",
    avatar_url: null,
    likes: 9,
    dislikes: 1,
  },
  // The episode thread: /watch/21?ep=12#comment-<id>
  {
    id: `${uid(41)}`,
    anilist_id: 21,
    episode_number: 12,
    parent_id: null,
    user_id: `${uid(102)}`,
    body: "That last shot in episode 12 held for six seconds and it earned every one of them.",
    is_spoiler: false,
    created_at: iso(55),
    target_type: "anime",
    post_id: null,
    announcement_id: null,
    username: "tunde",
    display_name: "Tunde",
    avatar_url: null,
    likes: 14,
    dislikes: 0,
  },
  {
    id: `${uid(42)}`,
    anilist_id: 21,
    episode_number: 12,
    parent_id: `${uid(41)}`,
    user_id: `${uid(103)}`,
    body: "The animation in that shot is why I stopped watching it on my phone.",
    is_spoiler: false,
    created_at: iso(50),
    target_type: "anime",
    post_id: null,
    announcement_id: null,
    username: "chidi",
    display_name: "Chidi",
    avatar_url: null,
    likes: 2,
    dislikes: 0,
  },
];

const EPISODES = [
  { anilist_id: 21, episode_number: 12, air_date: new Date(now + 86400000).toISOString().slice(0, 10) },
  { anilist_id: 22, episode_number: 5, air_date: new Date(now + 2 * 86400000).toISOString().slice(0, 10) },
];

const ANIME = [
  { anilist_id: 21, title: "Sousou no Frieren", title_english: "Frieren: Beyond Journey's End" },
  { anilist_id: 22, title: "Dandadan", title_english: "Dandadan" },
];


/** ---------------------------------------------------------------- AniList
 * The media and watch pages are server components that ask AniList for one
 * title. Without an answer they 404, and a 404 cannot prove that a deep link
 * lands on a comment. This is the smallest Media the pages actually read. */
function mediaFixture(id) {
  const titles = {
    21: {
      romaji: "Sousou no Frieren",
      english: "Frieren: Beyond Journey's End",
      native: "\u846c\u9001\u306e\u30d5\u30ea\u30fc\u30ec\u30f3",
      description: "<p>An elf, a hero, and the years after the journey.</p>",
      episodes: 28,
      year: 2023,
      score: 87,
      popularity: 300000,
    },
    23: {
      romaji: "Vinland Saga",
      english: "Vinland Saga",
      native: "\u30f4\u30a3\u30f3\u30e9\u30f3\u30c9\u30fb\u30b5\u30ac",
      description: "<p>A boy, a revenge, and a very long ship.</p>",
      episodes: 24,
      year: 2023,
      score: 86,
      popularity: 210000,
    },
    24: {
      romaji: "Mob Psycho 100",
      english: "Mob Psycho 100",
      native: "\u30e2\u30d6\u30b5\u30a4\u30b3100",
      description: "<p>One boy, one hundred percent.</p>",
      episodes: 12,
      year: 2022,
      score: 85,
      popularity: 190000,
    },
    22: {
      romaji: "Dandadan",
      english: "Dandadan",
      native: "\u30c0\u30f3\u30c0\u30c0\u30f3",
      description: "<p>Ghosts, aliens, and one very awkward friendship.</p>",
      episodes: 12,
      year: 2024,
      score: 82,
      popularity: 240000,
    },
  };
  const base = titles[id] ?? titles[21];
  return {
    id,
    idMal: 5000 + id,
    title: { romaji: base.romaji, english: base.english, native: base.native },
    description: base.description,
    isAdult: false,
    status: "FINISHED",
    isFavourite: false,
    averageScore: base.score,
    popularity: base.popularity,
    trending: 12,
    favourites: 4200,
    season: "FALL",
    seasonYear: base.year,
    episodes: base.episodes,
    chapters: null,
    volumes: null,
    duration: 24,
    source: "MANGA",
    countryOfOrigin: "JP",
    synonyms: [],
    genres: ["Adventure", "Drama", "Fantasy"],
    format: "TV",
    type: "ANIME",
    hashtag: "#standin",
    updatedAt: 1700000000,
    coverImage: {
      extraLarge: `https://cdn.test/cover-${id}.jpg`,
      large: `https://cdn.test/cover-${id}.jpg`,
      medium: `https://cdn.test/cover-${id}.jpg`,
      color: "#5b6f8f",
    },
    bannerImage: `https://cdn.test/banner-${id}.jpg`,
    startDate: { year: base.year, month: 9, day: 29 },
    endDate: { year: base.year + 1, month: 3, day: 22 },
    nextAiringEpisode: null,
    trailer: null,
    streamingEpisodes: [],
    studios: { edges: [{ node: { id: 1, name: "Madhouse", isAnimationStudio: true, siteUrl: null } }] },
    relations: { nodes: [] },
    characters: { edges: [] },
    recommendations: { edges: [] },
    reviews: { nodes: [] },
    tags: [],
    externalLinks: [],
  };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,HEAD,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-range, content-profile",
};

for (const row of COMMENTS) COMMENT_BY_ID[row.id] = row;

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-range": `0-${Math.max((Array.isArray(body) ? body.length : 1) - 1, 0)}/*`,
    ...CORS,
    ...extraHeaders,
  });
  res.end(payload);
}

/** Fixture state: the feed can be told there are no announcements at all. */
let fixtureAnnouncements = true;
let fixtureEmpty = false;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  const pathname = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (pathname === "/health") return json(res, 200, { ok: true });

  // Someone is signed in only when the spec says so.
  if (pathname === "/auth/v1/user") {
    if (req.headers["x-standin-user"] === "1" || (req.headers.cookie ?? "").includes("standin-user=1")) {
      return json(res, 200, {
        id: `${uid(101)}`,
        is_anonymous: false,
        email: "adaeze@example.test",
        user_metadata: { display_name: "Adaeze", username: "adaeze" },
      });
    }
    return json(res, 401, { message: "no session" });
  }
  if (pathname.startsWith("/auth/v1/")) return json(res, 200, {});

  // AniList GraphQL: every query the pages send is a single Media lookup.
  if (method === "POST" && (pathname === "/" || pathname === "/graphql")) {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      payload = {};
    }
    // The right rail asks for this week's airing schedule, not one media.
    if (String(payload?.query ?? "").includes("airingSchedules")) {
      const now = Math.floor(Date.now() / 1000);
      const schedules = [21, 22, 23, 24].map((mediaId, index) => ({
        id: 9000 + index,
        airingAt: now + (index + 1) * 3600,
        timeUntilAiring: (index + 1) * 3600,
        episode: 12 + index,
        media: mediaFixture(mediaId),
      }));
      return json(res, 200, {
        data: { Page: { pageInfo: { hasNextPage: false, currentPage: 1 }, airingSchedules: schedules } },
      });
    }

    const id = Number(payload?.variables?.id ?? 21);
    return json(res, 200, { data: { Media: mediaFixture(id) } });
  }

  if (pathname === "/rest/v1/rpc/community_feed_page" && method === "POST") {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      payload = {};
    }
    const kind = payload.p_kind ?? "all";
    const isAnnouncement = (row) => String(row.feed_key ?? row.kind ?? "").startsWith("announcement");
    const rows = fixtureEmpty
      ? []
      : feedRows(kind, payload.p_show_adult === true).filter(
          (row) => fixtureAnnouncements || !isAnnouncement(row),
        );
    // The RPC sorts (created_at desc, feed_key desc); the stub does the same.
    const sorted = [...rows].sort((a, b) =>
      a.created_at === b.created_at ? b.feed_key.localeCompare(a.feed_key) : a.created_at < b.created_at ? 1 : -1,
    );
    return json(res, 200, sorted);
  }

  if (pathname === "/rest/v1/rpc/community_react") {
    return json(res, 200, [{ likes: 13, dislikes: 0, mine: 1 }]);
  }

  // GET, so the harness never has to parse a body here.
  if (pathname === "/__fixture") {
    const flag = url.searchParams.get("announcements");
    if (flag === "0" || flag === "1") fixtureAnnouncements = flag === "1";
    const empty = url.searchParams.get("empty");
    if (empty === "0" || empty === "1") fixtureEmpty = empty === "1";
    return json(res, 200, { announcements: fixtureAnnouncements, empty: fixtureEmpty });
  }

  if (pathname.startsWith("/rest/v1/")) {
    const table = pathname.slice("/rest/v1/".length);
    let rows = tableRows(table) ?? [];

    rows = applyPostgrest(rows, url.searchParams);

    // .maybeSingle()/.single() ask for a bare object, not an array.
    const wantsObject = (req.headers.accept ?? "").includes("pgrst.object");
    if (wantsObject) {
      if (rows.length !== 1) return json(res, 406, { message: "not a single row" });
      return json(res, 200, rows[0]);
    }

    // count=exact (HEAD or GET) reads the total out of Content-Range.
    const wantsCount = (req.headers.prefer ?? "").includes("count=exact");
    if (method === "HEAD" || (wantsCount && requestIsHeadOnly(req))) {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
        ...CORS,
      });
      return res.end();
    }
    if (wantsCount) {
      return json(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }
    return json(res, 200, rows);
  }

  return json(res, 404, { message: "not found" });
});


/** A HEAD-shaped count request: no body expected, only the total. */
function requestIsHeadOnly(req) {
  return (req.headers.prefer ?? "").includes("count=exact") && req.headers["x-standin-body"] !== "1";
}

const RESERVED = new Set(["select", "order", "limit", "offset", "apikey", "columns", "on_conflict"]);

/** The subset of PostgREST this harness uses: eq/neq/in/is/null/comparisons,
 *  order, limit and offset. Anything else is ignored rather than guessed. */
function applyPostgrest(rows, params) {
  let out = [...rows];
  for (const [key, value] of params.entries()) {
    if (RESERVED.has(key) || key.includes(".")) continue;
    if (value === "is.null") {
      out = out.filter((row) => row[key] === null || row[key] === undefined);
    } else if (value.startsWith("eq.")) {
      out = out.filter((row) => String(row[key] ?? "") === value.slice(3));
    } else if (value.startsWith("neq.")) {
      out = out.filter((row) => String(row[key] ?? "") !== value.slice(4));
    } else if (value.startsWith("in.")) {
      const wanted = value
        .slice(3)
        .replace(/^\(/, "")
        .replace(/\)$/, "")
        .split(",")
        .map((item) => item.trim().replace(/^"|"$/g, ""));
      out = out.filter((row) => wanted.includes(String(row[key] ?? "")));
    } else if (/^(gte|lte|gt|lt)\./.test(value)) {
      const [, op, raw] = value.match(/^(gte|lte|gt|lt)\.(.*)$/) ?? [];
      out = out.filter((row) => {
        const left = row[key];
        if (op === "gte") return left >= raw;
        if (op === "lte") return left <= raw;
        if (op === "gt") return left > raw;
        return left < raw;
      });
    }
  }

  const order = params.get("order");
  if (order) {
    const keys = order.split(",").map((part) => {
      const [field, ...rest] = part.split(".");
      return { field, desc: rest.includes("desc"), nullsFirst: rest.includes("nullsfirst") };
    });
    out.sort((a, b) => {
      for (const { field, desc, nullsFirst } of keys) {
        const left = a[field];
        const right = b[field];
        if (left === right) continue;
        if (left === null || left === undefined) return nullsFirst ? -1 : 1;
        if (right === null || right === undefined) return nullsFirst ? 1 : -1;
        const result = left < right ? -1 : 1;
        return desc ? -result : result;
      }
      return 0;
    });
  }

  const offset = Number(params.get("offset") ?? 0) || 0;
  const limit = params.get("limit");
  if (limit !== null) out = out.slice(offset, offset + (Number(limit) || 0));
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
  });
}

function tableRows(table) {
  if (table === "announcements") return ANNOUNCEMENTS;
  if (table === "community_posts") return POSTS;
  if (table === "comment_feed") return COMMENTS;
  if (table === "public_profiles") return Object.values(PROFILES);
  if (table === "episodes") return EPISODES;
  if (table === "anime") return ANIME;
  if (table === "community_reactions") return [];
  if (table === "notifications" || table === "user_notifications") return [];
  if (table === "profiles") return [{ id: `${uid(101)}`, display_name: "Adaeze", username: "adaeze", avatar_url: null }];
  return [];
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`community stub on ${ORIGIN}`);
});
