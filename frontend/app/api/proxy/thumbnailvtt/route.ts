import {
  verifyToken,
  ProxyNotConfiguredError,
  proxyUrl,
} from "@/app/lib/proxy/signing";
import { readResponseText, safeFetch } from "@/app/lib/proxy/upstream";
export const runtime = "edge";
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  if (!token) return new Response("invalid or expired token", { status: 403 });
  try {
    const p = await verifyToken(token);
    const r = await safeFetch(p.u, { headers: p.h, timeoutMs: 15000 });
    if (!r.response.ok)
      return new Response("upstream fetch failed", { status: 502 });
    const text = await readResponseText(r.response, {
      maxBytes: 3_000_000,
      timeoutMs: 15_000,
    });
    const seen = new Map<string, string>();
    const out = await Promise.all(
      text.split(/\r?\n/).map(async (line) => {
        const m = line.match(/^(.+?)#xywh=(\d+,\d+,\d+,\d+)$/);
        if (!m) return line;
        const absolute = new URL(m[1], r.finalUrl).toString();
        let proxied = seen.get(absolute);
        if (!proxied) {
          proxied = await proxyUrl("thumbnail", { u: absolute, h: p.h });
          seen.set(absolute, proxied);
        }
        return `${proxied}#xywh=${m[2]}`;
      }),
    );
    return new Response(out.join("\n"), {
      headers: {
        "content-type": "text/vtt; charset=utf-8",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const notConfigured = error instanceof ProxyNotConfiguredError;
    const tooLarge =
      error instanceof Error && error.message === "upstream_body_too_large";

    return new Response(
      notConfigured
        ? "proxy_not_configured"
        : tooLarge
          ? "thumbnail VTT too large"
          : "upstream fetch failed",
      { status: notConfigured ? 500 : 502 },
    );
  }
}
