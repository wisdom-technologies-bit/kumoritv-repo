// /community/admin/reports - the inbox.
//
// One row per content item (not per report), sorted by "most reported, then
// newest report", keyset paginated with the (count, latest, id) cursor the SQL
// function returns. Table at 900 px and up, cards below that - one markup tree,
// styled by the media query in admin.module.css.
import type { Metadata } from "next";
import Link from "next/link";
import AdminTabs from "../components/AdminTabs";
import ModerationActions from "../components/ModerationActions";
import styles from "../admin.module.css";
import {
  REASON_LABEL,
  REPORT_REASONS,
  decodeCursor,
  encodeCursor,
  readReportGroups,
} from "@/app/lib/community/admin-server";
import { readStaffForPage } from "@/app/lib/community/staff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reports" };

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function href(params: Params, after: string | null): string {
  const query = new URLSearchParams();
  for (const key of ["status", "kind", "reason"]) {
    const value = one(params[key]);
    if (value) query.set(key, value);
  }
  if (after) query.set("after", after);
  const search = query.toString();
  return search ? `/community/admin/reports?${search}` : "/community/admin/reports";
}

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const params = (await searchParams) ?? {};
  const staff = await readStaffForPage();
  const isAdmin = staff?.role === "admin";

  const status = one(params.status) ?? "open";
  const kind = one(params.kind);
  const reason = one(params.reason);
  const after = decodeCursor(one(params.after));

  const groups = await readReportGroups({ status, kind, reason, limit: 25, after });
  const last = groups[groups.length - 1];
  const next = groups.length === 25 && last
    ? href(params, encodeCursor({ count: last.report_count, latest: last.latest_report_at, id: last.target_id }))
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Reports</h1>
        <p className={styles.subtitle}>Grouped by content item. A reporter is shown as member or guest, never by name.</p>
      </header>

      <AdminTabs active="reports" isAdmin={isAdmin} />

      <form className={styles.filters} method="get" action="/community/admin/reports">
        <label className={styles.field}>
          <span className={styles.field_label}>Status</span>
          <select className={styles.select} name="status" defaultValue={status}>
            <option value="open">Open</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.field_label}>Kind</span>
          <select className={styles.select} name="kind" defaultValue={kind ?? ""}>
            <option value="">All</option>
            <option value="post">Posts</option>
            <option value="comment">Comments</option>
            <option value="announcement">Announcements</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.field_label}>Reason</span>
          <select className={styles.select} name="reason" defaultValue={reason ?? ""}>
            <option value="">All</option>
            {REPORT_REASONS.map((value) => (
              <option key={value} value={value}>
                {REASON_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.button_primary} type="submit">
          Apply
        </button>
      </form>

      {groups.length === 0 ? (
        <p className={styles.empty}>Nothing here with these filters.</p>
      ) : (
        <div className={styles.table_wrap}>
          <table className={styles.table}>
            <caption className={styles.sr_only}>Reported content, most reported first</caption>
            <thead>
              <tr>
                <th scope="col">Content</th>
                <th scope="col">Reports</th>
                <th scope="col">Reasons</th>
                <th scope="col">First / latest</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={`${group.target_kind}:${group.target_id}`}>
                  <td data-label="Content">
                    <Link className={styles.link} href={`/community/admin/reports/${group.target_kind}-${group.target_id}`}>
                      {group.author_name ?? "member"} · {group.target_kind}
                    </Link>
                    <span className={styles.card_row_meta}>{group.preview || "(no body)"}</span>
                  </td>
                  <td data-label="Reports">
                    {group.report_count}
                    <span className={styles.muted}> ({group.reporter_count} reporters)</span>
                  </td>
                  <td data-label="Reasons">{(group.reasons ?? []).map((value) => REASON_LABEL[value] ?? value).join(", ")}</td>
                  <td data-label="First / latest" className={styles.small}>
                    <time dateTime={group.first_report_at}>{new Date(group.first_report_at).toLocaleString("en-GB")}</time>
                    <br />
                    <time dateTime={group.latest_report_at}>{new Date(group.latest_report_at).toLocaleString("en-GB")}</time>
                  </td>
                  <td data-label="Status">
                    <span className={styles.badge}>{group.target_status ?? "gone"}</span>
                  </td>
                  <td data-label="Actions">
                    <ModerationActions
                      kind={group.target_kind}
                      id={group.target_id}
                      status={group.target_status ?? "gone"}
                      compact
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
