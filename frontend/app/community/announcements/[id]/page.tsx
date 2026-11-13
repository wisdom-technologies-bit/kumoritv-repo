// /community/announcements/[id] - announcements are the single source of truth.
//
// Indexable with Open Graph (Q6). An external url is shown as a "Read more"
// button with rel="noopener noreferrer", never as the page's own destination:
// the bell and every link point HERE first.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CommentsSection from "@/app/components/CommentsSection";
import ThreadActions from "@/app/community/components/ThreadActions";
import styles from "@/app/community/page.module.css";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { createClient } from "@/app/lib/supabase/server";
import { MegaphoneIcon } from "@/app/community/components/icons";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Announcement = {
  id: string;
  title: string;
  body: string | null;
  image: string | null;
  url: string | null;
  created_at: string;
  expires_at: string | null;
};

async function loadAnnouncement(id: string): Promise<Announcement | null> {
  try {
    const client = createClient();
    if (!client) return null;
    const { data, error } = await (client as any)
      .from("announcements")
      .select("id, title, body, image, url, created_at, expires_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    const row = data as Announcement | null;
    if (!row) return null;
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;
    return row;
  } catch {
    return null;
  }
}

function descriptionFor(row: Announcement | null): string {
  const text = (row?.body ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text || "An announcement from the KumoriTV team.";
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const enabled = isCommunityEnabled();
  const row = enabled && UUID.test(params.id) ? await loadAnnouncement(params.id) : null;
  const title = row?.title || "Announcement";
  const description = descriptionFor(row);
  const image = row?.image || "/og-image.png";

  return {
    title,
    description,
    alternates: { canonical: `/community/announcements/${params.id}` },
    robots: row ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title,
      description,
      url: `/community/announcements/${params.id}`,
      type: "article",
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function AnnouncementPage({ params }: { params: { id: string } }) {
  if (!isCommunityEnabled()) notFound();
  if (!UUID.test(params.id)) notFound();

  const row = await loadAnnouncement(params.id);
  if (!row) notFound();

  const createdAt = new Date(row.created_at);

  return (
    <div className={styles.page}>
      <div className={styles.thread}>
        <Link href="/community" className={styles.back_link}>
          ← Back to the feed
        </Link>

        <article className={`${styles.thread_card} ${styles.announcement_card}`}>
          <span className={styles.badge}>
            <MegaphoneIcon />
            Announcement
          </span>

          <h1 className={styles.thread_title}>{row.title}</h1>

          <div className={styles.thread_meta}>
            <span className={styles.author_meta}>
              <time dateTime={row.created_at} title={createdAt.toLocaleString()}>
                {createdAt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
              </time>
            </span>
          </div>

          {row.body && <p className={styles.thread_body}>{row.body}</p>}

          {row.image && (
            <div className={styles.announcement_media}>
              <img src={row.image} alt="" />
            </div>
          )}

          {row.url && (
            <div className={styles.announcement_footer}>
              <a
                className={styles.button}
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read more
              </a>
            </div>
          )}

          <ThreadActions kind="announcement" id={row.id} url={`/community/announcements/${row.id}`} />
        </article>

        <div className={styles.comments_wrap}>
          <CommentsSection target={{ kind: "announcement", id: row.id }} />
        </div>
      </div>
    </div>
  );
}
