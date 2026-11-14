// Prompt 38E: one filter list, three placements (desktop left nav, tablet
// chips, mobile bar) and one parser, so the chips, the URL and the RPC can
// never disagree about what ?filter=comments means.
import type { FeedFilter } from "./queries";

// `short` is what the phone bar says. Five chips have to fit one 360px row
// without scrolling and without clipping a word, so the two long ones get a
// shorter name there. The button's accessible name stays the full label.
export const FEED_FILTERS: { value: FeedFilter; label: string; short: string }[] = [
  { value: "all", label: "All", short: "All" },
  { value: "post", label: "Posts", short: "Posts" },
  { value: "comment", label: "Comments", short: "Comments" },
  { value: "announcement", label: "Announcements", short: "News" },
  { value: "clips", label: "Clips", short: "Clips" },
];

const VALUES = new Set<string>(FEED_FILTERS.map((filter) => filter.value));

/** Anything unknown is the full feed, never an error page. */
export function readFeedFilter(value: string | string[] | undefined): FeedFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && VALUES.has(raw) ? (raw as FeedFilter) : "all";
}
