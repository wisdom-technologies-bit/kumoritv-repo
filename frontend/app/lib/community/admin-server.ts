// Phase 6, part B: the reads behind /community/admin.
//
// Every function here runs on the STAFF MEMBER'S OWN SESSION (createClient with
// the request cookies), so is_staff() inside each SQL function decides, and RLS
// applies on top. The service role is not used anywhere in this file: nothing
// the inbox needs is outside what staff policies already allow.
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Supabase builder; rows are narrowed below */
import "server-only";
import { createClient } from "@/app/lib/supabase/server";

export type ModerationStatus = "published" | "hidden" | "removed";

export type ModerationStats = {
  open_reports: number;
  stale_reports: number;
  actions_7d: number;
  hidden_items: number;
  removed_items: number;
  open_clip_reports: number;
};

export type ReportGroup = {
  target_kind: "post" | "comment" | "announcement";
  target_id: string;
  report_count: number;
  reporter_count: number;
  reasons: string[] | null;
  first_report_at: string;
  latest_report_at: string;
  open_count: number;
  author_id: string | null;
  author_name: string | null;
  preview: string | null;
  target_status: ModerationStatus | null;
  is_gone: boolean;
};

export type ClipReportGroup = {
  clip_id: string;
  code: string | null;
  title: string | null;
  report_count: number;
  reasons: string[] | null;
  first_report_at: string;
  latest_report_at: string;
  open_count: number;
  owner_id: string | null;
  clip_state: "published" | "hidden" | "removed" | "gone";
  is_gone: boolean;
};

export type QueueItem = {
  kind: "post" | "comment" | "announcement" | "clip";
  id: string;
  author_id: string | null;
  author_name: string | null;
  preview: string | null;
  status: ModerationStatus;
  reason: string | null;
  moderated_at: string | null;
  moderated_by: string | null;
  reports: number;
};

export type ReportRow = {
  id: string;
  reporter_id: string | null;
  reporter_hash: string | null;
  reason: string;
  details: string | null;
  status: "open" | "actioned" | "dismissed";
  created_at: string;
  resolved_at: string | null;
};

export type ClipReportRow = {
  id: string;
  reporter_hash: string | null;
  reason: string;
  details: string | null;
  status: "open" | "actioned" | "dismissed";
  created_at: string;
};

export type LogRow = {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_kind: string;
  target_id: string;
  reason: string | null;
  created_at: string;
};

export type Cursor = { count: number; latest: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return `${cursor.count}~${cursor.latest}~${cursor.id}`;
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  const [count, latest, id] = raw.split("~");
  const parsed = Number(count);
  if (!Number.isFinite(parsed) || !latest || !id) return null;
  return { count: parsed, latest, id };
}

async function rpcRows<T>(name: string, args: Record<string, unknown>): Promise<T[]> {
  try {
    const client = createClient();
    if (!client) return [];
    const { data, error } = await (client as any).rpc(name, args);
    if (error) return [];
    return ((data ?? []) as unknown[]).map((row) => row as T);
  } catch {
    return [];
  }
}

export async function readModerationStats(): Promise<ModerationStats | null> {
  const rows = await rpcRows<ModerationStats>("community_moderation_stats", {});
  const row = rows[0];
  if (!row) return null;
  return {
    open_reports: Number(row.open_reports ?? 0),
    stale_reports: Number(row.stale_reports ?? 0),
    actions_7d: Number(row.actions_7d ?? 0),
    hidden_items: Number(row.hidden_items ?? 0),
    removed_items: Number(row.removed_items ?? 0),
    open_clip_reports: Number(row.open_clip_reports ?? 0),
  };
}

export async function readReportGroups(options: {
  status?: string | null;
  kind?: string | null;
  reason?: string | null;
  limit?: number;
  after?: Cursor | null;
}): Promise<ReportGroup[]> {
  return rpcRows<ReportGroup>("community_report_groups", {
    p_status: options.status ?? null,
    p_kind: options.kind ?? null,
    p_reason: options.reason ?? null,
    p_limit: options.limit ?? 25,
    p_after_count: options.after?.count ?? null,
    p_after_latest: options.after?.latest ?? null,
    p_after_id: options.after?.id ?? null,
  });
}

export async function readClipReportGroups(options: {
  status?: string | null;
  limit?: number;
  after?: Cursor | null;
}): Promise<ClipReportGroup[]> {
  return rpcRows<ClipReportGroup>("community_clip_report_groups", {
    p_status: options.status ?? null,
    p_limit: options.limit ?? 25,
    p_after_count: options.after?.count ?? null,
    p_after_latest: options.after?.latest ?? null,
    p_after_id: options.after?.id ?? null,
  });
}

export async function readModerationQueue(options: {
  kind?: string | null;
  limit?: number;
  before?: { at: string; id: string } | null;
}): Promise<QueueItem[]> {
  return rpcRows<QueueItem>("community_moderation_queue", {
    p_kind: options.kind ?? null,
    p_limit: options.limit ?? 50,
    p_before: options.before?.at ?? null,
    p_before_id: options.before?.id ?? null,
  });
}

const CONTENT_TABLE = {
  post: { table: "community_posts", author: "author_id" },
  comment: { table: "comments", author: "user_id" },
  announcement: { table: "announcements", author: "created_by" },
} as const;

export type ContentDetail = {
  kind: "post" | "comment" | "announcement" | "clip";
  id: string;
  body: string | null;
  title: string | null;
  created_at: string | null;
  author_id: string | null;
  author_name: string;
  status: ModerationStatus | "gone";
  reason: string | null;
  moderated_at: string | null;
  is_spoiler: boolean;
  clip_code: string | null;
  clip_title: string | null;
  clip_start: number | null;
  clip_end: number | null;
  anilist_id: number | null;
  episode_number: number | null;
  post_id: string | null;
  announcement_id: string | null;
};

async function profileName(client: any, id: string | null): Promise<string> {
  if (!id) return "member";
  try {
    const { data } = await (client as any)
      .from("public_profiles")
      .select("display_name, username")
      .eq("id", id)
      .maybeSingle();
    return data?.display_name || data?.username || "member";
  } catch {
    return "member";
  }
}

/** The content as the public sees it, plus its moderation state. */
export async function readContentDetail(kind: ContentDetail["kind"], id: string): Promise<ContentDetail | null> {
  try {
    const client = createClient();
    if (!client) return null;

    if (kind === "clip") {
      const { data } = await (client as any)
        .from("clips")
        .select("id, code, title, user_id, created_at, deleted_at, hidden_at, moderated_at, anilist_id, episode_number, start_seconds, end_seconds")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      return {
        kind,
        id: data.id,
        body: null,
        title: data.title ?? null,
        created_at: data.created_at ?? null,
        author_id: data.user_id ?? null,
        author_name: await profileName(client, data.user_id ?? null),
        status: data.deleted_at ? "removed" : data.hidden_at ? "hidden" : "published",
        reason: null,
        moderated_at: data.moderated_at ?? null,
        is_spoiler: false,
        clip_code: data.code ?? null,
        clip_title: data.title ?? null,
        clip_start: data.start_seconds === null ? null : Number(data.start_seconds),
        clip_end: data.end_seconds === null ? null : Number(data.end_seconds),
        anilist_id: data.anilist_id ?? null,
        episode_number: data.episode_number ?? null,
        post_id: null,
        announcement_id: null,
      };
    }

    const spec = CONTENT_TABLE[kind];
    const { data } = await (client as any)
      .from(spec.table)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;

    const authorId = data[spec.author] ?? null;
    const status: ModerationStatus | "gone" = data.deleted_at
      ? "removed"
      : ((data.status as ModerationStatus) ?? "published");

    return {
      kind,
      id: data.id,
      body: data.body ?? null,
      title: data.title ?? null,
      created_at: data.created_at ?? null,
      author_id: authorId,
      author_name: await profileName(client, authorId),
      status,
      reason: data.removed_reason ?? null,
      moderated_at: data.moderated_at ?? null,
      is_spoiler: Boolean(data.is_spoiler),
      clip_code: null,
      clip_title: null,
      clip_start: null,
      clip_end: null,
      anilist_id: data.anilist_id ?? null,
      episode_number: data.episode_number ?? null,
      post_id: data.post_id ?? null,
      announcement_id: data.announcement_id ?? null,
    };
  } catch {
    return null;
  }
}

/** Reports on one target. A reporter is a member or a guest - never an email. */
export async function readReportsForTarget(kind: string, id: string): Promise<ReportRow[]> {
  try {
    const client = createClient();
    if (!client) return [];
    const { data } = await (client as any)
      .from("community_reports")
      .select("id, reporter_id, reporter_hash, reason, details, status, created_at, resolved_at")
      .eq("target_kind", kind)
      .eq("target_id", id)
      .order("created_at", { ascending: true })
      .limit(100);
    return (data ?? []) as ReportRow[];
  } catch {
    return [];
  }
}

export async function readClipReportsForClip(clipId: string): Promise<ClipReportRow[]> {
  try {
    const client = createClient();
    if (!client) return [];
    const { data } = await (client as any)
      .from("clip_reports")
      .select("id, reporter_hash, reason, details, status, created_at")
      .eq("clip_id", clipId)
      .order("created_at", { ascending: true })
      .limit(100);
    return (data ?? []) as ClipReportRow[];
  } catch {
    return [];
  }
}

/** The author's other recent items, so a pattern is visible in the detail view. */
export async function readAuthorRecent(authorId: string | null): Promise<
  { kind: string; id: string; preview: string; status: string; created_at: string }[]
> {
  if (!authorId) return [];
  try {
    const client = createClient();
    if (!client) return [];
    const [posts, comments] = await Promise.all([
      (client as any)
        .from("community_posts")
        .select("id, body, status, created_at")
        .eq("author_id", authorId)
        .order("created_at", { ascending: false })
        .limit(5),
      (client as any)
        .from("comments")
        .select("id, body, status, created_at")
        .eq("user_id", authorId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    const rows = [
      ...((posts.data ?? []) as any[]).map((row) => ({ kind: "post", ...row })),
      ...((comments.data ?? []) as any[]).map((row) => ({ kind: "comment", ...row })),
    ];
    return rows
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 6)
      .map((row) => ({
        kind: row.kind,
        id: row.id,
        preview: String(row.body ?? "").slice(0, 90),
        status: row.status ?? "published",
        created_at: row.created_at,
      }));
  } catch {
    return [];
  }
}

/**
 * Previous moderation actions on this target.
 *
 * Author-level history comes from readAuthorRecent (each item carries its
 * current status), not from a second log query: the log has no author column,
 * and joining it to every item an author ever wrote is exactly the full scan the
 * rate limits were designed to avoid.
 */
export async function readLogForTarget(kind: string, id: string): Promise<LogRow[]> {
  try {
    const client = createClient();
    if (!client) return [];
    const { data } = await (client as any)
      .from("community_moderation_log")
      .select("id, actor_id, action, target_kind, target_id, reason, created_at")
      .eq("target_kind", kind)
      .eq("target_id", id)
      .order("created_at", { ascending: false })
      .limit(20);
    return ((data ?? []) as LogRow[]).map((row) => ({ ...row, actor_name: null }));
  } catch {
    return [];
  }
}

export async function readActorNames(ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (unique.length === 0) return {};
  try {
    const client = createClient();
    if (!client) return {};
    const { data } = await (client as any)
      .from("public_profiles")
      .select("id, display_name, username")
      .in("id", unique);
    const map: Record<string, string> = {};
    for (const row of (data ?? []) as any[]) {
      map[row.id] = row.display_name || row.username || "member";
    }
    return map;
  } catch {
    return {};
  }
}

/** Only the reasons the database accepts, so a filter can never invent one. */
export const REPORT_REASONS = [
  "spam",
  "harassment",
  "spoiler",
  "inappropriate",
  "copyright",
  "other",
] as const;

export const REASON_LABEL: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  spoiler: "Spoiler",
  inappropriate: "Inappropriate",
  copyright: "Copyright",
  other: "Other",
  broken: "Broken",
};
