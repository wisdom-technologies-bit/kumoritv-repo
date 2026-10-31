// Server-side "what the page already shows" comment lookup for structured data.
//
// The visible comments section reads through the same public `comment_feed`
// view: author name, like counts, soft-deleted rows already hidden. The browser
// helpers live in app/lib/comments/queries.ts, which is a "use client" module
// (its functions are client references and cannot run on the server), so this
// module repeats the same two reads — the exact-count query and the top-liked
// page — against that same view.
//
// Everything here is best effort: any failure or timeout returns null and the
// caller simply omits `comment` / `commentCount`. Structured data must never be
// able to break a page render.

import "server-only";
import type { CommentSummary } from "./jsonld";
import { stripHtml } from "./text";

/** Short on purpose: this runs inside a server render. */
export const COMMENTS_JSONLD_BUDGET_MS = 1200;
/** How many top-liked rows are inspected before the best five are kept. */
export const COMMENTS_JSONLD_CANDIDATES = 25;
export const COMMENTS_JSONLD_LIMIT = 5;

type CommentsClient = { from(table: string): any };

export type CommentSummaryParams = {
  anilistId: number;
  /** undefined/null = the whole title (media page), a number = that episode. */
  episodeNumber?: number | null;
};

type CommentFeedRow = {
  body?: unknown;
  created_at?: unknown;
  is_spoiler?: unknown;
  username?: unknown;
  display_name?: unknown;
  likes?: unknown;
  user_id?: unknown;
  deleted_at?: unknown;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(fallback);

  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);

    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

/** Total number of top-level comments for the same filter the panel uses. */
export async function countPageComments(
  client: CommentsClient,
  { anilistId, episodeNumber }: CommentSummaryParams,
): Promise<number | null> {
  let query = client
    .from("comment_feed")
    .select("id", { count: "exact", head: true })
    .eq("anilist_id", anilistId)
    .is("parent_id", null);

  if (episodeNumber !== undefined && episodeNumber !== null) {
    query = query.eq("episode_number", episodeNumber);
  }

  const { count, error } = await query;
  if (error) return null;

  const value = Number(count ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

/** The most-liked top-level comments, spoilers and blanks removed. */
export async function readTopComments(
  client: CommentsClient,
  { anilistId, episodeNumber }: CommentSummaryParams,
): Promise<CommentSummary["comments"] | null> {
  let query = client
    .from("comment_feed")
    .select("body, created_at, is_spoiler, username, display_name, likes, user_id")
    .eq("anilist_id", anilistId)
    .is("parent_id", null);

  if (episodeNumber !== undefined && episodeNumber !== null) {
    query = query.eq("episode_number", episodeNumber);
  }

  const { data, error } = await query
    .order("likes", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(COMMENTS_JSONLD_CANDIDATES);

  if (error) return null;

  const rows = Array.isArray(data) ? (data as CommentFeedRow[]) : [];
  const comments: CommentSummary["comments"] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    // Soft-deleted and spoiler comments are never published as markup, and an
    // empty body has nothing to quote.
    if (row?.deleted_at) continue;
    if (row?.is_spoiler === true) continue;

    const text = stripHtml(row?.body);
    if (!text) continue;

    const created = typeof row?.created_at === "string" ? row.created_at.trim() : "";
    if (!created) continue;

    const author =
      (typeof row?.display_name === "string" && row.display_name.trim()) ||
      (typeof row?.username === "string" && row.username.trim()) ||
      "";
    if (!author) continue;

    // Two rows with the same author + body would render as duplicate markup.
    const key = `${author}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    comments.push({ text, datePublished: created, author });
    if (comments.length >= COMMENTS_JSONLD_LIMIT) break;
  }

  return comments;
}

/**
 * Everything the markup needs, or null when it cannot be proven.
 * Never throws and never runs past `budgetMs`.
 */
export async function readCommentSummary(
  client: CommentsClient | null | undefined,
  params: CommentSummaryParams,
  budgetMs: number = COMMENTS_JSONLD_BUDGET_MS,
): Promise<CommentSummary | null> {
  const anilistId = Number(params?.anilistId);
  if (!client || !Number.isInteger(anilistId) || anilistId <= 0) return null;

  const work = (async (): Promise<CommentSummary | null> => {
    const [count, comments] = await Promise.all([
      countPageComments(client, params),
      readTopComments(client, params),
    ]);

    if (count === null && comments === null) return null;

    return {
      commentCount: count ?? 0,
      comments: comments ?? [],
    };
  })();

  return withTimeout(work, budgetMs, null);
}

/** Convenience wrapper that builds the admin client itself. */
export async function loadCommentSummary(
  params: CommentSummaryParams,
): Promise<CommentSummary | null> {
  try {
    const { createAdminClient } = await import("@/app/lib/supabase/admin");
    const client = createAdminClient();
    if (!client) return null;
    return await readCommentSummary(client as unknown as CommentsClient, params);
  } catch {
    return null;
  }
}
