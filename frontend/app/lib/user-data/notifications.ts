"use client";
// Notifications: Supabase `notification_subscriptions` + `notifications`.
// Rows are created by the fanout_episode_notifications trigger on airing_episodes.

import { attempt, isSignedIn, resolveContext, unwrap, type UserDataContextInput } from "./context";
import { normaliseSnapshot } from "./normalise";
import { displayTitle } from "@/app/lib/titles";
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
      title: { romaji: title, native: title, userPreferred: displayTitle(title) },
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

// ---------------------------------------------------------------------------
// The unified bell
//
// Three sources feed one panel:
//   (a) `notifications`      — grouped episode rows (behaviour unchanged)
//   (b) `user_notifications` — reply / like / mention / digest rows written by the
//                              prompt 21 triggers and the push cron
//   (c) `announcements`      — visible to every signed-in user; read state lives
//                              in `announcement_reads`
//
// All three are created whether or not the user allows push: the toggles only
// decide whether a push is ALSO sent.
// ---------------------------------------------------------------------------

export type UserNotificationKind = "reply" | "like" | "mention" | "digest";

export type UserNotificationRow = {
  id: string;
  kind: UserNotificationKind;
  title: string;
  body: string | null;
  url: string | null;
  image: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  comment_id: string | null;
  count: number;
  created_at: string;
  read_at: string | null;
};

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  image: string | null;
  created_at: string;
  expires_at: string | null;
};

export type UserNotificationView = {
  id: string;
  kind: UserNotificationKind;
  title: string;
  body: string | null;
  url: string | null;
  image: string | null;
  actorName: string | null;
  actorAvatar: string | null;
  count: number;
  isRead: boolean;
  createdAt: number;
};

export type AnnouncementView = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  image: string | null;
  isRead: boolean;
  createdAt: number;
};

export type BellItem =
  | { source: "episodes"; id: string; createdAt: number; item: NotificationView }
  | { source: "user"; id: string; createdAt: number; item: UserNotificationView }
  | { source: "announcement"; id: string; createdAt: number; item: AnnouncementView };

/** The panel never renders more than the latest 50 items. */
export const BELL_ITEM_LIMIT = 50;

function toMillis(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toUserNotificationView(row: UserNotificationRow): UserNotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body ?? null,
    url: row.url ?? null,
    image: row.image ?? null,
    actorName: row.actor_name ?? null,
    actorAvatar: row.actor_avatar ?? null,
    count: Number(row.count) || 1,
    isRead: Boolean(row.read_at),
    createdAt: toMillis(row.created_at),
  };
}

/** An announcement is visible until it expires; there is no other targeting. */
export function isAnnouncementVisible(
  row: { expires_at?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!row?.expires_at) return true;
  const expires = Date.parse(row.expires_at);
  return !Number.isFinite(expires) ? true : expires > now;
}

export function toAnnouncementView(row: AnnouncementRow, readIds: Set<string>): AnnouncementView {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? null,
    url: row.url ?? null,
    image: row.image ?? null,
    isRead: readIds.has(row.id),
    createdAt: toMillis(row.created_at),
  };
}

/** Newest first across the three sources, capped at `limit`. */
export function mergeBellItems(input: {
  episodes?: NotificationView[];
  userNotifications?: UserNotificationView[];
  announcements?: AnnouncementView[];
  limit?: number;
}): BellItem[] {
  const items: BellItem[] = [
    ...(input.episodes ?? []).map((item) => ({
      source: "episodes" as const,
      id: `episode-${item.id}`,
      createdAt: Number(item.createdAt) || 0,
      item,
    })),
    ...(input.userNotifications ?? []).map((item) => ({
      source: "user" as const,
      id: `user-${item.id}`,
      createdAt: Number(item.createdAt) || 0,
      item,
    })),
    ...(input.announcements ?? []).map((item) => ({
      source: "announcement" as const,
      id: `announcement-${item.id}`,
      createdAt: Number(item.createdAt) || 0,
      item,
    })),
  ];

  items.sort((a, b) => b.createdAt - a.createdAt);

  return items.slice(0, Math.max(0, input.limit ?? BELL_ITEM_LIMIT));
}

/** Unread episode rows + unread user_notifications + unread announcements. */
export function countBellUnread(input: {
  episodeRows?: Array<{ read_at: string | null }>;
  userNotifications?: UserNotificationView[];
  announcements?: AnnouncementView[];
}): number {
  const episodes = (input.episodeRows ?? []).filter((row) => !row.read_at).length;
  const mine = (input.userNotifications ?? []).filter((item) => !item.isRead).length;
  const news = (input.announcements ?? []).filter((item) => !item.isRead).length;

  return episodes + mine + news;
}

export type BellResult = {
  items: BellItem[];
  unreadCount: number;
  episodes: NotificationView[];
  userNotifications: UserNotificationView[];
  announcements: AnnouncementView[];
};

export async function listUserNotifications(input?: UserDataContextInput): Promise<{
  items: UserNotificationView[];
  unreadCount: number;
  rows: UserNotificationRow[];
}> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return { items: [], unreadCount: 0, rows: [] };

  const result = await attempt("notifications.listUserNotifications", async () => {
    const { data, error } = await ctx.client!.from("user_notifications")
      .select(
        "id, kind, title, body, url, image, actor_name, actor_avatar, comment_id, count, created_at, read_at",
      )
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(BELL_ITEM_LIMIT);
    if (error) throw error;
    return (data ?? []) as UserNotificationRow[];
  });

  if (!result.ok) return { items: [], unreadCount: 0, rows: [] };

  const rows = result.data;
  const items = rows.map(toUserNotificationView);

  return { items, unreadCount: items.filter((item) => !item.isRead).length, rows };
}

export async function listAnnouncements(input?: UserDataContextInput): Promise<{
  items: AnnouncementView[];
  unreadCount: number;
  rows: AnnouncementRow[];
}> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return { items: [], unreadCount: 0, rows: [] };

  const result = await attempt("notifications.listAnnouncements", async () => {
    const { data: announcements, error } = await ctx.client!.from("announcements")
      .select("id, title, body, url, image, created_at, expires_at")
      .order("created_at", { ascending: false })
      .limit(BELL_ITEM_LIMIT);
    if (error) throw error;

    const { data: reads, error: readError } = await ctx.client!.from("announcement_reads")
      .select("announcement_id")
      .eq("user_id", ctx.userId);
    if (readError) throw readError;

    return {
      announcements: ((announcements ?? []) as AnnouncementRow[]).filter((row) =>
        isAnnouncementVisible(row, ctx.now()),
      ),
      readIds: new Set(
        ((reads ?? []) as Array<{ announcement_id: string }>).map((row) => row.announcement_id),
      ),
    };
  });

  if (!result.ok) return { items: [], unreadCount: 0, rows: [] };

  const rows = result.data.announcements;
  const items = rows.map((row) => toAnnouncementView(row, result.data.readIds));

  return { items, unreadCount: items.filter((item) => !item.isRead).length, rows };
}

/**
 * One read for the whole panel. The episode rows keep their own semantics
 * (`notification_subscriptions` fanout rows), so the pieces are fetched and
 * counted separately and then merged for display.
 */
export async function loadBell(input?: UserDataContextInput): Promise<BellResult> {
  const [episodes, userNotifications, announcements] = await Promise.all([
    listNotifications(input),
    listUserNotifications(input),
    listAnnouncements(input),
  ]);

  return {
    items: mergeBellItems({
      episodes: episodes.items,
      userNotifications: userNotifications.items,
      announcements: announcements.items,
    }),
    unreadCount: countBellUnread({
      episodeRows: episodes.rows,
      userNotifications: userNotifications.items,
      announcements: announcements.items,
    }),
    episodes: episodes.items,
    userNotifications: userNotifications.items,
    announcements: announcements.items,
  };
}

/** "Mark all read" covers all three sources. */
export async function markAllBellRead(input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const now = new Date(ctx.now()).toISOString();

  const result = await attempt("notifications.markAllBellRead", async () => {
    const [episodeRows, userRows] = await Promise.all([
      ctx.client!.from("notifications")
        .update({ read_at: now })
        .eq("user_id", ctx.userId)
        .is("read_at", null),
      ctx.client!.from("user_notifications")
        .update({ read_at: now })
        .eq("user_id", ctx.userId)
        .is("read_at", null),
    ]);

    if (episodeRows?.error) throw episodeRows.error;
    if (userRows?.error) throw userRows.error;

    // Announcements have no per-row read column: the read is a row in
    // announcement_reads, and the primary key makes the insert idempotent.
    const { data: announcements, error } = await ctx.client!.from("announcements")
      .select("id, expires_at");
    if (error) throw error;

    const visible = ((announcements ?? []) as Array<{ id: string; expires_at: string | null }>)
      .filter((row) => isAnnouncementVisible(row, ctx.now()))
      .map((row) => ({ user_id: ctx.userId, announcement_id: row.id }));

    if (visible.length) {
      const { error: readError } = await ctx.client!.from("announcement_reads")
        .upsert(visible, { onConflict: "user_id,announcement_id" });
      if (readError) throw readError;
    }

    return true;
  });

  return result.ok;
}

/** Marks one announcement read (opening it from the bell). */
export async function markAnnouncementRead(
  announcementId: string,
  input?: UserDataContextInput,
): Promise<boolean> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return false;

  const result = await attempt("notifications.markAnnouncementRead", async () => {
    const { error } = await ctx.client!.from("announcement_reads").upsert(
      { user_id: ctx.userId, announcement_id: announcementId, read_at: new Date(ctx.now()).toISOString() },
      { onConflict: "user_id,announcement_id" },
    );
    if (error) throw error;
    return true;
  });

  return result.ok;
}
