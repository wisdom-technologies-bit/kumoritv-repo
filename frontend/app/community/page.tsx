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
import { FEED_PAGE_SIZE, type FeedItem } from "@/app/lib/community/queries";
import { createClient } from "@/app/lib/supabase/server";

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

export default async function CommunityPage() {
  if (!isCommunityEnabled()) notFound();

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
        p_kind: "all",
        p_show_adult: false,
        p_author: null,
        p_anilist_id: null,
        p_hide_blocked: true,
      });
      if (error) {
        initialFailed = true;
      } else {
        initialItems = ((data ?? []) as FeedItem[]).filter(
          (row) => row && (row.kind === "post" || row.kind === "announcement"),
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
      initialItems={initialItems}
      initialCursor={initialCursor}
      initialFailed={initialFailed}
      rightRail={<CommunityRails />}
    />
  );
}
