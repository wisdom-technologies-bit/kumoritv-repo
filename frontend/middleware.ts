import axios from "axios";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Prompt 38B: the community is switched off at the edge, before any rendering.
//
// The in-page guard stays (defence in depth), but a `notFound()` thrown while
// the layout is already streaming answers 200 with the 404 page inside. A
// rewrite to an unmatched path renders app/not-found.tsx with a real 404.
//
// `process.env[...]` (not `.COMMUNITY_ENABLED`) on purpose: a static member
// expression is inlined at build time, and this flag has to be read per request.
const COMMUNITY_FLAG = "COMMUNITY_ENABLED";
function communityEnabled(): boolean {
  const raw = String(process.env[COMMUNITY_FLAG] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isCommunityApi = pathname === "/api/community" || pathname.startsWith("/api/community/");
  const isCommunityPage = pathname === "/community" || pathname.startsWith("/community/");

  const detail = UUID_IN_PATH.exec(pathname);
  if (detail && communityEnabled() && !(await communityRowExists(detail[1], detail[2]))) {
    return NextResponse.rewrite(new URL("/community-off", request.url));
  }

  if ((isCommunityApi || isCommunityPage) && !communityEnabled()) {
    if (isCommunityApi) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.rewrite(new URL("/community-off", request.url));
  }


  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => { response.cookies.set(name, value, options); }) } });
    await supabase.auth.getUser();
  }
  if (request.nextUrl.hash) {
    const hash = request.nextUrl.hash;
    const accessToken = hash.match(/access_token=([^&]+)/)?.[1];
    const tokenType = hash.match(/token_type=([^&]+)/)?.[1];
    const expiresIn = hash.match(/expires_in=([^&]+)/)?.[1];
    if (accessToken) void axios.post(`${process.env.NEXT_PUBLIC_WEBSITE_ORIGIN_URL || ""}/api/anilist`, { accessToken, tokenType, expiresIn });
  }
  const raw = request.cookies.get("access_token")?.value;
  if (raw) {
    try { response.headers.set("authorization", `Bearer ${JSON.parse(raw).accessToken}`); } catch {}
  }
  return response;
}

const UUID_IN_PATH = /^\/community\/(post|announcements)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** True when the row exists and is readable by a guest. Server-side errors and
 *  timeouts count as "exists" so a Supabase hiccup never hides content. */
async function communityRowExists(kind: string, id: string): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return true;

  const table = kind === "post" ? "community_posts" : "announcements";
  const filters = kind === "post" ? "&status=eq.published&deleted_at=is.null" : "";
  const url = `${base}/rest/v1/${table}?id=eq.${id}&select=id${filters}`;

  try {
    const response = await fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!response.ok) return true;
    const rows = (await response.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return true;
  }
}

// `push/` is excluded so the OneSignal service workers under
// /push/onesignal/* are served straight from /public: no auth call, no rewrite,
// no redirect. The browser refuses a worker script that answers with one.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|push/).*)"] };
