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

/** The plural is what people type and what the prompt's examples use
 *  (/community?filter=comments). It means the singular filter, so both work. */
const ALIASES: Record<string, FeedFilter> = { comments: "comment" };

/** Anything unknown is the full feed, never an error page. */
export function readFeedFilter(value: string | string[] | undefined): FeedFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "all";
  if (VALUES.has(raw)) return raw as FeedFilter;
  return ALIASES[raw] ?? "all";
}
