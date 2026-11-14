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
// Prompt 38F: three clip posts, one per state the SQL arm can return. The
// rows are shaped exactly like community_feed_page: a masked adult row carries
// no code, no range and no anime, which is what the card must be able to draw.
const CLIP_POSTS = [
  {
    id: `${uid(31)}`,
    author_id: `${uid(101)}`,
    body: "This fight is the whole reason the arc works.",
    created_at: iso(6),
    title: "The best fight",
    code: "abc2345",
    start: 62,
    end: 77,
    animeId: 21,
    animeTitle: "Frieren: Beyond Journey's End",
    episode: 12,
  },
  {
    id: `${uid(32)}`,
    author_id: `${uid(102)}`,
    body: "",
    created_at: iso(18),
    title: "Adult Title",
    code: "adult77",
    start: 5,
    end: 20,
    animeId: 23,
    animeTitle: "Adult Title",
    episode: 3,
  },
  {
    id: `${uid(33)}`,
    author_id: `${uid(103)}`,
    body: "The clip I posted last week is gone, sorry.",
    created_at: iso(30),
    title: null,
    // The post still points at a clip that has since been deleted: that is what
    // makes the post page say "This clip was removed" rather than draw nothing.
    code: "gone123",
    start: null,
    end: null,
    animeId: null,
    animeTitle: null,
    episode: null,
  },
];

function feedRows(kind = "all") {
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

  const clipRows = CLIP_POSTS.map((post) => {
    // The state is per fixture, not inferred from the code: the removed post
    // keeps a code (its post page needs one to look up) but the feed row must
    // arrive masked, the way community_feed_page masks it.
    const state =
      post.id === `${uid(32)}` ? "hidden_adult" : post.id === `${uid(33)}` ? "removed" : "live";
    const masked = state !== "live";
    return {
      feed_key: `post:${post.id}`,
      kind: "post",
      created_at: post.created_at,
      author_id: post.author_id,
      author_username: "adaeze",
      author_display_name: post.id === `${uid(32)}` ? "Chidi" : "Adaeze",
      author_avatar: null,
      body: post.body,
      is_spoiler: false,
      title: masked ? null : post.title,
      image_url: null,
      link_url: null,
      clip_code: masked ? null : post.code,
      clip_start: masked ? null : post.start,
      clip_end: masked ? null : post.end,
      anime_id: masked ? null : post.animeId,
      anime_title: masked ? null : post.animeTitle,
      anime_cover: null,
      episode_number: masked ? null : post.episode,
      target_url: `/community/post/${post.id}`,
      reply_count: 0,
      likes: post.id === `${uid(31)}` ? 5 : 1,
      dislikes: 0,
      is_adult: post.id === `${uid(32)}`,
      clip_state: state,
    };
  });

  // Prompt 38F fix: one episode comment, so the Comments tab has something to
  // draw. The bug this guards was in the client loader, not the database: the
  // RPC returned comments and the feed threw them away, so the tab looked empty
  // while the query was answering.
  const commentRows = [
    {
      feed_key: `comment:${uid(41)}`,
      kind: "comment",
      created_at: iso(15),
      author_id: `${uid(102)}`,
      author_username: "chidi",
      author_display_name: "Chidi",
      author_avatar: null,
      body: "This episode comment belongs in the community feed.",
      is_spoiler: false,
      title: "Frieren: Beyond Journey's End",
      image_url: null,
      link_url: null,
      clip_code: null,
      clip_start: null,
      clip_end: null,
      anime_id: 21,
      anime_title: "Frieren: Beyond Journey's End",
      anime_cover: null,
      episode_number: 12,
      target_url: `/anime/21?comment=${uid(41)}`,
      reply_count: 2,
      likes: 3,
      dislikes: 0,
      is_adult: false,
      clip_state: "none",
    },
  ];

  const rows =
    kind === "post"
      ? [...postRows, ...clipRows]
      : kind === "comment"
        ? commentRows
        : kind === "announcement"
          ? announcementRows
          : kind === "clips"
            ? clipRows
            : [...announcementRows, ...commentRows, ...clipRows, ...postRows];

  return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "announcement" ? -1 : 1));
}

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
];

const EPISODES = [
  { anilist_id: 21, episode_number: 12, air_date: new Date(now + 86400000).toISOString().slice(0, 10) },
  { anilist_id: 22, episode_number: 5, air_date: new Date(now + 2 * 86400000).toISOString().slice(0, 10) },
];

const ANIME = [
  { anilist_id: 21, title: "Sousou no Frieren", title_english: "Frieren: Beyond Journey's End", is_adult: false },
  { anilist_id: 22, title: "Dandadan", title_english: "Dandadan", is_adult: false },
  // Prompt 38F: the adult rule needs a title that is actually flagged.
  { anilist_id: 23, title: "Adult Title", title_english: "Adult Title", is_adult: true },
];

// Prompt 38F fixtures: three clips - two ordinary, one on an adult title.
const CLIPS = [
  {
    id: "20000000-0000-4000-8000-000000000009",
    code: "adult77",
    user_id: `${uid(102)}`,
    owner_token_hash: null,
    anilist_id: 23,
    episode_number: 3,
    start_seconds: 5,
    end_seconds: 20,
    title: "Adult Title",
    source_audio: "sub",
    views: 4,
    created_at: iso(70),
    deleted_at: null,
  },
  {
    id: "20000000-0000-4000-8000-000000000001",
    code: "abc2345",
    user_id: `${uid(101)}`,
    owner_token_hash: null,
    anilist_id: 21,
    episode_number: 12,
    start_seconds: 62,
    end_seconds: 77,
    title: "The best fight",
    source_audio: "sub",
    views: 12,
    created_at: iso(40),
    deleted_at: null,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    code: "bcd3456",
    user_id: `${uid(101)}`,
    owner_token_hash: null,
    anilist_id: 22,
    episode_number: 5,
    start_seconds: 130,
    end_seconds: 148,
    title: null,
    source_audio: "sub",
    views: 3,
    created_at: iso(30),
    deleted_at: null,
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    code: "cde4567",
    user_id: `${uid(101)}`,
    owner_token_hash: null,
    anilist_id: 23,
    episode_number: 1,
    start_seconds: 10,
    end_seconds: 25,
    title: "Adult scene",
    source_audio: "sub",
    views: 0,
    created_at: iso(20),
    deleted_at: null,
  },
];

// Prompt 38F: the browser talks to this stand-in directly once a page is
// signed in (supabase-js fetches /auth/v1/user from the client), and the page
// origin is a different port, so every response is CORS-open. Without this the
// browser blocks the call and the app quietly stays in its guest state.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "600",
};

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
  // STUB_LOG=1 prints one line per request: the record of what the app actually
  // asked for, which is how a 404 on a post page is told apart from a bad row.
  if (process.env.STUB_LOG === "1") console.log(`${method} ${url.pathname}${url.search}`);

  if (method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (pathname === "/health") return json(res, 200, { ok: true });

  // Someone is signed in only when the spec says so.
  if (pathname === "/auth/v1/user") {
    // Signed in when the browser carries the stand-in cookie OR when the
    // request arrives with a bearer token, which is how a SERVER-side
    // supabase client (an API route, an RSC) presents the session: those calls
    // never forward the browser's cookies.
    const bearer = String(req.headers.authorization ?? "");
    if (
      req.headers["x-standin-user"] === "1" ||
      (req.headers.cookie ?? "").includes("standin-user=1") ||
      bearer.startsWith("Bearer ")
    ) {
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
      : feedRows(kind).filter((row) => fixtureAnnouncements || !isAnnouncement(row));
    return json(res, 200, rows);
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

    // PostgREST filters. `id` was the only one Phase 1/2 needed; the clip
    // queries also filter on code, user_id and owner_token_hash, and ask for
    // deleted_at=is.null, so equality on any column is honoured here.
    for (const [column, raw] of url.searchParams.entries()) {
      if (!raw) continue;
      if (raw.startsWith("eq.")) {
        const wanted = raw.slice(3);
        rows = rows.filter((row) => String(row[column] ?? "") === wanted);
      } else if (raw === "is.null") {
        rows = rows.filter((row) => row[column] === null || row[column] === undefined);
      }
    }

    // .maybeSingle()/.single() ask for a bare object, not an array.
    const wantsObject = (req.headers.accept ?? "").includes("pgrst.object");
    if (wantsObject) {
      if (rows.length !== 1) return json(res, 406, { message: "not a single row" });
      return json(res, 200, rows[0]);
    }
    return json(res, 200, rows);
  }

  return json(res, 404, { message: "not found" });
});

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
  if (table === "community_posts") {
    // Prompt 38F: the post page reads community_posts directly and resolves
    // the clip itself, so the three clip posts live here as well.
    return [
      ...POSTS,
      ...CLIP_POSTS.map((post) => ({
        id: post.id,
        author_id: post.author_id,
        body: post.body,
        is_spoiler: false,
        created_at: post.created_at,
        // The post page filters on status/deleted_at, so these rows need the
        // same published shape as the text posts or the page 404s.
        status: "published",
        deleted_at: null,
        pinned: false,
        // The real table stores the clip's row id, not its code: a post page
        // selects clip_id and takes the code from the clip. The removed post
        // points at an id no clip answers to.
        clip_id:
          post.id === `${uid(32)}`
            ? "20000000-0000-4000-8000-000000000009"
            : post.id === `${uid(33)}`
              ? "20000000-0000-4000-8000-0000000000ff"
              : "20000000-0000-4000-8000-000000000001",
      })),
    ];
  }
  if (table === "comment_feed") return COMMENTS;
  if (table === "public_profiles") return Object.values(PROFILES);
  if (table === "episodes") return EPISODES;
  if (table === "anime") return ANIME;
  if (table === "community_reactions") return [];
  if (table === "clips") return CLIPS;
  if (table === "notifications" || table === "user_notifications") return [];
  if (table === "profiles") return [{ id: `${uid(101)}`, display_name: "Adaeze", username: "adaeze", avatar_url: null }];
  return [];
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`community stub on ${ORIGIN}`);
});
