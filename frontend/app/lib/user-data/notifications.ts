"use client";
// Notifications: Supabase `notification_subscriptions` + `notifications`.
// Rows are created by the fanout_episode_notifications trigger on airing_episodes.

import { attempt, isSignedIn, resolveContext, unwrap, type UserDataContextInput } from "./context";
import { normaliseSnapshot } from "./normalise";
import type { FavouriteSnapshot, NotificationRow } from "./types";

export type NotificationView = {
  id: string;
  mediaId: string;
  title: { romaji: string; native: string; userPreferred: string };
  coverImage: { large: string; extraLarge: string };
  episodes: { number: number; releaseDate: number | null; wasReleased: boolean }[];
  nextReleaseDate: number | null;
  status: string;
  isComplete: boolean;
  isRead: boolean;
  createdAt: number;
};

export type NotificationsResult = {
  items: NotificationView[];
  unreadCount: number;
  rows: NotificationRow[];
};

function unix(date: string | null): number | null {
  if (!date) return null;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : null;
}

export function groupNotifications(rows: NotificationRow[]): NotificationView[] {
  const groups = new Map<number, NotificationRow[]>();

  for (const row of rows || []) {
    if (!row) continue;
    const id = Number(row.anilist_id);
    if (!Number.isFinite(id)) continue;
    const bucket = groups.get(id) ?? [];
    bucket.push(row);
    groups.set(id, bucket);
  }

  const views: NotificationView[] = [];

  for (const [anilistId, group] of groups.entries()) {
    const ordered = [...group].sort((a, b) => Number(a.episode) - Number(b.episode));
    const latest = [...group].sort(
      (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
    )[0];
    const title = latest.title || "";

    views.push({
      id: latest.id,
      mediaId: `${anilistId}`,
      title: { romaji: title, native: title, userPreferred: title },
      coverImage: { large: latest.cover_url || "", extraLarge: latest.cover_url || "" },
      episodes: ordered.map((row) => ({
        number: Number(row.episode),
        releaseDate: unix(row.created_at),
        wasReleased: true,
      })),
      nextReleaseDate: unix(latest.created_at),
      status: "RELEASING",
      isComplete: false,
      isRead: ordered.every((row) => Boolean(row.read_at)),
      createdAt: Date.parse(latest.created_at) || 0,
    });
  }

  return views.sort((a, b) => b.createdAt - a.createdAt);
}

export function countUnread(rows: NotificationRow[]): number {
  return (rows || []).filter((row) => !row.read_at).length;
}

export async function isSubscribed(anilistId: number, input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const result = await attempt("notifications.isSubscribed", async () => {
    const { data, error } = await ctx.client!.from("notification_subscriptions")
      .select("anilist_id")
      .eq("user_id", ctx.userId)
      .eq("anilist_id", Number(anilistId))
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  });

  return result.ok ? result.data : false;
}

/** Guest callers must open the login modal instead (handled by the component). */
export async function subscribe(
  media: unknown,
  input?: UserDataContextInput,
): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const snapshot: FavouriteSnapshot | null = normaliseSnapshot(media);
  const anilistId = Number(snapshot?.id ?? (media as { id?: number })?.id);
  if (!Number.isFinite(anilistId)) return false;

  const result = await attempt("notifications.subscribe", async () => {
    const { error } = await ctx.client!.from("notification_subscriptions").upsert(
      {
        user_id: ctx.userId,
        anilist_id: anilistId,
        snapshot: snapshot ?? { id: anilistId },
      },
      { onConflict: "user_id,anilist_id" },
    );
    if (error) throw error;
    return true;
  });

  return result.ok;
}

export async function unsubscribe(anilistId: number, input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const result = await attempt("notifications.unsubscribe", async () => {
    const { error } = await ctx.client!.from("notification_subscriptions")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("anilist_id", Number(anilistId));
    if (error) throw error;
    return true;
  });

  return result.ok;
}

export async function listNotifications(input?: UserDataContextInput): Promise<NotificationsResult> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return { items: [], unreadCount: 0, rows: [] };

  const result = await attempt("notifications.list", async () => {
    const { data, error } = await ctx.client!.from("notifications")
      .select("id, user_id, anilist_id, episode, title, cover_url, created_at, read_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as NotificationRow[];
  });

  if (!result.ok) return { items: [], unreadCount: 0, rows: [] };

  const rows = result.data;
  return { items: groupNotifications(rows), unreadCount: countUnread(rows), rows };
}

export async function markNotificationRead(id: string, input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const result = await attempt("notifications.markRead", async () => {
    const { error } = await ctx.client!.from("notifications")
      .update({ read_at: new Date(ctx.now()).toISOString() })
      .eq("user_id", ctx.userId)
      .eq("id", id);
    if (error) throw error;
    return true;
  });

  return result.ok;
}

export async function markAllNotificationsRead(input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const result = await attempt("notifications.markAllRead", async () => {
    const { error } = await ctx.client!.from("notifications")
      .update({ read_at: new Date(ctx.now()).toISOString() })
      .eq("user_id", ctx.userId)
      .is("read_at", null);
    if (error) throw error;
    return true;
  });

  return result.ok;
}

export async function deleteNotification(id: string, input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const result = await attempt("notifications.delete", async () => {
    const { error } = await ctx.client!.from("notifications")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("id", id);
    if (error) throw error;
    return true;
  });

  return result.ok;
}

export async function clearNotifications(input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return true;

  const result = await attempt("notifications.clear", async () => {
    const { error } = await ctx.client!.from("notifications").delete().eq("user_id", ctx.userId);
    if (error) throw error;
    return true;
  });

  return result.ok;
}

/** Reads the current subscription list (used by the bell-less pages in tests). */
export async function listSubscriptions(input?: UserDataContextInput): Promise<number[]> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return [];

  const result = await attempt("notifications.subscriptions", async () => {
    const data = unwrap(
      await ctx.client!.from("notification_subscriptions")
        .select("anilist_id")
        .eq("user_id", ctx.userId),
    ) as { anilist_id: number }[];
    return (data ?? []).map((row) => Number(row.anilist_id));
  });

  return result.ok ? result.data : [];
}
