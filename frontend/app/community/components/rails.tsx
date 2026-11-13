// Server-rendered right rail: no client JS, no external API calls that the
// footer does not already make. Two cards, both with a real empty state.
import Link from "next/link";
import styles from "../page.module.css";
import { createClient } from "@/app/lib/supabase/server";
import { formatTimeAgo } from "@/app/lib/comments/timeAgo";

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

async function AiringThisWeek() {
  let rows: AiringRow[] = [];
  try {
    const client = createClient();
    if (client) {
      const today = new Date();
      const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const iso = (date: Date) => date.toISOString().slice(0, 10);

      const { data: episodes } = await (client as any)
        .from("episodes")
        .select("anilist_id, episode_number, air_date")
        .gte("air_date", iso(today))
        .lte("air_date", iso(weekAhead))
        .order("air_date", { ascending: true })
        .limit(12);

      const list = (episodes ?? []) as Array<{ anilist_id: number; episode_number: number; air_date: string }>;
      if (list.length) {
        const { data: anime } = await (client as any)
          .from("anime")
          .select("anilist_id, title, title_english")
          .in("anilist_id", [...new Set(list.map((row) => row.anilist_id))]);

        const titles = new Map<number, string>();
        for (const row of ((anime ?? []) as Array<{ anilist_id: number; title: string; title_english: string | null }>)) {
          // The rail is a shortcut, not a title authority: English first, then
          // whatever the row calls itself.
          titles.set(row.anilist_id, (row.title_english || row.title || "").trim());
        }

        rows = list.map((row) => ({
          ...row,
          title: titles.get(row.anilist_id) ?? null,
        }));
      }
    }
  } catch {
    rows = [];
  }

  return (
    <section className={styles.rail_card} aria-labelledby="rail-airing">
      <h2 className={styles.panel_heading} id="rail-airing">
        Airing this week
      </h2>
      {rows.length === 0 ? (
        <p className={styles.rail_empty}>No episodes scheduled yet. Check the home page for the season list.</p>
      ) : (
        <ul className={styles.rail_list}>
          {rows.slice(0, 6).map((row) => (
            <li key={`${row.anilist_id}-${row.episode_number}`}>
              <Link className={styles.rail_item} href={`/watch/${row.anilist_id}?ep=${row.episode_number}`}>
                <span className={styles.rail_item_title}>{row.title ?? `Anime #${row.anilist_id}`}</span>
                <span className={styles.rail_item_meta}>
                  Episode {row.episode_number} · {new Date(row.air_date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function CommunityRails() {
  return (
    <>
      <LatestAnnouncements />
      <AiringThisWeek />
    </>
  );
}
