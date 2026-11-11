import { createHash } from "node:crypto";
import { formatError } from "./sitemap";

/**
 * Prompt 34 Part B - the serving layer for every sitemap file.
 *
 * The host is Railway behind Cloudflare (see docs/sitemap-cloudflare.md), so
 * this is a long-running Node process:
 *
 *  - `unstable_cache` (keyed per file, tag `sitemap`, revalidate 3600) keeps the
 *    built XML across requests without re-walking the database;
 *  - an in-process cache holds the finished bytes for an hour, serves the stale
 *    copy while exactly one background rebuild runs (single-flight), and is the
 *    copy a failed rebuild falls back to;
 *  - the cron refresh pre-warms it, so a crawler almost always gets a warm file.
 *
 * Nothing here throws a bare 500 at a crawler: a file that cannot be built is
 * served stale, or the route answers 503 + Retry-After.
 */

export const SITEMAP_CACHE_TAG = "sitemap";
export const SITEMAP_REVALIDATE_SECONDS = 3600;
export const SITEMAP_MEMORY_TTL_MS = 60 * 60 * 1000;
/** Browser keeps it 5 minutes, Cloudflare an hour, and may serve stale for a day. */
export const SITEMAP_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
/** A 404/503 answer must never be cached by a crawler or by Cloudflare. */
export const SITEMAP_ERROR_CACHE_CONTROL = "no-store";

export type SitemapPayload = {
  body: string;
  /** Number of <url> entries in the file (0 means "this chunk does not exist"). */
  urls: number;
  lastModified: string | null;
  /** No rows: the route answers 404 instead of a 200 with an empty urlset. */
  empty: boolean;
};

export type SitemapBuilder = () => Promise<SitemapPayload>;

export type SitemapServed = {
  payload: SitemapPayload;
  etag: string;
  storedAt: number;
  /** True when the copy came from the in-process cache after a failed rebuild. */
  stale: boolean;
  /** True when this request actually rebuilt the file. */
  built: boolean;
  ms: number;
};

type Entry = {
  payload: SitemapPayload;
  etag: string;
  storedAt: number;
  inflight: Promise<SitemapPayload> | null;
};

const memory = new Map<string, Entry>();
/** In-flight rebuilds, keyed like `memory`: concurrent hits share one walk. */
const inflight = new Map<string, Promise<SitemapPayload>>();
/** Every build that died, newest last: the cron health route reports the last one. */
const recentFailures: Array<{ key: string; at: number; message: string }> = [];

export const sitemapEtag = (body: string) =>
  `"${createHash("sha1").update(body).digest("hex").slice(0, 32)}"`;

export function clearSitemapMemoryCache() {
  memory.clear();
  inflight.clear();
}

export function memorySitemapEntry(key: string) {
  return memory.get(key) ?? null;
}

export function recentSitemapFailures() {
  return recentFailures.slice(-20);
}

function noteFailure(key: string, error: unknown) {
  const message = formatError(error);
  recentFailures.push({ key, at: Date.now(), message });
  if (recentFailures.length > 50) recentFailures.shift();
}

/**
 * `unstable_cache` only exists inside the Next runtime. Unit tests (node --test)
 * and scripts import this module directly, so the call is resolved lazily and
 * falls back to the plain builder.
 */
async function nextCached<T>(builder: () => Promise<T>, keyParts: string[]): Promise<T> {
  try {
    const mod = (await import("next/cache")) as { unstable_cache?: any };
    if (typeof mod.unstable_cache === "function") {
      const cached = mod.unstable_cache(builder, keyParts, {
        revalidate: SITEMAP_REVALIDATE_SECONDS,
        tags: [SITEMAP_CACHE_TAG],
      });
      return (await cached()) as T;
    }
  } catch {
    // Outside Next: no shared cache, the in-process one below still applies.
  }
  return builder();
}

function store(key: string, payload: SitemapPayload): Entry {
  const entry: Entry = {
    payload,
    etag: sitemapEtag(payload.body),
    storedAt: Date.now(),
    inflight: null,
  };
  memory.set(key, entry);
  return entry;
}

/** One rebuild at a time per file: concurrent crawler hits never multiply queries. */
function singleFlight(key: string, builder: SitemapBuilder, useNextCache: boolean): Promise<SitemapPayload> {
  const running = inflight.get(key);
  if (running) return running;

  const run = (async () => {
    const payload = useNextCache
      ? await nextCached(builder, [key])
      : await builder();
    store(key, payload);
    return payload;
  })().finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
    const current = memory.get(key);
    if (current && current.inflight === run) current.inflight = null;
  });

  inflight.set(key, run);
  const entry = memory.get(key);
  if (entry) entry.inflight = run;
  return run;
}

export type LoadSitemapOptions = {
  /** Force a rebuild even when the in-process copy is fresh (cron pre-warm). */
  fresh?: boolean;
  /** Skip `unstable_cache` (tests/health checks that must measure the real read). */
  bypassNextCache?: boolean;
  now?: number;
};

export async function loadSitemap(
  key: string,
  builder: SitemapBuilder,
  options: LoadSitemapOptions = {},
): Promise<SitemapServed> {
  const started = Date.now();
  const now = options.now ?? started;
  const entry = memory.get(key);

  if (entry && !options.fresh && now - entry.storedAt < SITEMAP_MEMORY_TTL_MS) {
    return { ...entry, stale: false, built: false, ms: Date.now() - started };
  }

  try {
    const payload = await singleFlight(key, builder, !options.bypassNextCache);
    const fresh = memory.get(key);
    return {
      payload,
      etag: fresh?.etag ?? sitemapEtag(payload.body),
      storedAt: fresh?.storedAt ?? Date.now(),
      stale: false,
      built: true,
      ms: Date.now() - started,
    };
  } catch (error) {
    noteFailure(key, error);
    console.error(
      `[sitemap] build failed key=${key} step=build elapsed_ms=${Date.now() - started} error=${
        formatError(error)
      }`,
    );
    if (entry) {
      // Serve the last good copy and let one background rebuild repair it.
      if (!entry.inflight) {
        entry.inflight = singleFlight(key, builder, !options.bypassNextCache).catch(() => {
          const current = memory.get(key);
          if (current) current.inflight = null;
          return entry.payload;
        }) as Promise<SitemapPayload>;
      }
      return { ...entry, stale: true, built: false, ms: Date.now() - started };
    }
    throw error;
  }
}

function cacheState(served: { stale?: boolean; built?: boolean }) {
  if (served.stale) return "stale";
  return served.built ? "miss" : "hit";
}

/**
 * `request.headers` throws a DynamicServerError while Next prerenders a route
 * statically (the build step does try to render /sitemap.xml and
 * /sitemaps/static.xml). Reading it defensively keeps the prerender happy and
 * simply skips the conditional 304 there; at runtime it works as usual.
 */
function safeHeader(request: Request | undefined, name: string): string | null {
  try {
    return request?.headers.get(name) ?? null;
  } catch {
    return null;
  }
}

const ifNoneMatchMatches = (header: string | null, etag: string) => {
  if (!header) return false;
  return header
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === etag || part === "*" || part === `W/${etag}`);
};

/** The one place a successful sitemap answer is shaped: cacheable, conditional, stable. */
export function sitemapHttpResult(
  served: Pick<SitemapServed, "payload" | "etag"> & { stale?: boolean; built?: boolean },
  request?: Request,
): Response {
  const headers = new Headers({
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": SITEMAP_CACHE_CONTROL,
    ETag: served.etag,
    "X-Sitemap-Cache": cacheState(served),
  });
  if (served.payload.lastModified) {
    const date = new Date(served.payload.lastModified);
    if (!Number.isNaN(date.getTime())) headers.set("Last-Modified", date.toUTCString());
  }

  if (ifNoneMatchMatches(safeHeader(request, "if-none-match"), served.etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(served.payload.body, { status: 200, headers });
}

/**
 * 404 (no such chunk / no rows) and 503 (could not build, nothing to serve).
 * Always a tiny, valid XML document - never a bare 500 page.
 */
export function sitemapErrorResponse(
  status: 404 | 503,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><error xmlns="urn:kumoritv:sitemap">${message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</error>`;
  const headers = new Headers({
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": SITEMAP_ERROR_CACHE_CONTROL,
    ...extraHeaders,
  });
  return new Response(body, { status, headers });
}
