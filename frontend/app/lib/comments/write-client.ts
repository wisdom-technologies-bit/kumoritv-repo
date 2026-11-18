"use client";
// Phase 6, part E: comment writes from the browser.
//
// The browser no longer touches public.comments: after the lockdown file it has
// no INSERT/UPDATE grant, and every write goes through /api/comments, which
// validates, filters profanity, applies the limits and owns the row's user_id.
//
// The return shape matches the old query helpers ({ data, error }) so the
// components did not have to be rewritten around a new contract.
import type { CommentRowShape } from "./comments-server";

export type WriteFailure = { message: string; code: string | null };

export type PostCommentInput = {
  targetKind: "anime" | "post" | "announcement";
  targetId?: string;
  anilistId?: number;
  episodeNumber?: number | null;
  parentId?: string | null;
  body: string;
  isSpoiler?: boolean;
};

async function request<T>(url: string, init: RequestInit): Promise<{ data: T | null; error: WriteFailure | null }> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        data: null,
        error: {
          message: typeof payload.message === "string" ? payload.message : "That did not save. Try again.",
          code: typeof payload.error === "string" ? payload.error : null,
        },
      };
    }
    return { data: payload as T, error: null };
  } catch {
    return { data: null, error: { message: "Check your connection and try again.", code: null } };
  }
}

export async function postComment(
  input: PostCommentInput,
): Promise<{ data: CommentRowShape | null; error: WriteFailure | null }> {
  const result = await request<{ comment: CommentRowShape }>("/api/comments", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (result.error) return { data: null, error: result.error };
  return { data: result.data?.comment ?? null, error: null };
}

export async function patchComment(
  id: string,
  isSpoiler: boolean,
): Promise<{ data: { id: string; is_spoiler: boolean } | null; error: WriteFailure | null }> {
  const result = await request<{ comment: { id: string; is_spoiler: boolean } }>(`/api/comments/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isSpoiler }),
  });
  if (result.error) return { data: null, error: result.error };
  return { data: result.data?.comment ?? null, error: null };
}

export async function deleteComment(id: string): Promise<{ data: true | null; error: WriteFailure | null }> {
  const result = await request<{ ok: true }>(`/api/comments/${id}`, { method: "DELETE" });
  if (result.error) return { data: null, error: result.error };
  return { data: true, error: null };
}
