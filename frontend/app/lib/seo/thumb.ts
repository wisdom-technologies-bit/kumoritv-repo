// Episode thumbnails served from our own domain.
//
// Search Console reports "Thumbnail blocked by robots.txt" for the watch pages:
// `VideoObject.thumbnailUrl` pointed at a provider image host (or AniList) whose
// robots.txt refuses Googlebot. This module puts KumoriTV in front of the image:
// `/thumb/[id]/[ep]` fetches the bytes server-side and re-serves them from our
// origin, where robots.txt only blocks /api/ and /auth/.
//
// The route lives outside /api/ on purpose, and it is never listed in a sitemap.
//
// Source order comes from OUR database only (never an AniList call):
//   episodes.image_url -> anime.banner_url -> anime.cover_url
// When every candidate fails, or none exists, the existing OG card for the same
// id/episode is returned, so the route always answers with an image.
//
// Every upstream hop is validated: https only, no credentials in the URL, and the
// resolved address of the host must be public (the check runs again on each
// redirect). Upstream cookies and headers are never forwarded.

import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";

/** The thumbnail is stable art: cache it hard, on the browser and at the edge. */
export const THUMB_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";

/** One upstream fetch (headers + body) gets 5 s. */
export const THUMB_TIMEOUT_MS = 5000;
/** Redirects followed per candidate, re-validated on each hop. */
export const THUMB_MAX_REDIRECTS = 2;
/** Anything bigger is not an episode thumbnail. */
export const THUMB_MAX_BYTES = 3 * 1024 * 1024;
/**
 * The whole candidate chain is bounded so the route stays inside its 15 s
 * maxDuration: three 5 s candidates plus the card would overshoot it.
 */
export const THUMB_TOTAL_BUDGET_MS = 12_000;
/** Not a browser string: providers get to see who is asking. */
export const THUMB_USER_AGENT = "KumoriTV";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ResolvedAddress = { address: string; family?: number };

export type ThumbLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export type ThumbImage = { bytes: Uint8Array; contentType: string };

export type ThumbFetchDeps = {
  lookup?: ThumbLookup;
  fetchImpl?: typeof fetch;
  /** Per-upstream-request deadline. */
  timeoutMs?: number;
  maxBytes?: number;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Positive decimal integer only: no floats, signs, exponents or empty values. */
export function parseThumbParams(
  rawId: string | number | null | undefined,
  rawEpisode: string | number | null | undefined,
): { id: number; episode: number } | null {
  const id = parsePositiveInt(rawId);
  const episode = parsePositiveInt(rawEpisode);
  if (id === null || episode === null) return null;
  return { id, episode };
}

function parsePositiveInt(value: unknown): number | null {
  const raw =
    typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,10}$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function ipv4IsPrivate(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function ipv6IsPrivate(address: string): boolean {
  const bare = address.toLowerCase().split("%")[0];
  // ::ffff:10.0.0.1 and ::ffff:a00:1 both wrap an IPv4 address.
  const mapped = bare.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  // ::ffff:a00:1 (hex pair form) still ends up in the private ranges.
  const hexMapped = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return ipv4IsPrivate(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  if (bare === "::" || bare === "::1") return true; // unspecified + loopback
  if (bare.startsWith("fe8") || bare.startsWith("fe9") || bare.startsWith("fea") || bare.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true; // fc00::/7 unique local
  if (/^ff[0-9a-f]{2}:/.test(bare)) return true; // ff00::/8 multicast
  return false;
}

/** True for anything a server must never fetch on a visitor's behalf. */
export function isPrivateAddress(address: string): boolean {
  const value = text(address).replace(/^\[|\]$/g, "");
  if (!value) return true;
  return value.includes(":") ? ipv6IsPrivate(value) : ipv4IsPrivate(value);
}

/** A hostname that can never be public, whatever DNS says. */
export function isPrivateHostname(hostname: string): boolean {
  const host = text(hostname).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localdomain")) return true;
  return false;
}

const isIpLiteral = (hostname: string) =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");

const defaultLookup: ThumbLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return Array.isArray(records) ? records : [records];
};

/**
 * Validates one URL (and its resolved address) or throws. Redirect targets go
 * through this same function, which is what stops an open redirect into the
 * private network.
 */
export async function assertPublicImageUrl(
  rawUrl: string,
  deps: ThumbFetchDeps = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:") throw new Error("not_https");
  if (url.username || url.password) throw new Error("credentials_in_url");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) throw new Error("missing_host");
  if (isPrivateHostname(hostname)) throw new Error("private_host");
  if (isIpLiteral(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("private_host");
    return url;
  }

  const lookup = deps.lookup ?? defaultLookup;
  let records: ResolvedAddress[];
  try {
    records = await lookup(hostname);
  } catch {
    throw new Error("dns_failed");
  }
  if (!Array.isArray(records) || records.length === 0) throw new Error("dns_empty");
  for (const record of records) {
    const address = text(record?.address);
    if (!address || isPrivateAddress(address)) throw new Error("private_address");
  }
  return url;
}

/** Reads at most `maxBytes`; anything longer is refused instead of buffered. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling the stream the moment the cap is crossed.
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetches one candidate image, or null if it is unsafe, slow, not an image, or
 * over the size cap. Never throws.
 */
export async function fetchThumbImage(
  rawUrl: string,
  deps: ThumbFetchDeps = {},
): Promise<ThumbImage | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? THUMB_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? THUMB_MAX_BYTES;
  const deadline = Date.now() + timeoutMs;

  let target: string;
  try {
    target = (await assertPublicImageUrl(rawUrl, deps)).toString();
  } catch {
    return null;
  }

  for (let hop = 0; hop <= THUMB_MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;

    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        // Only our own identity goes upstream: no cookies, no client headers.
        headers: { "user-agent": THUMB_USER_AGENT, accept: "image/*" },
        signal: AbortSignal.timeout(remaining),
      });
    } catch {
      return null;
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return null;
      let next: URL;
      try {
        next = await assertPublicImageUrl(new URL(location, target).toString(), deps);
      } catch {
        return null;
      }
      target = next.toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const contentType = text(response.headers.get("content-type")).toLowerCase();
    // Raster images only: an SVG served from our own origin could run script.
    if (!contentType.startsWith("image/") || contentType.startsWith("image/svg")) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const bytes = await readCapped(response, maxBytes);
    if (!bytes) return null;
    return { bytes, contentType };
  }

  return null;
}

function firstRow(data: unknown): Record<string, any> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, any>) ?? null;
  if (data && typeof data === "object") return data as Record<string, any>;
  return null;
}

/**
 * Candidate image URLs, in priority order, read from our own tables only.
 * Never throws and never calls AniList.
 */
export async function readThumbCandidates(
  db: any,
  anilistId: number,
  episode: number,
): Promise<string[]> {
  if (!db) return [];
  const candidates: string[] = [];
  const push = (value: unknown) => {
    const url = text(value);
    if (url && !candidates.includes(url)) candidates.push(url);
  };

  try {
    const { data } = await db
      .from("episodes")
      .select("image_url")
      .eq("anilist_id", anilistId)
      .eq("episode_number", episode)
      .limit(1);
    push(firstRow(data)?.image_url);
  } catch {
    /* a missing episode row simply means the next candidate is tried */
  }

  try {
    const { data } = await db
      .from("anime")
      .select("banner_url, cover_url")
      .eq("anilist_id", anilistId)
      .limit(1);
    const row = firstRow(data);
    push(row?.banner_url);
    push(row?.cover_url);
  } catch {
    /* same for the series art */
  }

  return candidates;
}

/** The successful path: upstream bytes under our own cache headers. */
export function thumbImageResponse(image: ThumbImage): Response {
  return new Response(image.bytes, {
    status: 200,
    headers: {
      "content-type": image.contentType,
      "content-length": String(image.bytes.byteLength),
      "cache-control": THUMB_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}

export type ThumbDeps = {
  /** Candidate URLs for (anilist_id, episode), best first. */
  candidates: (id: number, episode: number) => Promise<string[]>;
  lookup: ThumbLookup;
  fetchImpl: typeof fetch;
  /** The OG card, used whenever no upstream candidate works. */
  fallback: (input: { id: number; episode: number }) => Promise<Response>;
  timeoutMs: number;
  maxBytes: number;
  totalBudgetMs: number;
};

export function defaultThumbDeps(): ThumbDeps {
  return {
    async candidates(id, episode) {
      const { createAdminClient } = await import("@/app/lib/supabase/admin");
      return readThumbCandidates(createAdminClient(), id, episode);
    },
    lookup: defaultLookup,
    fetchImpl: fetch,
    async fallback({ id, episode }) {
      const { ogImageResponse } = await import("./og-image");
      return ogImageResponse({ id, episode });
    },
    timeoutMs: THUMB_TIMEOUT_MS,
    maxBytes: THUMB_MAX_BYTES,
    totalBudgetMs: THUMB_TOTAL_BUDGET_MS,
  };
}

/**
 * The card keeps its own (short) cache so real art replaces a placeholder soon;
 * it only gains `nosniff`, which every branch of this route sends.
 */
function cardResponse(response: Response): Response {
  const headers = new Headers({
    "content-type": text(response.headers.get("content-type")) || "image/png",
    "cache-control": text(response.headers.get("cache-control")) || THUMB_CACHE_CONTROL,
    "x-content-type-options": "nosniff",
  });
  const length = text(response.headers.get("content-length"));
  if (length) headers.set("content-length", length);
  return new Response(response.body, { status: 200, headers });
}

/** Last resort if the card renderer itself throws: never a broken image tag. */
async function lastResortCard(): Promise<Response> {
  try {
    const { OG_LAST_RESORT_PNG } = await import("./og-image");
    const png = Buffer.from(OG_LAST_RESORT_PNG, "base64");
    return new Response(png, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "cache-control": THUMB_CACHE_CONTROL,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("thumbnail unavailable", {
      status: 500,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
}

/**
 * Answers `/thumb/[id]/[ep]`. Bad parameters are a 404; every valid pair ends in
 * an image, one way or another.
 */
export async function thumbnailResponse(
  input: { id: string | number | null | undefined; ep: string | number | null | undefined },
  deps: Partial<ThumbDeps> = {},
): Promise<Response> {
  const params = parseThumbParams(input.id, input.ep);
  if (!params) {
    return new Response("not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  }

  const resolved: ThumbDeps = { ...defaultThumbDeps(), ...deps };
  const deadline = Date.now() + resolved.totalBudgetMs;

  try {
    const candidates = await resolved.candidates(params.id, params.episode);
    for (const candidate of candidates) {
      const remaining = Math.min(resolved.timeoutMs, deadline - Date.now());
      if (remaining <= 0) break;
      const image = await fetchThumbImage(candidate, {
        lookup: resolved.lookup,
        fetchImpl: resolved.fetchImpl,
        timeoutMs: remaining,
        maxBytes: resolved.maxBytes,
      });
      if (image) return thumbImageResponse(image);
    }
  } catch {
    /* fall through to the card */
  }

  try {
    return cardResponse(await resolved.fallback(params));
  } catch {
    return lastResortCard();
  }
}
