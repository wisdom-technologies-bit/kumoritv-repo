import {
  verifyToken,
  signToken,
  ProxyNotConfiguredError,
} from "@/app/lib/proxy/signing";
import { readResponseText, safeFetch } from "@/app/lib/proxy/upstream";

export const runtime = "edge";

const bad = (status: number, message: string) =>
  new Response(message, { status });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PlaylistResult = {
  response: Response;
  finalUrl: string;
  text: string;
};

async function fetchPlaylist(
  url: string,
  headers: Record<string, string>,
): Promise<PlaylistResult> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await wait(attempt === 2 ? 150 : 400);

    try {
      const upstream = await safeFetch(url, { headers, timeoutMs: 5_000 });
      const response = upstream.response;
      const text = response.ok
        ? await readResponseText(response, {
          maxBytes: 3_000_000,
          timeoutMs: 4_000,
        })
        : "";
      const shouldRetry =
        response.status >= 500 ||
        [403, 408, 425, 429].includes(response.status) ||
        /^\s*<(?:!|html)/i.test(text);

      if (shouldRetry && attempt < 3) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { response, finalUrl: upstream.finalUrl, text: "" };
      }

      return { response, finalUrl: upstream.finalUrl, text };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "upstream_body_too_large"
      ) {
        throw error;
      }

      if (attempt === 3) throw new Error("upstream timeout");
    }
  }

  throw new Error("upstream blocked");
}

async function make(
  kind: string,
  url: string,
  base: string,
  headers: Record<string, string>,
) {
  const upstreamUrl = new URL(url, base).toString();
  const token = await signToken({ u: upstreamUrl, h: headers });
  return `/api/proxy/${kind}?t=${encodeURIComponent(token)}`;
}

export async function GET(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const token = new URL(req.url).searchParams.get("t");
  if (!token) return bad(403, "invalid or expired token");

  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(token);
  } catch (error) {
    const configured = error instanceof ProxyNotConfiguredError;
    return bad(
      configured ? 500 : 403,
      configured ? "proxy_not_configured" : "invalid or expired token",
    );
  }

  try {
    const upstream = await fetchPlaylist(payload.u, payload.h || {});
    if (!upstream.response.ok) {
      return bad(502, `upstream status ${upstream.response.status}`);
    }

    const text = upstream.text.replace(/^\uFEFF/, "").trimStart();
    if (text.length > 3_000_000 || !text.startsWith("#EXTM3U")) {
      return bad(
        502,
        text.length > 3_000_000
          ? "playlist too large"
          : "upstream did not return a playlist",
      );
    }

    const lines = text.split(/\r?\n/);
    const outputLines: string[] = [];
    let variant = false;
    const segmentRuntime = (process.env.PROXY_SEGMENT_RUNTIME || "")
      .trim()
      .toLowerCase();
    const segmentKind = ["node", "nodejs", "1", "true"].includes(segmentRuntime)
      ? "segment-node"
      : "segment";

    for (const line of lines) {
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        variant = true;
        outputLines.push(line);
        continue;
      }

      if (line.startsWith("#")) {
        const kind =
          line.includes("EXT-X-MEDIA") ||
          line.includes("EXT-X-I-FRAME-STREAM-INF")
            ? "manifest"
            : segmentKind;
        let next = line;

        for (const match of line.matchAll(/URI="([^"]+)"/g)) {
          next = next.replace(
            `URI="${match[1]}"`,
            `URI="${await make(kind, match[1], upstream.finalUrl, payload.h || {})}"`,
          );
        }

        outputLines.push(next);
        continue;
      }

      if (!line.trim()) {
        outputLines.push(line);
        continue;
      }

      outputLines.push(
        await make(
          variant ? "manifest" : segmentKind,
          line,
          upstream.finalUrl,
          payload.h || {},
        ),
      );
      variant = false;
    }

    const output = outputLines.join("\n");
    return new Response(output, {
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": output.includes("#EXT-X-ENDLIST")
          ? "private, max-age=300"
          : "private, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    return bad(
      502,
      error instanceof Error && error.message === "upstream_body_too_large"
        ? "playlist too large"
        : error instanceof Error && error.message === "upstream timeout"
          ? "upstream timeout"
          : "upstream fetch failed",
    );
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204 });
}
