
import { safeFetch } from "@/app/lib/proxy/upstream";
import {
  classifyChunk,
  sniffContentType,
  type ChunkKind,
} from "@/app/lib/proxy/sniff";
import type { ProxyPayload } from "@/app/lib/proxy/signing";

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const retryStatus = (status: number) =>
  status === 403 || status === 429 || status >= 500;

async function readProbe(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  const parts: Uint8Array[] = [];
  let total = 0;

  while (total < 192) {
    const next = await reader.read();

    if (next.done) break;

    parts.push(next.value);
    total += next.value.byteLength;
  }

  const first = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    first.set(part, offset);
    offset += part.byteLength;
  }

  return first;
}

function streamWithFirstChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  first: Uint8Array,
) {
  let firstSent = false;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!firstSent) {
        firstSent = true;

        if (first.byteLength > 0) {
          controller.enqueue(first);
          return;
        }
      }

      return reader.read().then(
        (next) => {
          if (next.done) {
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        },
        () => {
          controller.error(new Error("Upstream video stream failed"));
        },
      );
    },

    cancel(reason) {
      return reader.cancel(reason).catch(() => undefined);
    },
  });
}

export async function handleSegment(
  req: Request,
  payload: ProxyPayload,
) {
  const range = req.headers.get("range") || undefined;

  let lastStatus = 502;
  let timedOut = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await sleep(150);

    const started = Date.now();

    try {
      const upstream = await safeFetch(payload.u, {
        headers: payload.h || {},
        range,
        timeoutMs: 1800,
      });

      const response = upstream.response;
      lastStatus = response.status;

      let reader:
        | ReadableStreamDefaultReader<Uint8Array>
        | undefined;

      let first = new Uint8Array();

      if (response.body) {
        reader = response.body.getReader();
        first = await readProbe(reader);
      }

      const kind: ChunkKind = classifyChunk(first);
      const retry =
        retryStatus(response.status) || kind === "html";

      if (retry) {
        await reader?.cancel().catch(() => undefined);

        if (attempt < 2) continue;

        break;
      }

      const headers = new Headers({
        "cache-control": "private, max-age=0, must-revalidate",
        "x-content-type-options": "nosniff",
        "x-proxy-attempts": String(attempt),
        "x-proxy-upstream-status": String(response.status),
      });

      // Preserve the real media type whenever sniffing cannot identify it.
      const contentType =
        sniffContentType(kind) ||
        response.headers.get("content-type") ||
        (payload.f === "mp4"
          ? "video/mp4"
          : "application/octet-stream");

      headers.set("content-type", contentType);

      // These headers are important for duration detection and seeking.
      for (const name of [
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
      ]) {
        const value = response.headers.get(name);

        if (value) headers.set(name, value);
      }

      console.log(
        `[proxy-segment] host=${new URL(upstream.finalUrl).host} ` +
          `attempt=${attempt} status=${response.status} ` +
          `kind=${kind} range=${range || "none"} ` +
          `content-length=${headers.get("content-length") || "unknown"} ` +
          `content-range=${headers.get("content-range") || "none"} ` +
          `ttfb=${Date.now() - started}`,
      );

      // Preserve 206 Partial Content for byte-range video requests.
      const status = response.status === 404 ? 502 : response.status;

      return new Response(
        reader ? streamWithFirstChunk(reader, first) : null,
        {
          status,
          headers,
        },
      );
    } catch (error) {
      timedOut =
        error instanceof Error &&
        (error.name === "AbortError" ||
          /abort|timeout/i.test(error.message));

      lastStatus = 502;

      if (attempt < 2) continue;
    }
  }

  return new Response(
    timedOut
      ? "upstream timeout"
      : "upstream blocked the request",
    {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-proxy-attempts": "2",
        "x-proxy-upstream-status": String(lastStatus),
      },
    },
  );
}
