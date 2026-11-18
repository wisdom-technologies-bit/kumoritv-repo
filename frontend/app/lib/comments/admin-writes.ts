// Phase 6, part E: the three comment writes, with the type boundary in one place.
//
// public.comments exists in database.types.ts, but the hand-written Database
// shape does not satisfy supabase-js's GenericSchema, so `.from("comments")`
// resolves to `never` on the typed client and every call site would need a cast.
// Rather than an `any` at each of the three places (and an eslint-disable at
// each), the client is narrowed once, here, to the only chain these writes use.
//
// The service role is deliberate: after community-phase-6-lockdown.sql the
// browser has no INSERT/UPDATE grant on public.comments, and this is the writer
// the API routes use. Ownership is therefore enforced in the filters below -
// every update and delete carries `user_id`, and a miss returns null, which the
// handlers answer as 404 so someone else's comment is never confirmed to exist.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommentRowShape } from "./comments-server";

type RowResult<T> = { data: T | null; error: { message?: string } | null };

type UpdateChain<T> = {
  eq: (column: string, value: string) => UpdateChain<T>;
  is: (column: string, value: null) => UpdateChain<T>;
  select: (columns: string) => { maybeSingle: () => Promise<RowResult<T>> };
};

type CommentsWriter = {
  from: (table: "comments") => {
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => { single: () => Promise<RowResult<CommentRowShape>> };
    };
    update: (patch: Record<string, unknown>) => UpdateChain<{ id: string; is_spoiler: boolean }>;
  };
};

function writer(admin: SupabaseClient<never> | SupabaseClient<unknown> | unknown): CommentsWriter {
  return admin as unknown as CommentsWriter;
}

const CREATED_COLUMNS =
  "id, target_type, post_id, announcement_id, anilist_id, episode_number, parent_id, user_id, body, is_spoiler, created_at";

export async function insertCommentRow(
  admin: unknown,
  row: Record<string, unknown>,
): Promise<RowResult<CommentRowShape>> {
  return writer(admin).from("comments").insert(row).select(CREATED_COLUMNS).single();
}

export async function patchCommentSpoiler(
  admin: unknown,
  { commentId, userId, isSpoiler }: { commentId: string; userId: string; isSpoiler: boolean },
): Promise<RowResult<{ id: string; is_spoiler: boolean }>> {
  return writer(admin)
    .from("comments")
    .update({ is_spoiler: isSpoiler })
    .eq("id", commentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id, is_spoiler")
    .maybeSingle();
}

export async function softDeleteCommentRow(
  admin: unknown,
  { commentId, userId, at }: { commentId: string; userId: string; at: string },
): Promise<RowResult<{ id: string; is_spoiler: boolean }>> {
  return writer(admin)
    .from("comments")
    .update({ deleted_at: at })
    .eq("id", commentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
}
