import { classifyChunk } from "@/app/lib/proxy/sniff";

type ReadResult = ReadableStreamReadResult<Uint8Array>;

function abortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) throw abortError();

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function readAtMost(response: Response, signal: AbortSignal) {
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < 256) {
      const next = await readWithAbort(reader, signal);
      if (next.done) break;

      const part = next.value.slice(0, 256 - total);
      parts.push(part);
      total += part.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  return bytes;
}

async function readText(response: Response, signal: AbortSignal) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const next = await readWithAbort(reader, signal);
      if (next.done) break;

      total += next.value.byteLength;
      if (total > 3_000_000) throw new Error("playlist_too_large");
      parts.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  return new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
}

async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const value = await consume(response, controller.signal);
    return { response, value };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeStream(
  stream: any,
  headers: Record<string, string>,
  options: { timeoutMs?: number } = {},
) {
  if (stream.type === "embed") return { ok: true, embedOnly: true };

  const deadline = Date.now() + (options.timeoutMs ?? 6_000);
  const requestTimeout = () =>
    Math.max(1, Math.min(4_000, deadline - Date.now()));

  try {
    if (stream.type === "mp4") {
      const { response, value: bytes } = await fetchWithTimeout(
        stream.url,
        {
          headers: {
            ...headers,
            range: "bytes=0-255",
            "accept-encoding": "identity",
          },
        },
        requestTimeout(),
        (result, signal) =>
          result.ok
            ? readAtMost(result, signal)
            : Promise.resolve(new Uint8Array()),
      );

      return response.ok &&
        (response.status === 200 || response.status === 206) &&
        bytes.byteLength > 0 &&
        classifyChunk(bytes) !== "html"
        ? { ok: true, finalUrl: response.url }
        : { ok: false, reason: "invalid_mp4" };
    }

    const { response, value: text } = await fetchWithTimeout(
      stream.url,
      { headers },
      requestTimeout(),
      (result, signal) =>
        result.ok ? readText(result, signal) : Promise.resolve(""),
    );

    if (!response.ok || !text.trimStart().startsWith("#EXTM3U")) {
      return { ok: false, reason: "invalid_hls" };
    }

    let media = text;
    let finalUrl = response.url;

    if (text.includes("#EXT-X-STREAM-INF")) {
      const line = text
        .split(/\r?\n/)
        .find((value) => value && !value.startsWith("#"));
      if (!line) return { ok: false, reason: "no_variant" };

      finalUrl = new URL(line, response.url).toString();
      const variant = await fetchWithTimeout(
        finalUrl,
        { headers },
        requestTimeout(),
        (result, signal) =>
          result.ok ? readText(result, signal) : Promise.resolve(""),
      );
      media = variant.value;
      finalUrl = variant.response.url || finalUrl;

      if (!variant.response.ok || !media.includes("#EXTINF")) {
        return { ok: false, reason: "invalid_variant" };
      }
    }

    const segments = media
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value && !value.startsWith("#"));

    if (!segments.length) return { ok: false, reason: "no_segment" };

    const indexes = Array.from(
      new Set([
        ...Array(Math.min(8, segments.length)).keys(),
        Math.floor(segments.length * 0.25),
        Math.floor(segments.length * 0.6),
      ]),
    ).slice(0, 10);

    const results = await Promise.all(
      indexes.map(async (index) => {
        try {
          const result = await fetchWithTimeout(
            new URL(segments[index], finalUrl).toString(),
            {
              headers: {
                ...headers,
                range: "bytes=0-255",
                "accept-encoding": "identity",
              },
            },
            requestTimeout(),
            (response, signal) =>
              response.ok
                ? readAtMost(response, signal)
                : Promise.resolve(new Uint8Array()),
          );
          const kind = classifyChunk(result.value);
          const pass =
            (result.response.status === 200 ||
              result.response.status === 206) &&
            (kind === "ts" ||
              kind === "fmp4" ||
              (kind === "unknown" && stream.type !== "hls"));

          return {
            index,
            pass,
            kind,
            contentType: result.response.headers.get("content-type") || "",
          };
        } catch {
          return { index, pass: false, kind: "unknown", contentType: "" };
        }
      }),
    );

    const failures = results.filter((result) => !result.pass).length;

    return {
      ok: failures === 0,
      healthy: failures === 0,
      unstable: failures >= 1 && failures <= 2,
      failures,
      segments: results,
      kind: "media",
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "network_error",
    };
  }
}
