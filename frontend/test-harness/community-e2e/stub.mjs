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
// Phase 5 fixture codes must be codes the app accepts: 7 characters from the
// real alphabet, which has no 0/o/1/i/l (a code is read off a screen and typed
// by hand). Anything else 404s before the database is asked.
const PUBLIC_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

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

  const fixtureAnnouncement = announcementFixture
    ? [{ id: `${uid(90)}`, ...ANNOUNCEMENT_FIXTURES[announcementFixture], image: null, url: null, created_at: iso(0), expires_at: null }]
    : [];
  const announcementRows = [...fixtureAnnouncement, ...ANNOUNCEMENTS].map((row) => ({
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
  // Phase 5: the public list needs more than one page. These rows are guests
  // (`user_id` and `owner_token_hash` both null), so neither "My clips" query
  // can see them - the Phase 38F picker counts stay exactly as they were - but
  // /api/clips lists them, which is what a public page is.
  ...Array.from({ length: 30 }, (_, index) => {
    const anilistId = [21, 22, 23][index % 3];
    const code = publicCode(index);
    return {
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      code,
      user_id: null,
      owner_token_hash: null,
      anilist_id: anilistId,
      episode_number: (index % 9) + 1,
      start_seconds: 30 + index,
      end_seconds: 45 + index,
      title: null,
      source_audio: "sub",
      views: index * 137,
      // Older than every Phase 38F row, and strictly ordered so a keyset page
      // can be asserted without depending on the clock.
      created_at: iso(200 + index),
      deleted_at: null,
    };
  }),
  {
    id: "20000000-0000-4000-8000-000000000010",
    code: "gone123",
    user_id: null,
    owner_token_hash: null,
    anilist_id: 21,
    episode_number: 2,
    start_seconds: 1,
    end_seconds: 4,
    title: "Deleted clip",
    source_audio: "sub",
    views: 0,
    created_at: iso(5),
    // Soft deleted: the public list must never show it.
    deleted_at: iso(4),
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


/* ------------------------------------------------------------------------- */
/* Phase 4: the new-post bar and the admin composer                          */
/* ------------------------------------------------------------------------- */

/** The rows `public.community_latest(...)` would return, one per public item. */
const LATEST = [
  ...POSTS.map((post) => ({
    id: post.id,
    kind: "post",
    created_at: post.created_at,
    author_id: post.author_id,
    author_name: post.author_display_name ?? "Ada",
    author_avatar: null,
    text: post.body,
    has_clip: false,
    clip_thumb: null,
    adult: false,
    href: `/community/post/${post.id}`,
  })),
  ...CLIP_POSTS.map((post) => ({
    id: post.id,
    kind: "post",
    created_at: post.created_at,
    author_id: post.author_id,
    author_name: "Ada",
    author_avatar: null,
    text: post.body,
    has_clip: true,
    // The adult clip carries no thumbnail, exactly like the SQL function.
    clip_thumb: post.animeId === 23 ? null : "https://cdn.test/cover.jpg",
    adult: post.animeId === 23,
    href: `/community/post/${post.id}`,
  })),
  ...ANNOUNCEMENTS.map((row) => ({
    id: row.id,
    kind: "announcement",
    created_at: row.created_at,
    author_id: null,
    author_name: "KumoriTV",
    author_avatar: null,
    text: row.body,
    has_clip: false,
    clip_thumb: null,
    adult: false,
    href: `/community/announcements/${row.id}`,
  })),
];

/** Everything the stub has written during the run (announcements are mutable). */
const SENT_ANNOUNCEMENTS = new Set();

/** The composer needs a session; the cookie the specs set is enough. */
function isSignedIn(req) {
  return (
    req.headers["x-standin-user"] === "1" ||
    (req.headers.cookie ?? "").includes("standin-user=1") ||
    String(req.headers.authorization ?? "").startsWith("Bearer ")
  );
}

/** Fixture state: the feed can be told there are no announcements at all. */

/** Part B: one announcement per body shape the preview must survive. */
const ANNOUNCEMENT_FIXTURES = {
  sample: {
    title: "Service Update: KumoriTV Is Back Online!",
    body: [
      "# Service Update: KumoriTV Is Back Online!",
      "",
      "We are pleased to announce that **KumoriTV is fully accessible again!**",
      "",
      "The temporary service disruption has been resolved, and our website is back up and running.",
      "",
      "- Search works",
      "- The watch page plays",
      "- Clips upload",
      "",
      "> Thank you for staying with us.",
      "",
      "Read the details at [the status page](https://kumoritv.top/status) or just keep watching.",
      "",
      "**We're back. Happy watching!**",
      "",
      "*The KumoriTV Team*",
    ].join("\n"),
  },
  long: {
    title: "A very long announcement",
    body: Array.from({ length: 90 }, (_, i) => `Paragraph ${i + 1}: ${"the quick brown fox jumps over the lazy dog ".repeat(1)}`).join("\n\n"),
  },
  script: {
    title: "A body with payloads",
    body: '<script>alert("xss")</script> Plain words. [click me](javascript:alert(1)) and <img src=x onerror=alert(1)>',
  },
  unterminated: {
    title: "Unfinished emphasis",
    body: "**This opening marker is never closed, and the sentence keeps going past the cut point so the preview has to repair it instead of printing raw stars in the card.",
  },
  urlonly: {
    title: "Only a link",
    body: `https://kumoritv.top/${"x".repeat(600)}`,
  },
  empty: { title: "No body at all", body: "" },
};

let announcementFixture = null;

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
    const fixture = url.searchParams.get("announcementFixture");
    if (fixture !== null) {
      announcementFixture = ANNOUNCEMENT_FIXTURES[fixture] ? fixture : null;
    }
    const empty = url.searchParams.get("empty");
    if (empty === "0" || empty === "1") fixtureEmpty = empty === "1";
    // Phase 4: "someone just posted", for the bar. `clip=1` gives it a thumbnail,
    // `adult=1` makes it an adult clip.
    const newPost = url.searchParams.get("new_post");
    if (newPost) {
      const id = `30000000-0000-4000-8000-${String(900 + LATEST.length).padStart(12, "0")}`;
      LATEST.push({
        id,
        kind: "post",
        created_at: new Date().toISOString(),
        author_id: `${uid(101)}`,
        author_name: url.searchParams.get("author") || "Ada",
        author_avatar: null,
        text: newPost,
        has_clip: url.searchParams.get("clip") === "1",
        clip_thumb: url.searchParams.get("adult") === "1" ? null : url.searchParams.get("clip") === "1" ? "https://cdn.test/cover.jpg" : null,
        adult: url.searchParams.get("adult") === "1",
        href: `/community/post/${id}`,
      });
      return json(res, 200, { id });
    }
    return json(res, 200, { announcements: fixtureAnnouncements, empty: fixtureEmpty, announcementFixture });
  }


  /* ---- Phase 4: the latest feed ---------------------------------------- */
  if (pathname === "/rest/v1/rpc/community_latest" && method === "POST") {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req)) || {};
    } catch {
      payload = {};
    }
    const after = payload.p_after ? Date.parse(payload.p_after) : 0;
    const limit = Math.min(Math.max(Number(payload.p_limit) || 5, 1), 10);
    if (process.env.STUB_DEBUG) console.log("[stub] community_latest", JSON.stringify(payload), "after=", after);
    const rows = LATEST.filter((row) => Date.parse(row.created_at) > (after || 0))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, limit);
    return json(res, 200, rows);
  }

  if (pathname === "/rest/v1/rpc/is_admin" && method === "POST") {
    return json(res, 200, isSignedIn(req));
  }

  /* ---- Phase 4: the admin composer writes ------------------------------ */
  if (pathname === "/rest/v1/announcements" && (method === "POST" || method === "PATCH")) {
    const body = JSON.parse((await readBody(req)) || "{}");
    const row = Array.isArray(body) ? body[0] : body;
    const wantsObject = (req.headers.accept ?? "").includes("pgrst.object");

    if (method === "POST") {
      const id = `30000000-0000-4000-8000-${String(ANNOUNCEMENTS.length + 1).padStart(12, "0")}`;
      const created = {
        id,
        title: row.title,
        body: row.body,
        image: row.image ?? null,
        url: row.url ?? null,
        created_at: new Date().toISOString(),
        expires_at: row.expires_at ?? null,
        push_sent_at: row.push_sent_at ?? null,
      };
      ANNOUNCEMENTS.unshift(created);
      LATEST.push({
        id,
        kind: "announcement",
        created_at: created.created_at,
        author_id: null,
        author_name: "KumoriTV",
        author_avatar: null,
        text: created.body,
        has_clip: false,
        clip_thumb: null,
        adult: false,
        href: `/community/announcements/${id}`,
      });
      return json(res, 200, wantsObject ? { id } : [{ id }]);
    }

    const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
    const existing = ANNOUNCEMENTS.find((item) => item.id === id);
    if (!existing) return json(res, 200, wantsObject ? null : []);
    Object.assign(existing, row);
    return json(res, 200, wantsObject ? { id } : [{ id }]);
  }

  if (pathname === "/rest/v1/announcements" && method === "DELETE") {
    const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
    const index = ANNOUNCEMENTS.findIndex((item) => item.id === id);
    const found = index >= 0;
    if (found) ANNOUNCEMENTS.splice(index, 1);
    const wantsObject = (req.headers.accept ?? "").includes("pgrst.object");
    return json(res, 200, wantsObject ? (found ? { id } : null) : found ? [{ id }] : []);
  }

  if (pathname.startsWith("/rest/v1/")) {
    const table = pathname.slice("/rest/v1/".length);
    let rows = tableRows(table) ?? [];

    // PostgREST filters. `id` was the only one Phase 1/2 needed; the clip
    // queries also filter on code, user_id and owner_token_hash, and ask for
    // deleted_at=is.null, so equality on any column is honoured here.
    // Phase 5 adds the shapes the public clip list uses: gte, in, or (the
    // keyset pair), order and limit. Only these forms are understood - the
    // stub is a stand-in for the PostgREST subset this app actually sends.
    const order = url.searchParams.get("order");
    const limit = url.searchParams.get("limit");

    for (const [column, raw] of url.searchParams.entries()) {
      if (!raw || column === "order" || column === "limit" || column === "select") continue;
      if (column === "or") {
        rows = rows.filter((row) => matchesOr(row, raw));
      } else if (raw.startsWith("eq.")) {
        const wanted = raw.slice(3);
        rows = rows.filter((row) => String(row[column] ?? "") === wanted);
      } else if (raw.startsWith("gte.")) {
        const floor = raw.slice(4);
        rows = rows.filter((row) => String(row[column] ?? "") >= floor);
      } else if (raw.startsWith("lt.")) {
        const ceiling = raw.slice(3);
        rows = rows.filter((row) => String(row[column] ?? "") < ceiling);
      } else if (raw.startsWith("in.(")) {
        const list = raw
          .slice(4, -1)
          .split(",")
          .map((item) => item.replace(/^"|"$/g, ""));
        rows = rows.filter((row) => list.includes(String(row[column] ?? "")));
      } else if (raw === "is.null") {
        rows = rows.filter((row) => row[column] === null || row[column] === undefined);
      }
    }

    if (order) {
      const clauses = order.split(",").map((clause) => {
        const [field, direction] = clause.split(".");
        return { field, descending: direction === "desc" };
      });
      rows = [...rows].sort((left, right) => {
        for (const { field, descending } of clauses) {
          const a = left[field];
          const b = right[field];
          if (a === b) continue;
          const result = a > b ? 1 : -1;
          return descending ? -result : result;
        }
        return 0;
      });
    }

    if (limit) rows = rows.slice(0, Number(limit));

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

/**
 * PostgREST `or=(a.lt.1,and(a.eq.1,id.lt.2))` - the keyset pair the public clip
 * list sends. Values may be double-quoted timestamps with escaped quotes, so the
 * splitter respects quoting.
 */
function matchesOr(row, raw) {
  const expression = raw.replace(/^\(/, "").replace(/\)$/, "");
  return splitTopLevel(expression).some((clause) => {
    if (clause.startsWith("and(")) {
      const inner = clause.slice(4, -1);
      return splitTopLevel(inner).every((part) => matchesOr(row, part));
    }
    // `is` (is.null, is.true, ...): the app asks for "never expires" this way,
    // and an unmatched clause would silently hide every row.
    const isMatch = /^([a-z_]+)\.is\.(.+)$/i.exec(clause);
    if (isMatch) {
      const [, column, rawFlag] = isMatch;
      const flag = rawFlag.replace(/^"|"$/g, "").toLowerCase();
      const actual = row[column];
      if (flag === "null") return actual === null || actual === undefined;
      if (flag === "true") return actual === true;
      if (flag === "false") return actual === false;
      return false;
    }
    const match = /^([a-z_]+)\.(eq|lt|gt|gte|lte|ilike)\.(.+)$/i.exec(clause);
    if (!match) return false;
    const [, column, operator, rawValue] = match;
    const value = rawValue.replace(/^"|"$/g, "").replace(/\\"/g, '"');
    const actual = row[column];
    if (operator === "ilike") {
      // PostgREST accepts `*` and `%` as wildcards; both mean "any characters".
      const pattern = value
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*|%/g, ".*");
      return new RegExp(`^${pattern}$`, "i").test(String(actual ?? ""));
    }
    if (operator === "eq") return String(actual ?? "") === value;
    if (operator === "lt") return String(actual ?? "") < value;
    if (operator === "gt") return String(actual ?? "") > value;
    if (operator === "gte") return String(actual ?? "") >= value;
    return String(actual ?? "") <= value;
  });
}

/** Splits on commas that are not inside parentheses or quotes. */
function splitTopLevel(raw) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"' && raw[index - 1] !== "\\") quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/** 30 stable public fixture codes: pub223, pub224, ... (alphabet-safe). */
function publicCode(index) {
  let value = index + 1;
  let suffix = "";
  while (value > 0) {
    suffix = PUBLIC_CODE_ALPHABET[value % PUBLIC_CODE_ALPHABET.length] + suffix;
    value = Math.floor(value / PUBLIC_CODE_ALPHABET.length);
  }
  // 3 letters + 4 characters = the 7-character code the app validates.
  return `pub${suffix.padStart(4, PUBLIC_CODE_ALPHABET[0])}`;
}

function tableRows(table) {
  if (table === "announcements") {
    const extra = announcementFixture
      ? [{ id: `${uid(90)}`, ...ANNOUNCEMENT_FIXTURES[announcementFixture], image: null, url: null, created_at: iso(0), expires_at: null }]
      : [];
    return [...extra, ...ANNOUNCEMENTS];
  }
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
