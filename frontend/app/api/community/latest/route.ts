// GET /api/community/latest?after=<cursor>&limit=5
//
// Phase 4, part A. The handler lives in app/lib/community/latest-handler.ts so
// its test seam (`handleLatest`) is not an export of a route module; this file
// is only the HTTP wiring and the cache opt-outs.
//
// `dynamic`/`revalidate`/`fetchCache` together make sure a "latest" read is
// never answered from a stored route or fetch entry: with only the CDN headers,
// Next's own fetch cache replayed the first response and the bar stayed empty.
import { handleLatest } from "@/app/lib/community/latest-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request): Promise<Response> {
  return handleLatest(request);
}
