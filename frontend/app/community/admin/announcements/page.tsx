// /community/admin/announcements - Phase 4, part B2.
//
// Not a page anyone can find: no public link, `noindex`, and `notFound()` for
// every visitor who is not an admin. The check is the server's (session +
// is_admin() over staff_roles), never the client's.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { readCommunityAdmin } from "@/app/lib/community/admin";
import { createClient } from "@/app/lib/supabase/server";
import Composer, { type AdminAnnouncement } from "./Composer";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Write an announcement",
  robots: { index: false, follow: false, nocache: true },
};

type Row = {
  id: string;
  title: string;
  body: string | null;
  image: string | null;
  url: string | null;
  created_at: string;
  expires_at: string | null;
  push_sent_at: string | null;
};

async function loadRecent(): Promise<AdminAnnouncement[]> {
  try {
    const client = createClient() as unknown as {
      from: (table: "announcements") => {
        select: (columns: string) => {
          order: (column: string, options: { ascending: boolean }) => {
            limit: (count: number) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    } | null;
    if (!client) return [];

    const { data, error } = await client
      .from("announcements")
      .select("id, title, body, image, url, created_at, expires_at, push_sent_at")
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      console.error("[community] admin announcements list failed", error);
      return [];
    }

    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body ?? "",
      image: row.image,
      url: row.url,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      pushed: Boolean(row.push_sent_at),
    }));
  } catch (error) {
    console.error("[community] admin announcements list threw", error);
    return [];
  }
}

export default async function AdminAnnouncementsPage() {
  if (!isCommunityEnabled()) notFound();
  const admin = await readCommunityAdmin();
  if (!admin) notFound();

  const recent = await loadRecent();

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Admin</p>
          <h1 className={styles.title}>Write an announcement</h1>
          <p className={styles.subtitle}>
            Markdown, published to /community/announcements and the bell. Publish is confirmed first.
          </p>
        </header>

        <Composer initialRows={recent} />
      </div>
    </div>
  );
}
