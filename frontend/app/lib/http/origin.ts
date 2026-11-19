import type { NextRequest } from "next/server";

/**
 * The address the visitor actually used. `request.url` is not reliable behind a
 * proxy (Railway, Cloudflare): it can carry the server's own bind address. The
 * forwarded headers carry the real one.
 */
export function publicOrigin(request: NextRequest): string {
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
