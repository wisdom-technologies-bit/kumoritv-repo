// Username prefix search for the @-mention picker: GET /api/users/search?q=
//
// The logic lives in app/lib/users/search.ts; this module exports only the
// handler, which is what Next expects from a route file.

import { handleUserSearch } from "@/app/lib/users/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleUserSearch(request);
}
