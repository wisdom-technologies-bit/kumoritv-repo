import { safeFetch } from "@/app/lib/proxy/upstream";
import {
  classifyChunk,
  sniffContentType,
  type ChunkKind,
} from "@/app/lib/proxy/sniff";
import type { ProxyPayload } from "@/app/lib/proxy/signing";

const PROBE_BYTES = 192;
const PROBE_TIME_BUDGET_MS = 100;
const HLS_UPSTREAM_HEADER_TIMEOUT_MS = 1_800;
const MP4_UPSTREAM_HEADER_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryStatus = (status: number) =>
  status === 403 || status === 429 || status >= 500;

type ProbeResult = {
  first: Uint8Array;
  pendingRead?: Promise<ReadableStreamReadResult<Uint8Array>>;
  timedOut: boolean;
};

async function readProbe(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ProbeResult> {
  const parts: Uint8Array[] = [];
  const deadline = Date.now() + PROBE_TIME_BUDGET_MS;
  let total = 0;
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let timedOut = false;

  while (total < PROBE_BYTES) {
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      timedOut = true;
      break;
    }

    const read = reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let next:
      | {
          value: ReadableStreamReadResult<Uint8Array>;
          timedOut: false;
        }
      | { value: null; timedOut: true };

    try {
      next = await Promise.race([
        read.then((value) => ({ value, timedOut: false as const })),
        new Promise<{ value: null; timedOut: true }>((resolve) => {
          timer = setTimeout(
            () => resolve({ value: null, timedOut: true }),
            remaining,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (next.timedOut) {
      pendingRead = read;
      timedOut = true;
      break;
    }

    if (next.value.done) break;

    parts.push(next.value.value);
    total += next.value.value.byteLength;
  }

  const first = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    first.set(part, offset);
    offset += part.byteLength;
  }

  return { first, pendingRead, timedOut };
}

function streamWithFirstChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  first: Uint8Array,
  pendingRead?: Promise<ReadableStreamReadResult<Uint8Array>>,
) {
  let firstSent = false;
  let nextRead = pendingRead;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!firstSent) {
        firstSent = true;

        if (first.byteLength > 0) {
          controller.enqueue(first);
          return;
        }
      }

      const read = nextRead || reader.read();
      nextRead = undefined;

      return read.then(
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

export async function handleSegment(req: Request, payload: ProxyPayload) {
  const range = req.headers.get("range") || undefined;
  const ifRange = req.headers.get("if-range") || undefined;

  let lastStatus = 502;
  let timedOut = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await sleep(150);

    const started = Date.now();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const upstream = await safeFetch(payload.u, {
        headers: payload.h || {},
        range,
        ifRange,
        identityEncoding: true,
        timeoutMs:
          payload.f === "mp4"
            ? MP4_UPSTREAM_HEADER_TIMEOUT_MS
            : HLS_UPSTREAM_HEADER_TIMEOUT_MS,
      });

      const response = upstream.response;
      lastStatus = response.status;

      if (retryStatus(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        if (attempt < 2) continue;
        break;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        break;
      }

      let probe: ProbeResult = {
        first: new Uint8Array(),
        timedOut: false,
      };
      const probeStarted = Date.now();

      if (response.body) {
        reader = response.body.getReader();
        probe = await readProbe(reader);
      }

      const kind: ChunkKind = classifyChunk(probe.first);
      const contentEncoding = response.headers
        .get("content-encoding")
        ?.trim()
        .toLowerCase();
      const encodedBody = Boolean(
        contentEncoding && contentEncoding !== "identity",
      );
      const encodedPartialResponse =
        Boolean(range) && response.status === 206 && encodedBody;
      const upstreamContentType =
        response.headers.get("content-type")?.trim() || "";
      const normalizedContentType = upstreamContentType
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const upstreamHtml =
        normalizedContentType === "text/html" ||
        normalizedContentType === "application/xhtml+xml";

      if (
        kind === "html" ||
        (kind === "unknown" && upstreamHtml) ||
        encodedPartialResponse
      ) {
        await reader?.cancel().catch(() => undefined);
        if (attempt < 2) continue;
        break;
      }

      const genericContentType =
        normalizedContentType === "application/octet-stream" ||
        normalizedContentType === "binary/octet-stream";
      const contentType =
        sniffContentType(kind) ||
        (payload.f === "mp4" && genericContentType
          ? "video/mp4"
          : upstreamContentType ||
            (payload.f === "mp4" ? "video/mp4" : "application/octet-stream"));
      const headers = new Headers({
        "cache-control": "private, max-age=0, must-revalidate",
        "content-type": contentType,
        "x-content-type-options": "nosniff",
        "x-proxy-attempts": String(attempt),
        "x-proxy-upstream-status": String(response.status),
      });

      for (const name of [
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
      ]) {
        if (encodedBody) continue;

        if (name === "content-length" && !response.body) continue;

        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }

      const probeDuration = Date.now() - probeStarted;
      console.log(
        `[proxy-segment] host=${new URL(upstream.finalUrl).host} ` +
          `attempt=${attempt} status=${response.status} ` +
          `kind=${kind} range=${range || "none"} ` +
          `content-type=${contentType} ` +
          `content-length=${headers.get("content-length") || "unknown"} ` +
          `content-range=${headers.get("content-range") || "none"} ` +
          `probe-ms=${probeDuration} probe-timeout=${probe.timedOut} ` +
          `encoded-body=${encodedBody} ttfb=${Date.now() - started}`,
      );

      return new Response(
        reader
          ? streamWithFirstChunk(reader, probe.first, probe.pendingRead)
          : null,
        {
          status: response.status,
          headers,
        },
      );
    } catch (error) {
      await reader?.cancel().catch(() => undefined);
      timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || /abort|timeout/i.test(error.message));

      lastStatus = 502;

      if (attempt < 2) continue;
    }
  }

  return new Response(
    timedOut ? "upstream timeout" : "upstream blocked the request",
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
