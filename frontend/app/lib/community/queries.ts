"use client";
// Prompt 38B: community data access from the browser.
//
// Reads come from community_feed_page() (granted to anon, so guests work) and
// from comment_feed for a thread. Writes use the browser client with the user's
// own session, exactly like app/lib/comments/queries.ts. Post creation goes
// through /api/community/posts because there is no insert policy at all.
import type { SupabaseClient } from "@supabase/supabase-js";

export type CommunityKind = "post" | "announcement";

export type FeedItem = {
  feed_key: string;
  kind: CommunityKind;
  created_at: string;
  author_id: string | null;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar: string | null;
  body: string | null;
  is_spoiler: boolean;
  title: string | null;
  image_url: string | null;
  link_url: string | null;
  clip_code: string | null;
  clip_start: number | null;
  clip_end: number | null;
  anime_id: number | null;
  anime_title: string | null;
  anime_cover: string | null;
  episode_number: number | null;
  target_url: string;
  reply_count: number;
  likes: number;
  dislikes: number;
};

export type FeedFilter = "all" | "post" | "announcement";

export type FeedPage = { items: FeedItem[]; cursor: { createdAt: string; key: string } | null };

export type CommunityFailure = { message: string; code: string | null };
export type CommunityResult<T> = { data: T; error: null } | { data: null; error: CommunityFailure };

export const FEED_PAGE_SIZE = 20;

function toFailure(error: unknown): CommunityFailure {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    return {
      message: typeof candidate.message === "string" ? candidate.message : "Something went wrong.",
      code: typeof candidate.code === "string" ? candidate.code : null,
    };
  }
  return { message: "Something went wrong.", code: null };
}

/** The generated Database type does not know the community RPCs yet, so the
 *  client is taken structurally. `any` on rpc keeps the overloads out of the way. */
type RpcClient = { rpc: any };

/** One page of the merged feed. The cursor is (created_at, feed_key), never an offset. */
export async function listFeedPage(
  client: RpcClient | null,
  options: {
    filter?: FeedFilter;
    limit?: number;
    cursor?: { createdAt: string; key: string } | null;
    showAdult?: boolean;
  } = {},
): Promise<CommunityResult<FeedPage>> {
  if (!client) return { data: null, error: { message: "Community is unavailable right now.", code: "unavailable" } };

  const limit = Math.min(Math.max(options.limit ?? FEED_PAGE_SIZE, 1), 50);
  try {
    const { data, error } = await client.rpc("community_feed_page", {
      p_limit: limit,
      p_cursor_created_at: options.cursor?.createdAt ?? null,
      p_cursor_key: options.cursor?.key ?? null,
      p_kind: options.filter ?? "all",
      p_show_adult: options.showAdult === true,
      p_author: null,
      p_anilist_id: null,
      p_hide_blocked: true,
    });
    if (error) return { data: null, error: toFailure(error) };

    const items = ((data ?? []) as FeedItem[]).filter(
      (row) => row && (row.kind === "post" || row.kind === "announcement"),
    );
    const last = items[items.length - 1];
    return {
      data: { items, cursor: last ? { createdAt: last.created_at, key: last.feed_key } : null },
      error: null,
    };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** My own like/dislike for the visible posts (RLS: own rows only). */
export async function listMyPostReactions(
  client: SupabaseClient | null,
  userId: string | null,
  postIds: string[],
): Promise<CommunityResult<Record<string, 1 | -1>>> {
  if (!client || !userId || postIds.length === 0) return { data: {}, error: null };
  try {
    const { data, error } = await (client as any)
      .from("community_reactions")
      .select("post_id, value")
      .eq("user_id", userId)
      .in("post_id", postIds);
    if (error) return { data: null, error: toFailure(error) };

    const mine: Record<string, 1 | -1> = {};
    for (const row of (data ?? []) as { post_id: string | null; value: number }[]) {
      if (row.post_id && (row.value === 1 || row.value === -1)) mine[row.post_id] = row.value as 1 | -1;
    }
    return { data: mine, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** Like / dislike / clear through the one function that keeps counts honest. */
export async function reactToPost(
  client: RpcClient | null,
  postId: string,
  value: 1 | -1 | null,
): Promise<CommunityResult<{ likes: number; dislikes: number; mine: 1 | -1 | null }>> {
  if (!client) return { data: null, error: { message: "Community is unavailable right now.", code: "unavailable" } };
  try {
    const { data, error } = await client.rpc("community_react", {
      p_kind: "post",
      p_id: postId,
      p_value: value,
    });
    if (error) return { data: null, error: toFailure(error) };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { likes: number; dislikes: number; mine: number | null }
      | undefined;
    if (!row) return { data: null, error: { message: "That reaction did not save.", code: "no_row" } };

    return {
      data: {
        likes: Number(row.likes ?? 0),
        dislikes: Number(row.dislikes ?? 0),
        mine: row.mine === 1 || row.mine === -1 ? (row.mine as 1 | -1) : null,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** One post, for the post page (server-rendered, so this is not in the browser path). */
export async function getPost(
  client: SupabaseClient | null,
  id: string,
): Promise<CommunityResult<Record<string, any> | null>> {
  if (!client) return { data: null, error: { message: "Community is unavailable right now.", code: "unavailable" } };
  try {
    const { data, error } = await (client as any)
      .from("community_posts")
      .select("id, author_id, body, is_spoiler, created_at, status, deleted_at, pinned")
      .eq("id", id)
      .maybeSingle();
    if (error) return { data: null, error: toFailure(error) };
    return { data: data ?? null, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** Latest live announcements, for the right rail and the announcement page. */
export async function listAnnouncements(
  client: SupabaseClient | null,
  limit = 5,
): Promise<CommunityResult<Array<{ id: string; title: string; body: string | null; image: string | null; url: string | null; created_at: string }>>> {
  if (!client) return { data: [], error: null };
  try {
    const { data, error } = await (client as any)
      .from("announcements")
      .select("id, title, body, image, url, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { data: null, error: toFailure(error) };
    return { data: (data ?? []) as any, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** The single author row needed by a post/announcement page. */
export async function listAuthor(
  client: SupabaseClient | null,
  ids: string[],
): Promise<CommunityResult<Record<string, { username: string | null; display_name: string | null; avatar_url: string | null }>>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!client || unique.length === 0) return { data: {}, error: null };
  try {
    const { data, error } = await (client as any)
      .from("public_profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", unique);
    if (error) return { data: null, error: toFailure(error) };

    const map: Record<string, { username: string | null; display_name: string | null; avatar_url: string | null }> = {};
    for (const row of (data ?? []) as any[]) {
      map[row.id] = { username: row.username, display_name: row.display_name, avatar_url: row.avatar_url };
    }
    return { data: map, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}
