import { InvalidTokenError } from "./signing";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const ALLOWED_FORWARD_HEADERS = [
  "referer",
  "origin",
  "user-agent",
  "accept",
  "accept-language",
] as const;

export function filterForwardHeaders(input?: Record<string, string>) {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(input || {})) {
    const normalizedKey = key.toLowerCase();

    if (
      ALLOWED_FORWARD_HEADERS.includes(
        normalizedKey as (typeof ALLOWED_FORWARD_HEADERS)[number],
      )
    ) {
      out[normalizedKey] = String(value);
    }
  }

  return out;
}

export function assertSafeUpstream(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new InvalidTokenError("Invalid URL");
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new InvalidTokenError("Only HTTP(S) targets are allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/[\[\]]/g, "");

  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^(fc|fd)[0-9a-f]{2}:/i.test(hostname) ||
    hostname === "0.0.0.0"
  ) {
    throw new InvalidTokenError("Private target rejected");
  }

  return url;
}

type SafeFetchOptions = {
  headers?: Record<string, string>;
  range?: string;
  ifRange?: string;
  identityEncoding?: boolean;
  timeoutMs?: number;
  method?: string;
};

export async function safeFetch(url: string, opts: SafeFetchOptions = {}) {
  let current = assertSafeUpstream(url);
  const headers = new Headers({
    "user-agent": DEFAULT_UA,
    ...filterForwardHeaders(opts.headers),
  });

  // Keep byte-range metadata aligned with the body bytes returned by fetch.
  if (opts.identityEncoding) headers.set("accept-encoding", "identity");
  if (opts.range) headers.set("range", opts.range);
  if (opts.ifRange) headers.set("if-range", opts.ifRange);

  for (let hop = 0; hop <= 5; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? 15_000,
    );
    let response: Response;

    try {
      response = await fetch(current, {
        method: opts.method || "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);

      if (hop === 5) throw new Error("redirect_limit");
      if (!location) throw new Error("redirect_without_location");

      current = assertSafeUpstream(new URL(location, current).toString());
      continue;
    }

    return { response, finalUrl: current.toString() };
  }

  throw new Error("redirect_limit");
}

export async function readResponseText(
  response: Response,
  options: { maxBytes?: number; timeoutMs?: number } = {},
) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const maxBytes = options.maxBytes ?? 3_000_000;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const parts: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("upstream_body_timeout");

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
      if (next.timedOut) throw new Error("upstream_body_timeout");
      if (next.value.done) break;

      total += next.value.value.byteLength;
      if (total > maxBytes) throw new Error("upstream_body_too_large");
      parts.push(next.value.value);
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

  return new TextDecoder().decode(bytes);
}
