// "Airing this week", the right-rail card. Reuses the /schedule data layer
// rather than inventing a second one: getAiringSchedule() brings the window from
// AniList (adult filtering included, keyed by the viewer's own setting),
// markOnKumoriTV() stamps which episodes are already playable here, and
// scheduleTitle() follows the viewer's title-language preference.
//
// Popularity: AniList `media.popularity`, because that is the signal the
// schedule payload already carries; averageScore breaks ties, then "On
// KumoriTV", then the earliest airing.
import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import styles from "../page.module.css";
import { getAiringSchedule } from "@/app/lib/anilist/medias.server";
import { markOnKumoriTV } from "@/app/lib/schedule/on-kumori.server";
import { COVER_PLACEHOLDER, scheduleTitle } from "@/app/lib/schedule/format";
import type { ScheduleItem } from "@/app/lib/schedule/types";
import AiringTime from "./AiringTime";

const WEEK_SECONDS = 7 * 86_400;

export type AiringPoster = {
  anilistId: number;
  episode: number;
  airingAt: number;
  title: string;
  cover: string;
  onKumori: boolean;
};

/** One shared read per 10 minutes, so the rail does not hit AniList or the
 *  database on every request. The viewer's adult setting is part of the key
 *  because the schedule fetch is already filtered by it. */
const readAiringThisWeek = unstable_cache(
  async (showAdult: boolean): Promise<AiringPoster[]> => {
    const now = Math.floor(Date.now() / 1000);
    const { items } = await getAiringSchedule({
      from: now,
      to: now + WEEK_SECONDS,
      showAdultContent: showAdult,
    });
    if (!items?.length) return [];

    const marked = await markOnKumoriTV(items);
    const nextEpisode = new Map<number, ScheduleItem>();
    for (const item of marked) {
      const id = Number(item.media?.id);
      if (!Number.isFinite(id)) continue;
      const existing = nextEpisode.get(id);
      // One poster per anime, for the next episode it airs.
      if (!existing || item.airingAt < existing.airingAt) nextEpisode.set(id, item);
    }

    return [...nextEpisode.values()]
      .sort((a, b) => {
        const popularity = (b.media.popularity ?? 0) - (a.media.popularity ?? 0);
        if (popularity !== 0) return popularity;
        const score = (b.media.averageScore ?? 0) - (a.media.averageScore ?? 0);
        if (score !== 0) return score;
        if (a.available !== b.available) return a.available ? -1 : 1;
        return a.airingAt - b.airingAt;
      })
      .slice(0, 4)
      .map((item) => ({
        anilistId: item.media.id,
        episode: item.episode,
        airingAt: item.airingAt,
        title: scheduleTitle(item.media) || `Anime #${item.media.id}`,
        cover:
          item.media.coverImage?.large || item.media.coverImage?.extraLarge || COVER_PLACEHOLDER,
        onKumori: Boolean(item.available),
      }));
  },
  ["community", "airing-rail"],
  { revalidate: 600, tags: ["anilist", "schedule"] },
);

export default async function AiringRail({ showAdult }: { showAdult: boolean }) {
  let rows: AiringPoster[] = [];
  try {
    rows = await readAiringThisWeek(showAdult);
  } catch {
    rows = [];
  }

  return (
    <section className={styles.rail_card} aria-labelledby="rail-airing">
      <h2 className={styles.panel_heading} id="rail-airing">
        Airing this week
      </h2>
      {rows.length === 0 ? (
        <p className={styles.rail_empty}>
          No episodes scheduled in the next seven days. The season list is on the home page.
        </p>
      ) : (
        <ul className={styles.airing_grid}>
          {rows.map((row) => (
            <li key={`${row.anilistId}-${row.episode}`}>
              <Link
                className={styles.airing_item}
                href={`/watch/${row.anilistId}?ep=${row.episode}`}
                data-on-kumori={row.onKumori ? "true" : undefined}
              >
                <span className={styles.airing_cover}>
                  <Image
                    src={row.cover}
                    alt=""
                    width={110}
                    height={165}
                    sizes="(max-width: 899px) 0px, 110px"
                  />
                </span>
                <span className={styles.airing_title}>{row.title}</span>
                <span className={styles.airing_meta}>
                  Ep {row.episode} · <AiringTime airingAt={row.airingAt} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link className={styles.rail_more} href="/schedule">
        Full schedule
      </Link>
    </section>
  );
}

/** The shape of the card while the window is being read. */
export function AiringRailSkeleton() {
  return (
    <section className={styles.rail_card} aria-hidden="true">
      <p className={styles.panel_heading}>Airing this week</p>
      <div className={styles.airing_grid}>
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={styles.airing_skeleton}>
            <span className={styles.airing_skeleton_cover} />
            <span className={styles.airing_skeleton_line} />
            <span className={styles.airing_skeleton_line_short} />
          </span>
        ))}
      </div>
    </section>
  );
}
