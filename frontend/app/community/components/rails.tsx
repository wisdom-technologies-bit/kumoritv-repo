// Server-rendered right rail: no client JS, no external API calls that the
// footer does not already make. Two cards, both with a real empty state.
import { Suspense } from "react";
import Link from "next/link";
import styles from "../page.module.css";
import { createClient } from "@/app/lib/supabase/server";
import { formatTimeAgo } from "@/app/lib/comments/timeAgo";
import { readShowAdultContent } from "@/app/lib/anilist/adult-content";
import AiringRail, { AiringRailSkeleton } from "./AiringRail";

type Announcement = { id: string; title: string; created_at: string };

async function LatestAnnouncements() {
  let announcements: Announcement[] = [];
  try {
    const client = createClient();
    if (client) {
      const { data } = await (client as any)
        .from("announcements")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(4);
      announcements = (data ?? []) as Announcement[];
    }
  } catch {
    announcements = [];
  }

  return (
    <section className={styles.rail_card} aria-labelledby="rail-announcements">
      <h2 className={styles.panel_heading} id="rail-announcements">
        Latest announcements
      </h2>
      {announcements.length === 0 ? (
        <p className={styles.rail_empty}>Nothing from the team right now.</p>
      ) : (
        <ul className={styles.rail_list}>
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <Link className={styles.rail_item} href={`/community/announcements/${announcement.id}`}>
                <span className={styles.rail_item_title}>{announcement.title}</span>
                <span className={styles.rail_item_meta}>{formatTimeAgo(announcement.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type AiringRow = { anilist_id: number; episode_number: number; air_date: string; title: string | null };

/** One poster per anime for the next seven days, four of them, from the
 *  /schedule data layer. The data read is cached; the skeleton streams while it
 *  resolves, and the card keeps its place in the rail. */
function AiringThisWeek() {
  return (
    <Suspense fallback={<AiringRailSkeleton />}>
      <AiringThisWeekData />
    </Suspense>
  );
}

async function AiringThisWeekData() {
  // The same switch the rest of the site honours; a guest gets false.
  const showAdult = await readShowAdultContent();
  return <AiringRail showAdult={showAdult} />;
}

export default async function CommunityRails() {
  return (
    <>
      <LatestAnnouncements />
      <AiringThisWeek />
    </>
  );
}
