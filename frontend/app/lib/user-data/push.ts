"use client";
// `push_preferences`: one row per user, written by the browser with the user's own
// session (RLS: user_id = auth.uid()).
//
// Every write carries BOTH episode flags because the table rejects a row where
// `new_episodes_all` and `new_episodes_subscribed` are true at the same time.

import { attempt, isSignedIn, resolveContext, unwrap, type UserDataContextInput } from "./context";
import {
  EMPTY_PUSH_PREFERENCES,
  preferenceColumns,
  preferencesFromRow,
  type PushPreferences,
} from "@/app/lib/push/state";

export type PushPreferencesResult = {
  /** True when the read succeeded (an empty row is a success, not a failure). */
  ok: boolean;
  /** True when a row already existed for this user. */
  existed: boolean;
  preferences: PushPreferences;
};

export async function loadPushPreferences(
  input?: UserDataContextInput,
): Promise<PushPreferencesResult> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) {
    return { ok: false, existed: false, preferences: { ...EMPTY_PUSH_PREFERENCES } };
  }

  const result = await attempt("push.loadPreferences", async () => {
    const { data, error } = await ctx.client!.from("push_preferences")
      .select(
        "user_id, enabled, defaults_applied, new_episodes_all, new_episodes_subscribed, replies, likes, mentions, announcements",
      )
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

  if (!result.ok) {
    return { ok: false, existed: false, preferences: { ...EMPTY_PUSH_PREFERENCES } };
  }

  return {
    ok: true,
    existed: Boolean(result.data),
    preferences: preferencesFromRow(result.data as Record<string, unknown> | null),
  };
}

/** Writes the whole preference set in ONE update/insert. */
export async function savePushPreferences(
  preferences: PushPreferences,
  input?: UserDataContextInput,
): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const row = { user_id: ctx.userId, ...preferenceColumns(preferences) };

  const result = await attempt("push.savePreferences", async () => {
    const { error } = await ctx.client!.from("push_preferences").upsert(row, {
      onConflict: "user_id",
    });
    if (error) throw error;
    return true;
  });

  return result.ok;
}

/** True when the server would send this kind of push for this user right now. */
export async function isPushAllowed(
  kind: "reply" | "like" | "mention" | "announcement" | "episode" | "digest",
  input?: UserDataContextInput,
): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const result = await attempt("push.isAllowed", async () => {
    const data = unwrap(
      await ctx.client!.rpc!("push_allowed", { p_user: ctx.userId, p_kind: kind }),
    );
    return data === true;
  });

  return result.ok ? result.data : false;
}
