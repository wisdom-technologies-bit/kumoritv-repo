// /community/announcements - Phase 4, part B4.
//
// The index the announcement detail page never had: live announcements, newest
// first, a card each (megaphone, title, date, two-line plain-text excerpt) and a
// keyset "Load more". Indexable with a canonical URL; the admin-only "Write
// announcement" link is decided on the server and never reaches a non-admin.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "./page.module.css";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { readCommunityAdmin } from "@/app/lib/community/admin";
import { createClient } from "@/app/lib/supabase/server";
import { plainSnippet } from "@/app/lib/community/latest";
import { ANNOUNCEMENT_EXCERPT_MAX } from "@/app/lib/community/announcement-form";
import AnnouncementList, { type AnnouncementListItem } from "./AnnouncementList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const DESCRIPTION =
  "Announcements from the KumoriTV team: service updates, new features and what changed.";

export async function generateMetadata(): Promise<Metadata> {
  const enabled = isCommunityEnabled();
  return {
    title: "Announcements",
    description: DESCRIPTION,
    alternates: { canonical: "/community/announcements" },
    robots: enabled ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: "KumoriTV announcements",
      description: DESCRIPTION,
      url: "/community/announcements",
    },
  };
}

type Row = {
  id: string;
  title: string;
  body: string | null;
  image: string | null;
  created_at: string;
};

type IndexClient = {
  from: (table: "announcements") => {
    select: (columns: string) => {
      or: (filter: string) => {
        order: (column: string, options: { ascending: boolean }) => {
          limit: (count: number) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
};

/** The first page, read on the server so the index is real HTML. */
async function loadFirstPage(): Promise<{ items: AnnouncementListItem[]; nextBefore: string | null }> {
  try {
    const client = createClient() as unknown as IndexClient | null;
    if (!client) return { items: [], nextBefore: null };

    const { data, error } = await client
      .from("announcements")
      .select("id, title, body, image, created_at")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (error) {
      console.error("[community] announcements index failed", error);
      return { items: [], nextBefore: null };
    }

    const rows = ((data ?? []) as Row[]).filter((row) => row && row.id);
    const page = rows.slice(0, PAGE_SIZE);
    const items: AnnouncementListItem[] = page.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      excerpt: plainSnippet(row.body, ANNOUNCEMENT_EXCERPT_MAX),
      image: row.image,
      createdAt: row.created_at,
    }));

    return {
      items,
      // One extra row proved there is more; the cursor is the last row shown.
      nextBefore: rows.length > PAGE_SIZE ? page[page.length - 1]?.created_at ?? null : null,
    };
  } catch (error) {
    console.error("[community] announcements index threw", error);
    return { items: [], nextBefore: null };
  }
}

export default async function AnnouncementsIndexPage() {
  if (!isCommunityEnabled()) notFound();

  const { items, nextBefore } = await loadFirstPage();
  // Server-side: a non-admin's HTML never contains the composer link.
  const admin = await readCommunityAdmin();

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>KumoriTV</p>
            <h1 className={styles.title}>Announcements</h1>
            <p className={styles.subtitle}>
              Service updates, new features and everything the team wants you to know.
            </p>
          </div>
          {admin ? (
            <Link
              className={styles.write_button}
              href="/community/admin/announcements"
              data-testid="write-announcement"
            >
              Write announcement
            </Link>
          ) : null}
        </header>

        {items.length === 0 ? (
          <div className={styles.empty} data-testid="announcements-empty">
            <p className={styles.empty_title}>No announcements right now</p>
            <p className={styles.empty_text}>When the team has something to say, it lands here first.</p>
          </div>
        ) : (
          <AnnouncementList initialItems={items} initialNextBefore={nextBefore} />
        )}
      </div>
    </div>
  );
}
