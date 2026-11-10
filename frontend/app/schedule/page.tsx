// Prompt 33 Part B - /schedule, the release schedule.
//
// Server component: it resolves the week from the URL, fetches that window from
// AniList (cached, 5 minutes), stamps "On KumoriTV" from one batched Supabase
// read, and hands RAW timestamps to the client. Day grouping, "today" and the
// countdowns all happen in the browser, in the viewer's own zone.
import type { Metadata } from "next";
import styles from "./schedule.module.css";
import ScheduleView from "./components/ScheduleView";
import { parseIsoDay, resolveScheduleQuery } from "@/app/lib/schedule/window";
import { getAiringSchedule, getPremieringSoon } from "@/app/lib/anilist/medias.server";
import { markOnKumoriTV } from "@/app/lib/schedule/on-kumori.server";
import { scheduleTitle } from "@/app/lib/schedule/format";
import { absoluteUrl } from "@/app/lib/seo/text";
import JsonLd from "@/app/lib/seo/JsonLd";
import { originFromHeaders } from "@/app/lib/siteOrigin";
import { headers } from "next/headers";

export const revalidate = 300;

const PAGE_TITLE = "Anime Release Schedule - Episodes Airing This Week | KumoriTV";
const PAGE_DESCRIPTION =
  "Every anime episode airing this week on one page, in your own time zone, with live countdowns. Watch what is already on KumoriTV or get notified before it drops.";

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

// Query params never create their own page: `?w=`, `?week=` and `?day=` all
// canonicalise to /schedule.
export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/schedule" },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: absoluteUrl("/schedule"),
    siteName: "KumoriTV",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "KumoriTV release schedule" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const dayParam = parseIsoDay(firstValue(searchParams.day));
  const resolved = resolveScheduleQuery(
    {
      week: firstValue(searchParams.week),
      w: firstValue(searchParams.w),
      day: firstValue(searchParams.day),
    },
    nowUnix,
  );

  const [schedule, premiering] = await Promise.all([
    getAiringSchedule({ from: resolved.window.fromUnix, to: resolved.window.toUnix }),
    getPremieringSoon({ limit: 8 }),
  ]);

  const items = schedule.items.length ? await markOnKumoriTV(schedule.items) : [];
  const siteUrl = originFromHeaders(headers(), absoluteUrl("/"));

  // The ten episodes about to air, for the ItemList. Server-side ordering only:
  // this is structured data, not the visible grouping.
  const nextTen = [...items]
    .filter((item) => item.airingAt >= nowUnix)
    .sort((a, b) => a.airingAt - b.airingAt)
    .slice(0, 10);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ItemList",
        name: "Anime episodes airing this week",
        numberOfItems: nextTen.length,
        itemListElement: nextTen.map((item, index) => {
          const title = scheduleTitle(item.media);
          return {
            "@type": "ListItem",
            position: index + 1,
            item: {
              "@type": "TVEpisode",
              name: `${title} - Episode ${item.episode}`,
              episodeNumber: item.episode,
              partOfSeries: {
                "@type": "TVSeries",
                name: title,
                url: absoluteUrl(`/media/${item.media.id}`),
              },
              url: absoluteUrl(`/media/${item.media.id}`),
              datePublished: new Date(item.airingAt * 1000).toISOString(),
            },
          };
        }),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "Release Schedule", item: absoluteUrl("/schedule") },
        ],
      },
    ],
  };

  return (
    <main className={styles.page}>
      <JsonLd data={jsonLd} />
      <ScheduleView
        weekStart={resolved.weekStart}
        days={resolved.days}
        initialDay={resolved.selectedDay}
        dayFromUrl={!!dayParam}
        offset={resolved.offset}
        hasPrev={resolved.hasPrev}
        hasNext={resolved.hasNext}
        items={items}
        premiering={premiering.items}
        ok={schedule.ok}
        stale={schedule.stale}
        error={schedule.error}
        nowUnix={nowUnix}
        siteUrl={siteUrl}
      />
    </main>
  );
}
