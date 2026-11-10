// The origin the visitor actually used, for the few places that must know it
// while rendering on the server (the YouTube `origin` parameter has to match the
// page, see app/lib/youtube.ts).
//
// `request.url` is not reliable behind a proxy: it can carry the server's own
// bind address, such as 0.0.0.0:10000. The proxy's forwarded headers carry the
// real host, so they win.

export type HeaderBag = { get(name: string): string | null };

const UNUSABLE_HOSTS = ["0.0.0.0", "127.0.0.1", "[::]"];

export function originFromHeaders(headers: HeaderBag, fallback = ""): string {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.split(",")[0]?.trim() || "";
  const protocol =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") ? "http" : "https");

  if (host && !UNUSABLE_HOSTS.some((unusable) => host.startsWith(unusable))) {
    return `${protocol}://${host}`;
  }

  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

  return configured || fallback;
}
