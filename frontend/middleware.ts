import axios from "axios";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
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

// `push/` is excluded so the OneSignal service workers under
// /push/onesignal/* are served straight from /public: no auth call, no rewrite,
// no redirect. The browser refuses a worker script that answers with one.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|push/).*)"] };
