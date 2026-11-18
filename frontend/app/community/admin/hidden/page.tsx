// /community/admin/hidden - everything currently hidden or removed.
//
// The queue is the answer to "what did we take down, and why" without opening the
// log: each row carries the state, the reason the author sees and the moderator
// who acted, with Restore in place.
import type { Metadata } from "next";
import Link from "next/link";
import AdminTabs from "../components/AdminTabs";
import ModerationActions from "../components/ModerationActions";
import styles from "../admin.module.css";
import { readActorNames, readModerationQueue } from "@/app/lib/community/admin-server";
import { readStaffForPage } from "@/app/lib/community/staff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Hidden and removed" };

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export default async function HiddenPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const params = (await searchParams) ?? {};
  const staff = await readStaffForPage();
  const isAdmin = staff?.role === "admin";

  const kind = one(params.kind);
  const before = one(params.before) && one(params.beforeId) ? { at: one(params.before)!, id: one(params.beforeId)! } : null;
  const items = await readModerationQueue({ kind, limit: 50, before });
  const actors = await readActorNames(items.map((item) => item.moderated_by));
  const last = items[items.length - 1];
  const next = items.length === 50 && last
    ? `/community/admin/hidden?${new URLSearchParams({
      ...(kind ? { kind } : {}),
      before: last.moderated_at ?? new Date().toISOString(),
      beforeId: last.id,
    }).toString()}`
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Hidden and removed</h1>
        <p className={styles.subtitle}>Newest first. Restoring publishes the item again and writes a log row.</p>
      </header>

      <AdminTabs active="hidden" isAdmin={isAdmin} />

      <form className={styles.filters} method="get" action="/community/admin/hidden">
        <label className={styles.field}>
          <span className={styles.field_label}>Kind</span>
          <select className={styles.select} name="kind" defaultValue={kind ?? ""}>
            <option value="">All</option>
            <option value="post">Posts</option>
            <option value="comment">Comments</option>
            <option value="announcement">Announcements</option>
            <option value="clip">Clips</option>
          </select>
        </label>
        <button className={styles.button_primary} type="submit">
          Apply
        </button>
      </form>

      {items.length === 0 ? (
        <p className={styles.empty}>Nothing is hidden or removed.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className={styles.card_row}>
              <div className={styles.card_row_head}>
                <span className={item.status === "removed" ? styles.badge_removed : styles.badge_hidden}>
                  {item.status} · {item.kind}
                </span>
                <span className={styles.muted}>{item.author_name ?? "member"}</span>
              </div>
              <p className={styles.card_row_meta}>{item.preview || "(no body)"}</p>
              <p className={styles.card_row_meta}>
                {item.reason ? `Reason: ${item.reason} · ` : ""}
                {item.moderated_at
                  ? `${new Date(item.moderated_at).toLocaleString("en-GB")} by ${
                    item.moderated_by ? (actors[item.moderated_by] ?? "staff") : "former staff"
                  }`
                  : "no timestamp"}
                {item.reports > 0 ? ` · ${item.reports} open reports` : ""}
              </p>
              <ModerationActions kind={item.kind} id={item.id} status={item.status} compact />
            </li>
          ))}
        </ul>
      )}

      <nav className={styles.pager} aria-label="Pagination">
        {next ? (
          <Link className={styles.link} href={next} rel="next">
            Next page
          </Link>
        ) : (
          <span className={styles.muted}>End of the list</span>
        )}
      </nav>
    </main>
  );
}
