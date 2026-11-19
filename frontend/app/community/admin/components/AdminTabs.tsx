// The moderation section tabs. Server-rendered links: they work without JS and
// each one is a real URL, so a moderator can bookmark the inbox.
import Link from "next/link";
import styles from "../admin.module.css";

export type TabKey = "overview" | "reports" | "hidden" | "clips" | "log" | "announcements";

const TABS: { key: TabKey; label: string; href: string; adminOnly?: boolean }[] = [
  { key: "overview", label: "Overview", href: "/community/admin" },
  { key: "reports", label: "Reports", href: "/community/admin/reports" },
  { key: "hidden", label: "Hidden / removed", href: "/community/admin/hidden" },
  { key: "clips", label: "Clip reports", href: "/community/admin/clips" },
  { key: "log", label: "Log", href: "/community/admin/log", adminOnly: true },
  { key: "announcements", label: "Announcements", href: "/community/admin/announcements", adminOnly: true },
];

export default function AdminTabs({ active, isAdmin }: { active: TabKey; isAdmin: boolean }) {
  return (
    <nav className={styles.tabs} aria-label="Moderation sections">
      {TABS.filter((tab) => !tab.adminOnly || isAdmin).map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={styles.tab_link}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
