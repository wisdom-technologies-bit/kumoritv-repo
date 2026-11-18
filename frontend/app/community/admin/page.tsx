// /community/admin - the dashboard.
//
// Counters first (what needs attention today), then the newest report groups and
// the most recently moderated items. Everything is server-rendered on the staff
// member's own session; the layout has already refused anyone who is not staff.
import type { Metadata } from "next";
import Link from "next/link";
import AdminTabs from "./components/AdminTabs";
import ModerationActions from "./components/ModerationActions";
import styles from "./admin.module.css";
import { REASON_LABEL, readModerationQueue, readModerationStats, readReportGroups } from "@/app/lib/community/admin-server";
import { readStaffForPage } from "@/app/lib/community/staff";
import { readRuleHits } from "@/app/lib/community/rate-limit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moderation" };

export default async function AdminDashboard() {
  const staff = await readStaffForPage();
  const isAdmin = staff?.role === "admin";

  const [stats, groups, queue] = await Promise.all([
    readModerationStats(),
    readReportGroups({ status: "open", limit: 5 }),
    readModerationQueue({ limit: 5 }),
  ]);

  // Part D: refusals this process made. Per instance, and it says so - the
  // durable numbers are in the database, these are a smoke signal.
  const ruleHits = readRuleHits().slice(0, 6);

  const counters = [
    { label: "Open reports", value: stats?.open_reports ?? 0, href: "/community/admin/reports" },
    { label: "Open longer than 24 h", value: stats?.stale_reports ?? 0, href: "/community/admin/reports" },
    { label: "Actions in the last 7 days", value: stats?.actions_7d ?? 0, href: "/community/admin/log" },
    { label: "Hidden items", value: stats?.hidden_items ?? 0, href: "/community/admin/hidden" },
    { label: "Removed items", value: stats?.removed_items ?? 0, href: "/community/admin/hidden" },
    { label: "Open clip reports", value: stats?.open_clip_reports ?? 0, href: "/community/admin/clips" },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>KumoriTV</p>
        <h1 className={styles.title}>Moderation</h1>
        <p className={styles.subtitle}>
          Signed in as a {isAdmin ? "admin" : "moderator"}. Reports are grouped by content item; the oldest and most
          reported come first.
        </p>
      </header>

      <AdminTabs active="overview" isAdmin={isAdmin} />

      <section className={styles.counters} aria-label="Moderation counters">
        {counters.map((counter) => (
          <Link key={counter.label} href={counter.href} className={styles.counter}>
            <span className={styles.counter_value}>{counter.value}</span>
            <span className={styles.counter_label}>{counter.label}</span>
          </Link>
        ))}
      </section>

      <section className={styles.card} aria-labelledby="rule-hits">
        <h2 id="rule-hits" className={styles.card_title}>
          Refusals on this instance
        </h2>
        {ruleHits.length === 0 ? (
          <p className={styles.empty}>No write was refused here since the last deploy.</p>
        ) : (
          <ul className={styles.list}>
            {ruleHits.map((hit) => (
              <li key={hit.rule} className={styles.card_row}>
                <div className={styles.card_row_head}>
                  <span className={styles.badge}>{hit.rule}</span>
                  <span className={styles.muted}>{hit.count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.small}>
          Counted in memory per server instance, so this resets on deploy and does not include other instances. The
          limits themselves are enforced in the database.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="attention">
        <h2 id="attention" className={styles.card_title}>
          Needs attention
        </h2>
        {groups.length === 0 ? (
          <p className={styles.empty}>No open reports. Nice.</p>
        ) : (
          <ul className={styles.list}>
            {groups.map((group) => (
              <li key={`${group.target_kind}:${group.target_id}`} className={styles.card_row}>
                <div className={styles.card_row_head}>
                  <Link
                    className={styles.link}
                    href={`/community/admin/reports/${group.target_kind}-${group.target_id}`}
                  >
                    {group.author_name ?? "member"} · {group.target_kind}
                  </Link>
                  <span className={styles.badge}>{group.report_count} reports</span>
                </div>
                <p className={styles.card_row_meta}>{group.preview || "(no body)"}</p>
                <p className={styles.card_row_meta}>
                  {(group.reasons ?? []).map((reason) => REASON_LABEL[reason] ?? reason).join(", ")} ·{" "}
                  {group.reporter_count} reporter{group.reporter_count === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Link className={styles.link} href="/community/admin/reports">
          Open the report inbox
        </Link>
      </section>

      <section className={styles.card} aria-labelledby="recent-actions">
        <h2 id="recent-actions" className={styles.card_title}>
          Recently moderated
        </h2>
        {queue.length === 0 ? (
          <p className={styles.empty}>Nothing is hidden or removed.</p>
        ) : (
          <ul className={styles.list}>
            {queue.map((item) => (
              <li key={`${item.kind}:${item.id}`} className={styles.card_row}>
                <div className={styles.card_row_head}>
                  <span className={styles.badge_hidden}>
                    {item.status === "removed" ? "Removed" : "Hidden"} · {item.kind}
                  </span>
                  <span className={styles.muted}>{item.author_name ?? "member"}</span>
                </div>
                <p className={styles.card_row_meta}>{item.preview || "(no body)"}</p>
                <ModerationActions kind={item.kind} id={item.id} status={item.status} compact />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
