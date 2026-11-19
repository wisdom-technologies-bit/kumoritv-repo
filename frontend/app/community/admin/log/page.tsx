// The Supabase client here is untyped (the project has no generated types for
// the tables this staff-only page reads): every query is cast through the
// builder and its rows are narrowed to LogRow / the small shapes below.
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Supabase builder in a staff-only page */
// /community/admin/log - the moderation trail, admins only, read-only.
//
// The log is append-only: no browser role has INSERT/UPDATE/DELETE on
// community_moderation_log (community.sql revokes them) and the only writer is
// public.community_moderate(), which runs as its definer. This page reads it
// through the admin's own session, where the "community moderation log read"
// policy allows staff; there is no service role here.
//
// Pagination is keyset on (created_at desc, id desc) - never OFFSET, so a row
// written while an admin is paging cannot make them see one twice or skip one.
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../admin.module.css";
import {
  MODERATION_ACTION_LABELS,
  MODERATION_KIND_LABELS,
  type ModerationAction,
  type ModerationKind,
} from "@/app/lib/community/moderation";
import { readAdminForPage } from "@/app/lib/community/staff";
import { createClient } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

type LogRow = {
  id: number;
  created_at: string;
  actor_id: string | null;
  action: string;
  target_kind: string;
  target_id: string;
  reason: string | null;
};

type Actor = { id: string; username: string | null; display_name: string | null };

function one(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function actorLabel(actor: Actor | undefined, actorId: string | null): string {
  if (!actorId) return "a deleted account";
  if (!actor) return "unknown account";
  return actor.display_name || actor.username || "unknown account";
}

/** True when a target row still exists and is worth linking to. */
function commentPath(row: {
  target_type?: string | null;
  post_id?: string | null;
  announcement_id?: string | null;
  anilist_id?: number | null;
  episode_number?: number | null;
  id: string;
}): string | null {
  if (row.target_type === "post" && row.post_id) {
    return `/community/post/${row.post_id}#comment-${row.id}`;
  }
  if (row.target_type === "announcement" && row.announcement_id) {
    return `/community/announcements/${row.announcement_id}#comment-${row.id}`;
  }
  if (!row.anilist_id) return null;
  return row.episode_number
    ? `/watch/${row.anilist_id}?ep=${row.episode_number}#comment-${row.id}`
    : `/media/${row.anilist_id}#comment-${row.id}`;
}

export default async function ModerationLogPage({ searchParams }: { searchParams?: SearchParams }) {
  const staff = await readAdminForPage();
  if (!staff) notFound();

  const params = searchParams ?? {};
  const actorFilter = one(params.actor);
  const kindFilter = one(params.kind);
  const actionFilter = one(params.action);
  const from = one(params.from);
  const to = one(params.to);
  const targetFilter = one(params.target);
  const before = one(params.before);
  const beforeId = one(params.beforeId);

  const client = createClient();
  if (!client) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Moderation is unavailable right now.</p>
      </div>
    );
  }

  let rows: LogRow[] = [];
  let failed = false;

  // The actor box takes either a staff user id or a name fragment.
  let actorIds: string[] | null = null;
  if (actorFilter) {
    if (UUID.test(actorFilter)) {
      actorIds = [actorFilter];
    } else {
      const { data } = await (client as any)
        .from("public_profiles")
        .select("id")
        .or(`username.ilike.%${actorFilter}%,display_name.ilike.%${actorFilter}%`)
        .limit(50);
      actorIds = ((data ?? []) as { id: string }[]).map((row) => row.id);
      if (actorIds.length === 0) actorIds = ["00000000-0000-0000-0000-000000000000"];
    }
  }

  let query = (client as any)
    .from("community_moderation_log")
    .select("id, created_at, actor_id, action, target_kind, target_id, reason");

  if (actorIds) query = query.in("actor_id", actorIds);
  if (kindFilter) query = query.eq("target_kind", kindFilter);
  if (actionFilter) query = query.eq("action", actionFilter);
  if (UUID.test(from) || /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    query = query.gte("created_at", new Date(`${from}T00:00:00.000Z`).toISOString());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    query = query.lte("created_at", new Date(`${to}T23:59:59.999Z`).toISOString());
  }
  if (UUID.test(targetFilter)) query = query.eq("target_id", targetFilter);
  if (before && beforeId) {
    query = query.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) failed = true;
  else rows = (data ?? []) as LogRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === PAGE_SIZE && last ? { before: last.created_at, beforeId: String(last.id) } : null;

  // Who acted.
  const actorIdsToLoad = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => !!id))];
  let actors: Actor[] = [];
  if (actorIdsToLoad.length) {
    const { data: actorRows } = await (client as any)
      .from("public_profiles")
      .select("id, username, display_name")
      .in("id", actorIdsToLoad);
    actors = (actorRows ?? []) as Actor[];
  }
  const actorMap = new Map(actors.map((actor) => [actor.id, actor]));

  // Does the target still exist, and where does it live?
  const byKind = new Map<string, string[]>();
  for (const row of rows) {
    const list = byKind.get(row.target_kind) ?? [];
    list.push(row.target_id);
    byKind.set(row.target_kind, list);
  }

  const linkMap = new Map<string, string>();
  const key = (kind: string, id: string) => `${kind}:${id}`;

  async function loadTable(table: string, ids: string[] | undefined, columns: string) {
    if (!ids?.length) return [] as Record<string, any>[];
    const { data: found } = await (client as any).from(table).select(columns).in("id", ids);
    return (found ?? []) as Record<string, any>[];
  }

  const [postRows, commentRows, announcementRows, clipRows] = await Promise.all([
    loadTable("community_posts", byKind.get("post"), "id"),
    loadTable("comment_feed", byKind.get("comment"), "id, target_type, post_id, announcement_id, anilist_id, episode_number"),
    loadTable("announcements", byKind.get("announcement"), "id"),
    loadTable("clips", byKind.get("clip"), "id, code"),
  ]);

  for (const row of postRows) linkMap.set(key("post", row.id), `/community/post/${row.id}`);
  for (const row of announcementRows) {
    linkMap.set(key("announcement", row.id), `/community/announcements/${row.id}`);
  }
  for (const row of commentRows) {
    const path = commentPath(row as any);
    if (path) linkMap.set(key("comment", row.id), path);
  }
  for (const row of clipRows) {
    if (row.code) linkMap.set(key("clip", row.id), `/clip/${row.code}`);
  }

  const kindLabel = (value: string) => MODERATION_KIND_LABELS[value as ModerationKind] ?? value;
  const actionLabel = (value: string) => MODERATION_ACTION_LABELS[value as ModerationAction] ?? value;

  const filterQuery = (extra?: Record<string, string>) => {
    const search = new URLSearchParams();
    if (actorFilter) search.set("actor", actorFilter);
    if (kindFilter) search.set("kind", kindFilter);
    if (actionFilter) search.set("action", actionFilter);
    if (from) search.set("from", from);
    if (to) search.set("to", to);
    if (targetFilter) search.set("target", targetFilter);
    for (const [name, value] of Object.entries(extra ?? {})) search.set(name, value);
    const text = search.toString();
    return `/community/admin/log${text ? `?${text}` : ""}`;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>KumoriTV Community</p>
          <h1 className={styles.title}>Moderation log</h1>
          <p className={styles.subtitle}>
            Every hide, unhide, removal and restore, newest first. Append-only: nothing on this page can be edited or
            deleted.
          </p>
        </div>
        <span className={styles.staff_badge}>{staff.role === "admin" ? "Admin" : "Moderator"}</span>
      </header>

      <form className={styles.filters} method="get" action="/community/admin/log" role="search">
        <div className={styles.field}>
          <label className={styles.field_label} htmlFor="log-actor">
            Actor
          </label>
          <input
            id="log-actor"
            className={styles.input}
            type="text"
            name="actor"
            defaultValue={actorFilter}
            placeholder="Name or user id"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.field_label} htmlFor="log-kind">
            Kind
          </label>
          <select id="log-kind" className={styles.select} name="kind" defaultValue={kindFilter}>
            <option value="">Any</option>
            <option value="post">Post</option>
            <option value="comment">Comment</option>
            <option value="announcement">Announcement</option>
            <option value="clip">Clip</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.field_label} htmlFor="log-action">
            Action
          </label>
          <select id="log-action" className={styles.select} name="action" defaultValue={actionFilter}>
            <option value="">Any</option>
            <option value="hide">Hide</option>
            <option value="unhide">Unhide</option>
            <option value="remove">Remove</option>
            <option value="restore">Restore</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.field_label} htmlFor="log-from">
            From
          </label>
          <input id="log-from" className={styles.input} type="date" name="from" defaultValue={from} />
        </div>
        <div className={styles.field}>
          <label className={styles.field_label} htmlFor="log-to">
            To
          </label>
          <input id="log-to" className={styles.input} type="date" name="to" defaultValue={to} />
        </div>
        <div className={styles.field}>
          <label className={styles.field_label} htmlFor="log-target">
            Target id
          </label>
          <input
            id="log-target"
            className={styles.input}
            type="text"
            name="target"
            defaultValue={targetFilter}
            placeholder="UUID"
          />
        </div>
        <button className={styles.button} type="submit">
          Filter
        </button>
        <Link className={styles.button} href="/community/admin/log">
          Reset
        </Link>
      </form>

      {failed && (
        <p className={styles.error} role="alert">
          The log could not be read. Try again in a moment.
        </p>
      )}

      {!failed && rows.length === 0 && <p className={styles.empty}>Nothing matches that filter.</p>}

      {rows.length > 0 && (
        <div className={styles.card}>
          <div className={styles.table_wrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const href = linkMap.get(key(row.target_kind, row.target_id));
                  return (
                    <tr key={row.id}>
                      <td>
                        <time dateTime={row.created_at}>
                          {new Date(row.created_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </time>
                      </td>
                      <td>{actorLabel(actorMap.get(row.actor_id ?? ""), row.actor_id)}</td>
                      <td>{actionLabel(row.action)}</td>
                      <td>
                        {href ? (
                          <Link className={styles.link} href={href}>
                            {kindLabel(row.target_kind)}
                          </Link>
                        ) : (
                          <span className={styles.muted}>{kindLabel(row.target_kind)} (gone)</span>
                        )}
                      </td>
                      <td>{row.reason ? row.reason : <span className={styles.muted}>-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className={styles.cards}>
            {rows.map((row) => {
              const href = linkMap.get(key(row.target_kind, row.target_id));
              return (
                <li key={row.id} className={styles.card_row}>
                  <div className={styles.card_row_head}>
                    <strong>{actionLabel(row.action)}</strong>
                    {href ? (
                      <Link className={styles.link} href={href}>
                        {kindLabel(row.target_kind)}
                      </Link>
                    ) : (
                      <span className={styles.muted}>{kindLabel(row.target_kind)} (gone)</span>
                    )}
                  </div>
                  <p className={styles.card_row_meta}>
                    <span>{actorLabel(actorMap.get(row.actor_id ?? ""), row.actor_id)}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
                  </p>
                  {row.reason && <p className={styles.small}>{row.reason}</p>}
                </li>
              );
            })}
          </ul>

          <div className={styles.pager}>
            <span className={styles.muted}>{rows.length} shown</span>
            {nextCursor ? (
              <Link
                className={styles.button}
                href={filterQuery({ before: nextCursor.before, beforeId: nextCursor.beforeId })}
              >
                Older
              </Link>
            ) : (
              <span className={styles.muted}>End of the log</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
