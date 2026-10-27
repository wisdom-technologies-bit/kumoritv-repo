"use client";
// Comments data access.
//
// Reads always go through the `comment_feed` view: it already carries the author
// name/photo and the like/dislike counts and hides soft-deleted rows. Writes go to
// the `comments` / `comment_reactions` tables with the signed-in user's own browser
// client, so the RLS policies apply (never the service-role client).

import Filter from "bad-words";
import type { Database } from "@/app/lib/supabase/database.types";

/** Untyped on purpose, like the rest of the browser data layer: the generated
 *  Database type only describes part of the schema and the tests pass a stand-in. */
export type CommentsClient = { from(table: string): any };
export type SupabaseCommentsClient = CommentsClient;

export type CommentFeedRow = Database["public"]["Views"]["comment_feed"]["Row"];
export type CommentRow = Database["public"]["Tables"]["comments"]["Row"];
export type CommentReactionRow = Database["public"]["Tables"]["comment_reactions"]["Row"];

export type ReactionValue = 1 | -1;

export const COMMENT_BODY_LIMIT = 400;

export type CommentsFailure = { message: string; code: string | null };
export type CommentsResult<T> = { data: T; error: null } | { data: null; error: CommentsFailure };

export type CommentsSort = "recent" | "likes" | "dislikes";

export type ListCommentsParams = {
  anilistId: number;
  /** undefined/null = every comment of the anime (media page), a number = that
   *  episode only (watch page). */
  episodeNumber?: number | null;
  sort?: CommentsSort;
  limit: number;
  offset?: number;
};

export type AddCommentParams = {
  anilistId: number;
  userId: string;
  body: string;
  isSpoiler?: boolean;
  /** null = comment on the anime itself, a number = comment on that episode. */
  episodeNumber?: number | null;
  /** Always the top-level comment id (replies are one level deep). */
  parentId?: string | null;
};

const swearFilter = new Filter();

function toFailure(error: unknown): CommentsFailure {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    return {
      message: typeof candidate.message === "string" ? candidate.message : "Something went wrong.",
      code: typeof candidate.code === "string" ? candidate.code : null,
    };
  }
  return { message: "Something went wrong.", code: null };
}

/** The database guard raises this exact sentence when a user comments twice
 *  within 10 seconds. */
export function isCommentingTooFast(failure: CommentsFailure | null | undefined): boolean {
  return !!failure && /commenting too fast/i.test(failure.message);
}

/** Trims and profanity-filters a comment before it is sent (same as the old form). */
export function normaliseCommentBody(body: string): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return "";
  return swearFilter.clean(trimmed).trim();
}

function applyEpisodeFilter(query: any, episodeNumber?: number | null) {
  if (episodeNumber === undefined || episodeNumber === null) return query;
  return query.eq("episode_number", episodeNumber);
}

function applySort(query: any, sort: CommentsSort = "recent") {
  if (sort === "likes") return query.order("likes", { ascending: false }).order("created_at", { ascending: false });
  if (sort === "dislikes") return query.order("dislikes", { ascending: false }).order("created_at", { ascending: false });
  return query.order("created_at", { ascending: false });
}

/** Top-level comments, newest first by default. Paginated in the database. */
export async function listComments(
  client: CommentsClient,
  { anilistId, episodeNumber, sort = "recent", limit, offset = 0 }: ListCommentsParams,
): Promise<CommentsResult<CommentFeedRow[]>> {
  try {
    let query = client.from("comment_feed").select("*").eq("anilist_id", anilistId).is("parent_id", null);
    query = applyEpisodeFilter(query, episodeNumber);
    query = applySort(query, sort);

    const size = Math.max(1, limit);
    const { data, error } = await query.range(offset, offset + size - 1);
    if (error) return { data: null, error: toFailure(error) };
    return { data: (data ?? []) as CommentFeedRow[], error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** Total number of top-level comments for the current filter. */
export async function countComments(
  client: CommentsClient,
  { anilistId, episodeNumber }: { anilistId: number; episodeNumber?: number | null },
): Promise<CommentsResult<number>> {
  try {
    let query = client
      .from("comment_feed")
      .select("id", { count: "exact", head: true })
      .eq("anilist_id", anilistId)
      .is("parent_id", null);
    query = applyEpisodeFilter(query, episodeNumber);

    const { count, error } = await query;
    if (error) return { data: null, error: toFailure(error) };
    return { data: Number(count ?? 0), error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** Replies for the visible top-level comments, oldest first. */
export async function listReplies(
  client: CommentsClient,
  parentIds: string[],
): Promise<CommentsResult<CommentFeedRow[]>> {
  if (!parentIds.length) return { data: [], error: null };
  try {
    const { data, error } = await client
      .from("comment_feed")
      .select("*")
      .in("parent_id", parentIds)
      .order("created_at", { ascending: true });
    if (error) return { data: null, error: toFailure(error) };
    return { data: (data ?? []) as CommentFeedRow[], error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** The signed-in user's own reactions, so the active buttons are correct. */
export async function listMyReactions(
  client: CommentsClient,
  userId: string | null,
  commentIds: string[],
): Promise<CommentsResult<Record<string, ReactionValue>>> {
  if (!userId || !commentIds.length) return { data: {}, error: null };
  try {
    const { data, error } = await client
      .from("comment_reactions")
      .select("comment_id, value")
      .eq("user_id", userId)
      .in("comment_id", commentIds);
    if (error) return { data: null, error: toFailure(error) };

    const reactions: Record<string, ReactionValue> = {};
    for (const row of (data ?? []) as Pick<CommentReactionRow, "comment_id" | "value">[]) {
      if (row.value === 1 || row.value === -1) reactions[row.comment_id] = row.value;
    }
    return { data: reactions, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

export async function addComment(
  client: CommentsClient,
  { anilistId, userId, body, isSpoiler = false, episodeNumber = null, parentId = null }: AddCommentParams,
): Promise<CommentsResult<CommentRow>> {
  const cleaned = normaliseCommentBody(body);
  if (!cleaned) return { data: null, error: { message: "Write something first.", code: "empty_body" } };

  try {
    const { data, error } = await client
      .from("comments")
      .insert({
        anilist_id: anilistId,
        episode_number: episodeNumber ?? null,
        user_id: userId,
        parent_id: parentId ?? null,
        body: cleaned,
        is_spoiler: isSpoiler,
      })
      .select()
      .single();
    if (error) return { data: null, error: toFailure(error) };
    return { data: data as CommentRow, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** Soft delete: the row stays, the view stops returning it. */
export async function softDeleteComment(
  client: CommentsClient,
  { commentId, userId }: { commentId: string; userId: string },
): Promise<CommentsResult<true>> {
  try {
    const { error } = await client
      .from("comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", commentId)
      .eq("user_id", userId);
    if (error) return { data: null, error: toFailure(error) };
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** Adds or switches a reaction (one row per user per comment). */
export async function setReaction(
  client: CommentsClient,
  { commentId, userId, value }: { commentId: string; userId: string; value: ReactionValue },
): Promise<CommentsResult<true>> {
  try {
    const { error } = await client
      .from("comment_reactions")
      .upsert({ comment_id: commentId, user_id: userId, value }, { onConflict: "comment_id,user_id" });
    if (error) return { data: null, error: toFailure(error) };
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}

/** Clicking the active reaction again removes it. */
export async function clearReaction(
  client: CommentsClient,
  { commentId, userId }: { commentId: string; userId: string },
): Promise<CommentsResult<true>> {
  try {
    const { error } = await client
      .from("comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);
    if (error) return { data: null, error: toFailure(error) };
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: toFailure(error) };
  }
}
