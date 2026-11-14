// /community - Phase 1.
//
// A server component so the first page of the feed and the right rail are in
// the HTML (crawlers see real posts), with FeedbackShell taking over for the
// filters, pagination and reactions. The flag is read per request.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FeedShell from "./components/FeedShell";
import CommunityRails from "./components/rails";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { readFeedFilter } from "@/app/lib/community/filters";
import { FEED_PAGE_SIZE, type FeedItem } from "@/app/lib/community/queries";
import { createClient } from "@/app/lib/supabase/server";
import { readShowAdultContent } from "@/app/lib/anilist/adult-content";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "The KumoriTV community: what everyone is watching, spoiler-tagged moments, and announcements from the team.";

export async function generateMetadata(): Promise<Metadata> {
  const enabled = isCommunityEnabled();
  return {
    title: "Community",
    description: DESCRIPTION,
    alternates: { canonical: "/community" },
    // Q6: the index is indexable; the post pages are not (see post/[id]).
    robots: enabled ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: "KumoriTV Community", description: DESCRIPTION, url: "/community" },
  };
}

export default async function CommunityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isCommunityEnabled()) notFound();
  const params = (await searchParams) ?? {};
  const initialFilter = readFeedFilter(params.filter);
  // ?anime=<anilistId> is the single-title view the rail and the cards link to.
  const animeParam = Number(Array.isArray(params.anime) ? params.anime[0] : params.anime);
  const initialAnimeId = Number.isFinite(animeParam) && animeParam > 0 ? animeParam : null;
  // The same switch the site already honours. Guests get false.
  const initialShowAdult = await readShowAdultContent();

  let initialItems: FeedItem[] = [];
  let initialCursor: { createdAt: string; key: string } | null = null;
  let initialFailed = false;

  try {
    const client = createClient();
    if (client) {
      const { data, error } = await (client as any).rpc("community_feed_page", {
        p_limit: FEED_PAGE_SIZE,
        p_cursor_created_at: null,
        p_cursor_key: null,
        p_kind: initialFilter,
        p_show_adult: initialShowAdult,
        p_author: null,
        p_anilist_id: initialAnimeId,
        p_hide_blocked: true,
      });
      if (error) {
        initialFailed = true;
      } else {
        initialItems = ((data ?? []) as FeedItem[]).filter(
          (row) => row && (row.kind === "post" || row.kind === "announcement" || row.kind === "comment"),
        );
        const last = initialItems[initialItems.length - 1];
        initialCursor = last ? { createdAt: last.created_at, key: last.feed_key } : null;
      }
    }
  } catch {
    initialFailed = true;
  }

  return (
    <FeedShell
      initialFilter={initialFilter}
      initialItems={initialItems}
      initialCursor={initialCursor}
      initialFailed={initialFailed}
      initialShowAdult={initialShowAdult}
      initialAnimeId={initialAnimeId}
      rightRail={<CommunityRails />}
    />
  );
}
