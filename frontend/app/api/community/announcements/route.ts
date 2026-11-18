// GET /api/community/announcements?before=<iso>&limit=10
//
// The public list behind the index page's "Load more". Keyset on created_at
// (never OFFSET): a new announcement arriving between two clicks cannot make the
// reader see a row twice. Only live rows: not expired, exactly like the read
// policy and the feed's announcement arm.
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { createClient } from "@/app/lib/supabase/server";
import { plainSnippet } from "@/app/lib/community/latest";
import { ANNOUNCEMENT_EXCERPT_MAX } from "@/app/lib/community/announcement-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const MAX_LIMIT = 20;

export type PublicAnnouncement = {
  id: string;
  title: string;
  /** The Markdown source: the card renders it with the preview variant. */
  body?: string | null;
  excerpt: string;
  image: string | null;
  createdAt: string;
};

type AnnouncementsQuery = {
  or: (filter: string) => AnnouncementsQuery;
  lt: (column: string, value: string) => AnnouncementsQuery;
  order: (column: string, options: { ascending: boolean }) => AnnouncementsQuery;
  limit: (count: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
};
type AnnouncementsClient = {
  from: (table: "announcements") => { select: (columns: string) => AnnouncementsQuery };
};

type Row = {
  id: string;
  title: string;
  body: string | null;
  image: string | null;
  created_at: string;
};

export async function GET(request: Request): Promise<Response> {
  if (!isCommunityEnabled()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const beforeRaw = url.searchParams.get("before");
  let before: string | null = null;
  if (beforeRaw) {
    const parsed = Date.parse(beforeRaw);
    if (!Number.isFinite(parsed)) {
      return Response.json({ error: "bad_cursor", message: "`before` must be an ISO timestamp." }, { status: 400 });
    }
    before = new Date(parsed).toISOString();
  }

  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT) : PAGE_SIZE;

  const client = createClient() as unknown as AnnouncementsClient | null;
  if (!client) {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const select = client.from("announcements").select("id, title, body, image, created_at");
  const live = select.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  const paged = before ? live.lt("created_at", before) : live;
  const { data, error } = await paged.order("created_at", { ascending: false }).limit(limit + 1);

  if (error) {
    console.error("[community] announcements page failed", error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const rows = ((data ?? []) as Row[]).filter((row) => row && row.id);
  const page = rows.slice(0, limit);
  const items: PublicAnnouncement[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    // Part B: the card renders the source through the preview variant. Bodies
    // are public announcement text, so this exposes nothing new.
    body: row.body,
    excerpt: plainSnippet(row.body, ANNOUNCEMENT_EXCERPT_MAX),
    image: row.image,
    createdAt: row.created_at,
  }));

  return Response.json(
    {
      items,
      // The next cursor only exists while there is something after the page.
      nextBefore: rows.length > limit ? page[page.length - 1]?.created_at ?? null : null,
    },
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
