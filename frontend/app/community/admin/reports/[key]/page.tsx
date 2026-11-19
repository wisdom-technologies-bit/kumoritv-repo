// /community/admin/reports/<kind>-<id> - one reported item, in full.
//
// The content is shown the way the public sees it (spoiler blurred, clip card,
// announcement body), next to its moderation state, every report on it, the
// author's other recent items and the previous actions on this target. Reporters
// appear as "member" or "guest": the identity of a reporter is never shown, and
// a guest is only ever a salted hash, which is not rendered at all.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminTabs from "../../components/AdminTabs";
import ModerationActions from "../../components/ModerationActions";
import styles from "../../admin.module.css";
import {
  REASON_LABEL,
  readActorNames,
  readAuthorRecent,
  readContentDetail,
  readLogForTarget,
  readReportsForTarget,
} from "@/app/lib/community/admin-server";
import { readStaffForPage } from "@/app/lib/community/staff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reported content", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["post", "comment", "announcement", "clip"] as const;

function parseKey(key: string): { kind: (typeof KINDS)[number]; id: string } | null {
  const dash = key.indexOf("-");
  if (dash < 1) return null;
  const kind = key.slice(0, dash);
  const id = key.slice(dash + 1);
  if (!(KINDS as readonly string[]).includes(kind) || !UUID.test(id)) return null;
  return { kind: kind as (typeof KINDS)[number], id };
}

export default async function ReportDetailPage({ params }: { params: { key: string } }) {
  const parsed = parseKey(params.key);
  if (!parsed) notFound();

  const staff = await readStaffForPage();
  const isAdmin = staff?.role === "admin";

  const content = await readContentDetail(parsed.kind, parsed.id);
  if (!content) notFound();

  const [reports, recent, log] = await Promise.all([
    readReportsForTarget(parsed.kind, parsed.id),
    readAuthorRecent(content.author_id),
    readLogForTarget(parsed.kind, parsed.id),
  ]);
  const actors = await readActorNames(log.map((row) => row.actor_id));

  const openReportIds = reports.filter((report) => report.status === "open").map((report) => report.id);
  const status = content.status === "gone" ? "removed" : content.status;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          <Link className={styles.link} href="/community/admin/reports">
            Reports
          </Link>{" "}
          / {parsed.kind}
        </p>
        <h1 className={styles.title}>{content.author_name}</h1>
        <p className={styles.subtitle}>
          {content.created_at ? new Date(content.created_at).toLocaleString("en-GB") : "no timestamp"} ·{" "}
          <span className={styles.badge}>
            {status}
            {content.reason ? `: ${content.reason}` : ""}
          </span>
        </p>
      </header>

      <AdminTabs active="reports" isAdmin={isAdmin} />

      <section className={styles.card} aria-labelledby="content">
        <h2 id="content" className={styles.card_title}>
          The content
        </h2>
        {content.title && <p className={styles.card_title}>{content.title}</p>}
        <p className={styles.body_text} data-spoiler={content.is_spoiler ? "true" : undefined}>
          {content.body || "(no body)"}
        </p>
        {content.is_spoiler && <p className={styles.small}>Spoiler: blurred for readers until they ask.</p>}
        {content.clip_code && (
          <p className={styles.small}>
            Clip{" "}
            <Link className={styles.link} href={`/clip/${content.clip_code}`}>
              {content.clip_title || content.clip_code}
            </Link>{" "}
            {content.clip_start !== null && content.clip_end !== null
              ? `· ${Math.round(content.clip_start)}s to ${Math.round(content.clip_end)}s`
              : null}
          </p>
        )}
        {content.anilist_id !== null && (
          <p className={styles.small}>
            Anime {content.anilist_id}
            {content.episode_number ? ` · episode ${content.episode_number}` : ""}
          </p>
        )}
        <ModerationActions
          kind={parsed.kind}
          id={parsed.id}
          status={status}
          reportIds={openReportIds}
        />
      </section>

      <section className={styles.card} aria-labelledby="reports">
        <h2 id="reports" className={styles.card_title}>
          Reports ({reports.length})
        </h2>
        {reports.length === 0 ? (
          <p className={styles.empty}>No reports on this item.</p>
        ) : (
          <ul className={styles.list}>
            {reports.map((report) => (
              <li key={report.id} className={styles.card_row}>
                <div className={styles.card_row_head}>
                  <span className={styles.badge}>{REASON_LABEL[report.reason] ?? report.reason}</span>
                  <span className={styles.muted}>
                    {report.reporter_id ? "member" : "guest"} ·{" "}
                    <time dateTime={report.created_at}>{new Date(report.created_at).toLocaleString("en-GB")}</time> ·{" "}
                    {report.status}
                  </span>
                </div>
                {report.details && <p className={styles.card_row_meta}>{report.details}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card} aria-labelledby="author">
        <h2 id="author" className={styles.card_title}>
          This author, recently
        </h2>
        {recent.length === 0 ? (
          <p className={styles.empty}>Nothing else from this author.</p>
        ) : (
          <ul className={styles.list}>
            {recent.map((item) => (
              <li key={`${item.kind}:${item.id}`} className={styles.card_row}>
                <div className={styles.card_row_head}>
                  <span className={styles.badge}>{item.kind}</span>
                  <span className={styles.muted}>{item.status}</span>
                </div>
                <p className={styles.card_row_meta}>{item.preview || "(no body)"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card} aria-labelledby="history">
        <h2 id="history" className={styles.card_title}>
          Previous moderation on this item
        </h2>
        {log.length === 0 ? (
          <p className={styles.empty}>No previous actions.</p>
        ) : (
          <ul className={styles.list}>
            {log.map((row) => (
              <li key={row.id} className={styles.card_row}>
                <div className={styles.card_row_head}>
                  <span className={styles.badge}>{row.action}</span>
                  <span className={styles.muted}>
                    {row.actor_id ? (actors[row.actor_id] ?? "staff") : "former staff"} ·{" "}
                    {new Date(row.created_at).toLocaleString("en-GB")}
                  </span>
                </div>
                {row.reason && <p className={styles.card_row_meta}>{row.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
