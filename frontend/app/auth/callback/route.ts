import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";
import { sanitizeNextPath } from "@/app/lib/supabase/auth";

/**
 * The address the visitor actually used. `request.url` is not reliable behind a
 * proxy (Render, Docker, ...): it carries the server's own bind address, such as
 * 0.0.0.0:10000. The proxy's forwarded headers carry the real one.
 */
function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || "";
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") ? "http" : "https");

  if (host && !host.startsWith("0.0.0.0") && !host.startsWith("127.0.0.1")) {
    return `${protocol}://${host}`;
  }

  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  return configured || request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  const next = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
  const client = await createAuthServerClient();
  if (!client || !code) return NextResponse.redirect(new URL("/?auth_error=callback", origin));
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/?auth_error=callback", origin));
  return NextResponse.redirect(new URL(next, origin));
}
