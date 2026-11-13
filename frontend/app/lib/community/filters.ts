// Prompt 38E: one filter list, three placements (desktop left nav, tablet
// chips, mobile bar) and one parser, so the chips, the URL and the RPC can
// never disagree about what ?filter=comments means.
import type { FeedFilter } from "./queries";

export const FEED_FILTERS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "post", label: "Posts" },
  { value: "comment", label: "Comments" },
  { value: "announcement", label: "Announcements" },
];

const VALUES = new Set<string>(FEED_FILTERS.map((filter) => filter.value));

/** Anything unknown is the full feed, never an error page. */
export function readFeedFilter(value: string | string[] | undefined): FeedFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && VALUES.has(raw) ? (raw as FeedFilter) : "all";
}
