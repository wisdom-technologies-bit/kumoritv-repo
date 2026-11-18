// /community/admin/clips - clip reports (Prompt 35's clip_reports table).
//
// Same grouping and the same decisions as content reports: Remove soft-deletes
// the clip through community_moderate (so it leaves /clips, the community feed
// and its own page, and the action is logged), Restore brings it back.
import type { Metadata } from "next";
import Link from "next/link";
import AdminTabs from "../components/AdminTabs";
import ModerationActions from "../components/ModerationActions";
import styles from "../admin.module.css";
import {
  REASON_LABEL,
  decodeCursor,
  encodeCursor,
  readClipReportGroups,
} from "@/app/lib/community/admin-server";
import { readStaffForPage } from "@/app/lib/community/staff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Clip reports" };

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export default async function ClipReportsPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const params = (await searchParams) ?? {};
  const staff = await readStaffForPage();
  const isAdmin = staff?.role === "admin";

  const status = one(params.status) ?? "open";
  const after = decodeCursor(one(params.after));
  const groups = await readClipReportGroups({ status, limit: 25, after });
  const last = groups[groups.length - 1];
  const next = groups.length === 25 && last
    ? `/community/admin/clips?status=${status}&after=${encodeURIComponent(
      encodeCursor({ count: last.report_count, latest: last.latest_report_at, id: last.clip_id }),
    )}`
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Clip reports</h1>
        <p className={styles.subtitle}>
          Removing a clip soft-deletes it: it disappears from /clips, the community feed and its own page, and the
          action is logged. The owner still sees it in My clips.
        </p>
      </header>

      <AdminTabs active="clips" isAdmin={isAdmin} />

      <form className={styles.filters} method="get" action="/community/admin/clips">
        <label className={styles.field}>
          <span className={styles.field_label}>Status</span>
          <select className={styles.select} name="status" defaultValue={status}>
            <option value="open">Open</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
            <option value="">All</option>
          </select>
        </label>
        <button className={styles.button_primary} type="submit">
          Apply
        </button>
      </form>

      {groups.length === 0 ? (
        <p className={styles.empty}>No clip reports here.</p>
      ) : (
        <ul className={styles.list}>
          {groups.map((group) => (
            <li key={group.clip_id} className={styles.card_row}>
              <div className={styles.card_row_head}>
                {group.code ? (
                  <Link className={styles.link} href={`/clip/${group.code}`}>
                    {group.title || group.code}
                  </Link>
                ) : (
                  <span className={styles.muted}>Deleted clip</span>
                )}
                <span className={styles.badge}>
                  {group.clip_state} · {group.report_count} reports
                </span>
              </div>
              <p className={styles.card_row_meta}>
                {(group.reasons ?? []).map((value) => REASON_LABEL[value] ?? value).join(", ")} · first{" "}
                {new Date(group.first_report_at).toLocaleString("en-GB")}
              </p>
              <ModerationActions
                kind="clip"
                id={group.clip_id}
                status={group.clip_state === "gone" ? "removed" : group.clip_state}
                clipId={group.open_count > 0 ? group.clip_id : undefined}
                reportsCount={Number(group.open_count)}
              />
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
